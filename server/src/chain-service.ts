import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { PixelPetsClient, ChainClientError, assertCoSignedTransaction, integer } from '../../chain-client/src/index.ts';
import type { ClaimInput, CheckpointInput, RpcClient } from '../../chain-client/src/index.ts';
import { ApiError, hash, iso, objectBody } from './domain.ts';
import type { Pet } from './domain.ts';
import type { Repository } from './repository.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import type { TravelService, TripCheckpointSource } from './travel.ts';

export type ChainNetwork = 'localnet' | 'devnet' | 'mainnet-beta';
export type ChainRpc = RpcClient & Pick<Connection, 'getTransaction'>;
export type WalletAuth = { user_id: string; kind: string };
export type ChainConfiguration = {
  network: ChainNetwork; programId: string; collectionAddress: string; issuer: Keypair;
  editions: Record<'moss' | 'puddle' | 'wisp', string>; rpc: ChainRpc;
  /** Public browser endpoint: no credentials, query string or fragment. */
  publicRpcUrl: string; expectedGenesisHash?: string; claimLifetimeSeconds?: number;
};
type Kind = 'claim' | 'checkpoint';
type AttemptState = 'prepared' | 'pending' | 'confirmed' | 'expired' | 'failed';
type InstructionInputs = Record<string, string | number>;
type Attempt = {
  attempt: number; state: AttemptState; asset_address: string; expires_at: string;
  transaction_base64: string; expected_message_base64: string; blockhash: string;
  last_valid_block_height: number; required_signers: string[]; network_fee_lamports: string;
  simulation_logs: readonly string[]; units_consumed: number | null; instruction_inputs: InstructionInputs;
  signature?: string; signed_transaction_base64?: string; finalized_slot?: number;
};
type Intent = {
  intent_id: string; scope: string; user_id: string; pet_id: string; wallet_address: string;
  kind: Kind; state: AttemptState; network: ChainNetwork; program_id: string; collection_address: string;
  claim_id: string; edition_id: string; source_revision: number; source: {
    form: number; bond: number; event_hash: string; species: number;
    /** Absent on v1 intents created before journey receipts; those keep their original recovery path. */
    schema?: 'v2'; trip_id?: string; public_receipt_id?: string; result_hash?: string;
    canonical_checkpoint?: string; expected_checkpoint?: string; asset_address?: string; network_genesis?: string;
  }; attempts: Attempt[]; created_at: string; updated_at: string;
};
/** Checkpoint v2 C array (plan 02 §6.2). Integers are small; u64 checkpoint is a decimal string. */
export function checkpointV2Array(input: { network_genesis: string; program_id: string; asset_address: string; chain_intent_id: string;
  expected_checkpoint: string; pet_revision: number; form: number; bond: number; care_count: number; traits_sun: number; traits_moon: number;
  public_receipt_id: string; result_hash: string }) {
  return ['pixel-pets:checkpoint:v2', input.network_genesis, input.program_id, input.asset_address, input.chain_intent_id,
    input.expected_checkpoint, input.pet_revision, input.form, input.bond, input.care_count, input.traits_sun, input.traits_moon,
    input.public_receipt_id, input.result_hash];
}
const speciesIds = ['moss', 'puddle', 'wisp'] as const;
const formIds = ['seed', 'sun', 'moon'] as const;
const ensure = (condition: unknown, code: string, message: string, status = 409): void => {
  if (!condition) throw new ApiError(status, code, message);
};
function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`); let result = '';
  while (value) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = `1${result}`; }
  return result;
}
function publicRpc(value: string): string {
  const url = new URL(value);
  ensure(!url.username && !url.password && !url.search && !url.hash, 'INVALID_PUBLIC_RPC', '公开 RPC 地址不能包含凭据、查询参数或片段。');
  ensure(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'INVALID_PUBLIC_RPC', '公开 RPC 必须使用 HTTPS 或本机 HTTP。');
  return url.toString();
}

/** Bound the entire HTTP exchange, including a stalled response body. No automatic 429 retries. */
export function createChainRpcConnection(endpoint: string, timeoutMs = 15000): Connection {
  ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000, 'INVALID_RPC_TIMEOUT', 'RPC 超时设置无效。');
  return new Connection(endpoint, { commitment: 'finalized', confirmTransactionInitialTimeout: timeoutMs,
    disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        const response = await fetch(input, { ...init, signal });
        // Connection reads res.text() after fetch returns. Buffer it while the deadline
        // is still active so receiving only headers cannot hold the pet lease forever.
        const body = await response.text();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        if (controller.signal.aborted) throw new ApiError(504, 'RPC_TIMEOUT', '链上查询超时，请稍后恢复这笔请求。');
        throw error;
      } finally { clearTimeout(timer); }
    },
  });
}

/** Only prepares co-signed transactions and reads RPC. It never sends or broadcasts a transaction. */
export class ChainService {
  readonly repository: Repository;
  readonly configuration?: ChainConfiguration;
  readonly client?: PixelPetsClient;
  private readonly queue = new Map<string, Promise<unknown>>();
  private readonly leases = new Map<string, { scope: string; token: string; lost: boolean; ownershipFence?: () => void }>();
  /** Optional sink for long-lived journey receipt evidence. */
  travel?: TravelService;
  constructor(repository: Repository, configuration?: ChainConfiguration) {
    this.repository = repository;
    if (configuration) {
      ensure(configuration.network === repository.network, 'NETWORK_MISMATCH', 'API 与链服务网络必须相同。');
      ensure(['localnet', 'devnet', 'mainnet-beta'].includes(configuration.network), 'UNSUPPORTED_NETWORK', '不支持该网络。');
      publicRpc(configuration.publicRpcUrl);
      for (const species of speciesIds) integer(configuration.editions[species]);
      const lifetime = configuration.claimLifetimeSeconds ?? 300;
      ensure(Number.isInteger(lifetime) && lifetime >= 30 && lifetime <= 900, 'INVALID_EXPIRY', '领取有效期必须为 30 到 900 秒。');
      this.configuration = configuration;
      this.client = new PixelPetsClient({ rpc: configuration.rpc, network: configuration.network, programId: configuration.programId,
        expectedCollection: configuration.collectionAddress, expectedGenesisHash: configuration.expectedGenesisHash, commitment: 'finalized' });
    }
    repository.db.exec(`CREATE TABLE IF NOT EXISTS chain_intents (
      id TEXT PRIMARY KEY, scope TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      pet_id TEXT NOT NULL REFERENCES pets(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chain_intents_pet ON chain_intents(pet_id);
      CREATE TABLE IF NOT EXISTS chain_leases (scope TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  }
  private config(): ChainConfiguration {
    if (!this.configuration || !this.client) throw new ApiError(503, 'CHAIN_DISABLED', '链上登记尚未配置，养成仍可继续。');
    return this.configuration;
  }
  private wallet(auth: WalletAuth): string {
    ensure(auth.kind === 'wallet', 'WALLET_SESSION_REQUIRED', '请先用钱包签名登录。', 401);
    return this.repository.walletSession(auth.user_id).wallet_address;
  }
  private pet(userId: string, petId: string): Pet {
    const row = this.repository.db.prepare('SELECT data FROM pets WHERE id=? AND user_id=?').get(petId, userId);
    if (!row) throw new ApiError(404, 'PET_NOT_FOUND', '找不到这位伙伴。');
    return JSON.parse(String(row.data)) as Pet;
  }
  private chainScope(): string {
    const config = this.config();
    return JSON.stringify([config.network, this.client!.expectedGenesisHash, this.client!.instructions.programId.toBase58()]);
  }
  canonicalClaimId(petId: string): string { return hash(JSON.stringify(['pixel-pets:claim:v1', this.chainScope(), petId])); }
  private find(scope: string): Intent | undefined {
    const row = this.repository.db.prepare('SELECT data FROM chain_intents WHERE scope=?').get(scope);
    return row ? JSON.parse(String(row.data)) as Intent : undefined;
  }
  private read(userId: string, id: string): Intent {
    const row = this.repository.db.prepare('SELECT data FROM chain_intents WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw new ApiError(404, 'INTENT_NOT_FOUND', '找不到这笔登记请求。');
    const intent = JSON.parse(String(row.data)) as Intent;
    ensure(intent.network === this.repository.network && intent.program_id === this.client!.instructions.programId.toBase58(), 'INTENT_NETWORK_MISMATCH', '这笔登记属于另一条链。');
    ensure(intent.claim_id === this.canonicalClaimId(intent.pet_id), 'INTENT_NETWORK_MISMATCH', '这笔登记属于另一条链。');
    return intent;
  }
  private save(intent: Intent): void {
    const lease = this.lease(intent.pet_id);
    const write = () => {
      lease.ownershipFence?.();
      intent.updated_at = iso(this.repository.clock());
    // The lease check and write are one SQLite statement: another process cannot
    // take over between a separate ownership read and this state update.
    const result = this.repository.db.prepare(`INSERT INTO chain_intents(id,scope,user_id,pet_id,data)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM chain_leases WHERE scope=? AND token=? AND expires_at>?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
      .run(intent.intent_id, intent.scope, intent.user_id, intent.pet_id, JSON.stringify(intent), lease.scope, lease.token, this.repository.clock());
    ensure(result.changes === 1, 'CHAIN_LEASE_LOST', '这笔请求已由新的恢复请求接管，请重新查询。');
    if (intent.source.schema === 'v2' && this.travel) {
      const landed = intent.attempts.find(a => a.state === 'confirmed') ?? [...intent.attempts].reverse().find(a => a.signature);
      this.travel.recordReceipt({ trip_id: intent.source.trip_id!, chain_intent_id: intent.intent_id,
        canonical_checkpoint: intent.source.canonical_checkpoint!, event_hash: intent.source.event_hash,
        network_genesis: intent.source.network_genesis!, program_id: intent.program_id, asset_address: intent.source.asset_address!,
        expected_checkpoint: intent.source.expected_checkpoint!, signature: landed?.signature ?? null,
        finalized_slot: landed?.finalized_slot ?? null, status: intent.state });
    }
    };
    // Keep the ownership fence and write atomic across server processes as well.
    if (this.repository.db.isTransaction) write(); else this.repository.transaction(write);
  }
  private lease(petId: string) {
    const lease = this.leases.get(petId);
    ensure(lease && !lease.lost, 'CHAIN_LEASE_LOST', '这笔请求已由新的恢复请求接管，请重新查询。');
    return lease!;
  }
  private response(intent: Intent) {
    // RPC history can reveal that an earlier attempt landed after a newer one
    // was prepared. Return the attempt actually finalized, never its replacement.
    const selected = intent.state === 'confirmed'
      ? intent.attempts.find(attempt => attempt.state === 'confirmed') : intent.attempts.at(-1);
    const { user_id: _user, scope: _scope, source: _source, attempts, ...visible } = intent;
    // This response is restricted to the same authenticated wallet. Exact signed bytes
    // allow retry after an uncertain RPC submission without creating another transaction.
    const packet: Partial<Attempt> = selected ?? {};
    const journey = intent.source.schema === 'v2' ? { schema: 'pixel-pets:checkpoint:v2', trip_id: intent.source.trip_id,
      public_receipt_id: intent.source.public_receipt_id, result_hash: intent.source.result_hash,
      canonical_checkpoint: intent.source.canonical_checkpoint, event_hash: intent.source.event_hash } : null;
    return { ...visible, ...packet, state: intent.state, journey,
      pet: this.pet(intent.user_id, intent.pet_id),
      attempts: attempts.map(a => ({ attempt: a.attempt, state: a.state, signature: a.signature ?? null,
        asset_address: a.asset_address, expires_at: a.expires_at, finalized_slot: a.finalized_slot ?? null })) };
  }
  private async exclusive<T>(petId: string, operation: () => Promise<T>, ownershipFence?: () => void): Promise<T> {
    const key = `${this.chainScope()}:${petId}`;
    const previous = this.queue.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const token = randomUUID(); const now = this.repository.clock();
      this.repository.transaction(() => {
        this.repository.db.prepare('DELETE FROM chain_leases WHERE scope=? AND expires_at<=?').run(key, now);
        const result = this.repository.db.prepare('INSERT OR IGNORE INTO chain_leases VALUES (?,?,?)').run(key, token, now + 120000);
        ensure(result.changes === 1, 'CHAIN_BUSY', '上一笔请求仍在核对，请稍后恢复。');
      });
      const lease = { scope: key, token, lost: false, ownershipFence };
      this.leases.set(petId, lease);
      // A complete verification performs several bounded RPC reads. Renew only our
      // own token so a legitimate slow operation cannot outlive its SQLite lease.
      const renewal = setInterval(() => {
        try {
          const now = this.repository.clock();
          const renewed = this.repository.db.prepare('UPDATE chain_leases SET expires_at=? WHERE scope=? AND token=? AND expires_at>?')
            .run(now + 120000, key, token, now);
          if (renewed.changes !== 1) lease.lost = true;
        } catch { /* Writes remain fenced by the original lease deadline. */ }
      }, 30000);
      renewal.unref();
      try {
        const result = await operation();
        this.lease(petId);
        ensure(this.repository.db.prepare('SELECT 1 FROM chain_leases WHERE scope=? AND token=? AND expires_at>?')
          .get(key, token, this.repository.clock()), 'CHAIN_LEASE_LOST', '这笔请求已由新的恢复请求接管，请重新查询。');
        return result;
      } finally {
        clearInterval(renewal); this.leases.delete(petId);
        this.repository.db.prepare('DELETE FROM chain_leases WHERE scope=? AND token=?').run(key, token);
      }
    });
    this.queue.set(key, next);
    try { return await next; } finally { if (this.queue.get(key) === next) this.queue.delete(key); }
  }
  private async ready(): Promise<void> {
    const config = this.config();
    await this.client!.assertDeployment();
    const chainConfig = await this.client!.fetchConfig('finalized');
    ensure(chainConfig.issuer.equals(config.issuer.publicKey), 'ISSUER_MISMATCH', '签发方与链上配置不一致。', 503);
    ensure(!chainConfig.paused, 'PROTOCOL_PAUSED', '链上登记暂时暂停。', 503);
  }
  async publicConfig() {
    const config = this.configuration;
    const result = { network: this.repository.network, program_id: config?.programId ?? null,
      collection_address: config?.collectionAddress ?? null, issuer_address: config?.issuer.publicKey.toBase58() ?? null,
      enabled: false, rpc_url: config ? publicRpc(config.publicRpcUrl) : null,
      genesis_hash: this.client?.expectedGenesisHash ?? null, reason: 'CHAIN_DISABLED' };
    if (!config) return result;
    try {
      await this.ready();
      for (const [species, id] of Object.entries(config.editions)) {
        const edition = await this.client!.fetchEdition(id, 'finalized');
        ensure(edition.species === speciesIds.indexOf(species as typeof speciesIds[number]), 'EDITION_MISMATCH', '物种版本与配置不一致。', 503);
      }
      return { ...result, enabled: true, reason: null };
    } catch (error) {
      return { ...result, reason: error instanceof ApiError || error instanceof ChainClientError ? error.code : 'RPC_UNAVAILABLE' };
    }
  }
  private newIntent(userId: string, wallet: string, pet: Pet, kind: Kind, scope: string, trip?: TripCheckpointSource): Intent {
    const config = this.config(); const now = iso(this.repository.clock()); const claimId = this.canonicalClaimId(pet.id);
    if (trip) {
      // v2 source is frozen here, including the expected checkpoint the transaction must advance.
      const intentId = randomUUID(); const expected = pet.chain.checkpoint ?? '0';
      ensure(/^(0|[1-9]\d{0,19})$/.test(expected), 'PROGRESSION_CONFLICT', '链上成长序号无效，请先同步伙伴。');
      const values = { network_genesis: this.client!.expectedGenesisHash, program_id: this.client!.instructions.programId.toBase58(),
        asset_address: pet.chain.asset_address!, chain_intent_id: intentId, expected_checkpoint: expected, pet_revision: pet.revision,
        form: formIds.indexOf(pet.form), bond: pet.bond, care_count: pet.care_count, traits_sun: pet.traits.sun, traits_moon: pet.traits.moon,
        public_receipt_id: trip.public_receipt_id, result_hash: trip.result_hash };
      const canonical = canonicalJson(checkpointV2Array(values));
      return { intent_id: intentId, scope, user_id: userId, pet_id: pet.id, wallet_address: wallet, kind, state: 'prepared',
        network: config.network, program_id: values.program_id, collection_address: config.collectionAddress, claim_id: claimId,
        edition_id: config.editions[pet.species_id as typeof speciesIds[number]], source_revision: pet.revision,
        source: { form: values.form, bond: pet.bond, species: speciesIds.indexOf(pet.species_id as typeof speciesIds[number]),
          event_hash: sha256Hex(canonical), schema: 'v2', trip_id: trip.trip_id, public_receipt_id: trip.public_receipt_id,
          result_hash: trip.result_hash, canonical_checkpoint: canonical, expected_checkpoint: expected,
          asset_address: values.asset_address, network_genesis: values.network_genesis },
        attempts: [], created_at: now, updated_at: now };
    }
    return { intent_id: randomUUID(), scope, user_id: userId, pet_id: pet.id, wallet_address: wallet, kind, state: 'prepared',
      network: config.network, program_id: this.client!.instructions.programId.toBase58(), collection_address: config.collectionAddress,
      claim_id: claimId, edition_id: config.editions[pet.species_id as typeof speciesIds[number]], source_revision: pet.revision,
      source: { form: formIds.indexOf(pet.form), bond: pet.bond, species: speciesIds.indexOf(pet.species_id as typeof speciesIds[number]),
        event_hash: hash(JSON.stringify(['pixel-pets:checkpoint:v1', claimId, pet.revision, pet.form, pet.bond, pet.care_count, pet.traits.sun, pet.traits.moon])) },
      attempts: [], created_at: now, updated_at: now };
  }
  async prepare(auth: WalletAuth, petId: string, kind: Kind, input: unknown, ownershipFence?: () => void, trip?: TripCheckpointSource) {
    const wallet = this.wallet(auth); objectBody(input, []); this.config(); this.pet(auth.user_id, petId);
    ensure(!trip || (kind === 'checkpoint' && trip.pet_id === petId), 'TRIP_PET_MISMATCH', '旅程与伙伴不一致。', 400);
    return this.exclusive(petId, async () => {
      await this.ready();
      const pet = this.pet(auth.user_id, petId);
      const scope = `${this.chainScope()}:${petId}:${kind}${trip ? `:trip:${trip.trip_id}` : kind === 'checkpoint' ? `:${pet.revision}` : ''}`;
      let intent = this.find(scope);
      if (intent) {
        await this.reconcile(intent);
        if (intent.state === 'confirmed' || intent.state === 'pending') return this.response(intent);
        const latest = intent.attempts.at(-1);
        if (latest && latest.state === 'prepared') return this.response(intent);
        // Even a server-clock expiry cannot retire a still-valid blockhash.
        if (latest && await this.config().rpc.getBlockHeight('finalized') <= latest.last_valid_block_height && latest.state !== 'failed') return this.response(intent);
      } else {
        if (trip) ensure(pet.chain.status === 'registered' && !!pet.chain.asset_address, 'PET_NOT_REGISTERED', '请先完成这位伙伴的链上领取。');
        intent = this.newIntent(auth.user_id, wallet, pet, kind, scope, trip);
      }
      ensure(intent.wallet_address === wallet, 'WALLET_MISMATCH', '请使用创建此请求的钱包。', 403);
      if (kind === 'claim') {
        ensure(pet.chain.status !== 'registered', 'ALREADY_REGISTERED', '这位伙伴已经完成链上登记。');
        const receipt = await this.config().rpc.getAccountInfo(this.client!.pdas.claimReceipt(intent.claim_id)[0], 'finalized');
        if (receipt) {
          // An earlier wallet submission may have succeeded before the HTTP response was delivered.
          intent.state = 'pending'; this.save(intent); return this.response(intent);
        }
      } else {
        ensure(pet.chain.status === 'registered' && pet.chain.network === this.repository.network
          && pet.chain.program_id === this.client!.instructions.programId.toBase58() && !!pet.chain.asset_address,
          'PET_NOT_REGISTERED', '请先完成这位伙伴的链上领取。');
        // Do not issue a second checkpoint while another revision can still land.
        const others = this.repository.db.prepare('SELECT data FROM chain_intents WHERE pet_id=?').all(petId);
        for (const row of others) {
          const other = JSON.parse(String(row.data)) as Intent;
          if (other.kind !== 'checkpoint' || other.intent_id === intent.intent_id || other.claim_id !== intent.claim_id || other.state === 'confirmed') continue;
          await this.reconcile(other);
          if (other.state === 'prepared' || other.state === 'pending') return this.response(other);
        }
      }
      await this.build(intent, pet);
      this.repository.transaction(() => {
        this.save(intent);
        if (kind === 'claim') this.updatePet(intent, { status: 'pending', network: intent.network,
          program_id: intent.program_id, intent_id: intent.intent_id, asset_address: intent.attempts.at(-1)!.asset_address });
      });
      return this.response(intent);
    }, ownershipFence);
  }
  private async build(intent: Intent, pet: Pet): Promise<void> {
    const config = this.config(); const client = this.client!;
    const expires = Math.floor(this.repository.clock() / 1000) + (config.claimLifetimeSeconds ?? 300);
    let instruction: TransactionInstruction; let inputs: InstructionInputs; let asset: Keypair | undefined;
    if (intent.kind === 'claim') {
      const edition = await client.fetchEdition(intent.edition_id, 'finalized');
      ensure(edition.species === intent.source.species, 'EDITION_MISMATCH', '物种版本与这位伙伴不一致。');
      ensure(edition.issued < edition.max_supply, 'EDITION_EXHAUSTED', '这个版本已达到链上发行上限。');
      asset = Keypair.generate();
      inputs = { payer: intent.wallet_address, recipient: intent.wallet_address, issuer: config.issuer.publicKey.toBase58(),
        collection: config.collectionAddress, asset: asset.publicKey.toBase58(), editionId: intent.edition_id,
        claimId: intent.claim_id, expiresAt: String(expires) };
      instruction = client.instructions.claim(inputs as unknown as ClaimInput);
    } else {
      const verified = await client.verifyOfficialPet(pet.chain.asset_address!, intent.wallet_address, 'finalized');
      ensure(verified.record.active_offer.equals(PublicKey.default), 'ALREADY_LISTED', '伙伴正在挂牌，请先撤销挂牌。');
      ensure(verified.record.edition.equals(client.pdas.edition(intent.edition_id)[0]) && verified.record.species === intent.source.species,
        'PET_IDENTITY_MISMATCH', '链上伙伴与养成记录不一致。');
      ensure(verified.record.bond <= intent.source.bond && (verified.record.form === 0 || verified.record.form === intent.source.form),
        'PROGRESSION_CONFLICT', '链上成长记录与服务端不同，需要先恢复记录。');
      // The v2 commitment names the checkpoint it advances; never sign it against a different sequence.
      ensure(intent.source.schema !== 'v2' || (verified.record.checkpoint.toString() === intent.source.expected_checkpoint
        && pet.chain.asset_address === intent.source.asset_address), 'PROGRESSION_CONFLICT', 'Another growth record landed first. Save this journey again after syncing.');
      inputs = { owner: intent.wallet_address, issuer: config.issuer.publicKey.toBase58(), collection: config.collectionAddress,
        asset: pet.chain.asset_address!, expectedCheckpoint: verified.record.checkpoint.toString(),
        form: intent.source.form, bond: intent.source.bond, eventHash: intent.source.event_hash };
      instruction = client.instructions.checkpoint(inputs as unknown as CheckpointInput);
    }
    const prepared = await client.prepare({ payer: intent.wallet_address, instructions: [instruction],
      temporarySigners: asset ? [config.issuer, asset] : [config.issuer] });
    intent.attempts.push({ attempt: intent.attempts.length + 1, state: 'prepared', asset_address: String(inputs.asset), expires_at: iso(expires * 1000),
      transaction_base64: prepared.transactionBase64, expected_message_base64: prepared.expectedMessageBase64,
      blockhash: prepared.blockhash, last_valid_block_height: prepared.lastValidBlockHeight, required_signers: prepared.requiredSigners,
      network_fee_lamports: prepared.networkFeeLamports, simulation_logs: prepared.simulationLogs, units_consumed: prepared.unitsConsumed,
      instruction_inputs: inputs });
    intent.state = 'prepared';
  }
  private updatePet(intent: Intent, changes: Partial<Pet['chain']>): void {
    const lease = this.lease(intent.pet_id);
    lease.ownershipFence?.();
    // Read again after RPC so care/rename requests completed during a network call are never overwritten.
    const pet = this.pet(intent.user_id, intent.pet_id);
    pet.chain = { ...pet.chain, ...changes }; pet.revision += 1; pet.updated_at = iso(this.repository.clock());
    const result = this.repository.db.prepare(`UPDATE pets SET data=? WHERE id=? AND user_id=?
      AND EXISTS (SELECT 1 FROM chain_leases WHERE scope=? AND token=? AND expires_at>?)`)
      .run(JSON.stringify(pet), pet.id, intent.user_id, lease.scope, lease.token, this.repository.clock());
    ensure(result.changes === 1, 'CHAIN_LEASE_LOST', '这笔请求已由新的恢复请求接管，请重新查询。');
  }
  intentPetId(auth: WalletAuth, id: string): string {
    const wallet = this.wallet(auth); this.config(); const intent = this.read(auth.user_id, id);
    ensure(intent.wallet_address === wallet, 'WALLET_MISMATCH', '请使用创建此请求的钱包。', 403);
    return intent.pet_id;
  }
  async get(auth: WalletAuth, id: string, ownershipFence?: () => void) {
    const wallet = this.wallet(auth); this.config(); const initial = this.read(auth.user_id, id);
    ensure(initial.wallet_address === wallet, 'WALLET_MISMATCH', '请使用创建此请求的钱包。', 403);
    return this.exclusive(initial.pet_id, async () => {
      const intent = this.read(auth.user_id, id); await this.reconcile(intent); return this.response(intent);
    }, ownershipFence);
  }
  async confirm(auth: WalletAuth, id: string, input: unknown, ownershipFence?: () => void) {
    const wallet = this.wallet(auth); this.config(); const body = objectBody(input, ['signature', 'transaction_base64']);
    ensure(typeof body.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(body.signature), 'INVALID_SIGNATURE', '交易签名格式无效。', 400);
    ensure(typeof body.transaction_base64 === 'string' && body.transaction_base64.length <= 8192
      && /^[A-Za-z0-9+/]+={0,2}$/.test(body.transaction_base64), 'INVALID_TRANSACTION', '交易内容格式无效。', 400);
    const initial = this.read(auth.user_id, id);
    ensure(initial.wallet_address === wallet, 'WALLET_MISMATCH', '请使用创建此请求的钱包。', 403);
    return this.exclusive(initial.pet_id, async () => {
      const intent = this.read(auth.user_id, id);
      let matched: Attempt | undefined;
      for (const attempt of intent.attempts) {
        try {
          const transaction = assertCoSignedTransaction(Buffer.from(attempt.expected_message_base64, 'base64'), String(body.transaction_base64),
            { requiredSigners: attempt.required_signers, requireAllSignatures: true });
          ensure(transaction.signature && base58(transaction.signature) === body.signature, 'SIGNATURE_MISMATCH', '签名不属于这笔完整交易。', 400);
          matched = attempt; break;
        } catch (error) {
          if (error instanceof ChainClientError && error.code === 'TRANSACTION_REPLACED') continue;
          throw error;
        }
      }
      ensure(matched, 'TRANSACTION_REPLACED', '钱包返回的交易与服务器准备的交易不同。', 400);
      matched!.signature = String(body.signature); matched!.signed_transaction_base64 = String(body.transaction_base64);
      if (matched!.state !== 'confirmed') matched!.state = 'pending';
      if (intent.state !== 'confirmed') intent.state = 'pending';
      this.save(intent); // Preserve proof before a timeout or restart; reads can now reconcile it.
      await this.reconcile(intent); return this.response(intent);
    }, ownershipFence);
  }
  private async reconcile(intent: Intent): Promise<void> {
    if (intent.state === 'confirmed') return;
    await this.client!.assertNetwork();
    const height = await this.config().rpc.getBlockHeight('finalized');
    for (const attempt of intent.attempts) {
      if (attempt.signature) {
        const status = await this.client!.queryFinalized(attempt.signature, attempt.last_valid_block_height);
        if (status.state === 'finalized') {
          const transaction = await this.config().rpc.getTransaction(attempt.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
          if (!transaction) { attempt.state = 'pending'; continue; }
          ensure(transaction.meta && transaction.meta.err === null && transaction.slot === status.slot
            && transaction.transaction.signatures[0] === attempt.signature
            && Buffer.from(transaction.transaction.message.serialize()).equals(Buffer.from(attempt.expected_message_base64, 'base64')),
            'FINALIZED_TRANSACTION_MISMATCH', 'RPC 返回的最终交易与登记请求不同。');
          await this.verifyAccounts(intent, attempt);
          attempt.state = 'confirmed'; attempt.finalized_slot = status.slot; intent.state = 'confirmed';
          this.repository.transaction(() => {
            this.save(intent);
            this.updatePet(intent, { status: 'registered', network: intent.network, program_id: intent.program_id,
              asset_address: attempt.asset_address, intent_id: intent.intent_id,
              checkpoint: intent.kind === 'checkpoint' ? (BigInt(String(attempt.instruction_inputs.expectedCheckpoint)) + 1n).toString() : '0' });
          });
          return;
        }
        if (status.state === 'failed') { attempt.state = 'failed'; continue; }
        if (status.state === 'pending') { attempt.state = 'pending'; continue; }
      }
      if (height > attempt.last_valid_block_height) attempt.state = 'expired';
      else if (Date.parse(attempt.expires_at) <= this.repository.clock() && intent.kind === 'claim') attempt.state = 'expired';
    }
    intent.state = intent.attempts.some(a => a.state === 'pending') ? 'pending' : intent.attempts.at(-1)?.state ?? 'prepared';
    this.save(intent);
  }
  private async verifyAccounts(intent: Intent, attempt: Attempt): Promise<void> {
    const client = this.client!;
    if (intent.kind === 'claim') {
      const verified = await client.verifyFinalizedClaim({ signature: attempt.signature!, claimId: intent.claim_id,
        recipient: intent.wallet_address, asset: attempt.asset_address, editionId: intent.edition_id,
        lastValidBlockHeight: attempt.last_valid_block_height });
      ensure(verified.verified, 'CLAIM_NOT_FINALIZED', '领取仍在等待最终确认。');
      if (!verified.verified) return;
      const edition = await client.fetchEdition(intent.edition_id, 'finalized');
      ensure(verified.receipt.expires_at.toString() === String(attempt.instruction_inputs.expiresAt)
        && verified.pet.record.species === intent.source.species && verified.pet.record.rules_version === edition.rules_version
        && Buffer.from(verified.pet.record.origin_hash).equals(Buffer.from(edition.origin_hash))
        && verified.receipt.rules_version === edition.rules_version
        && Buffer.from(verified.receipt.origin_hash).equals(Buffer.from(edition.origin_hash)), 'CLAIM_MISMATCH', '领取来源或版本与链上记录不一致。');
    } else {
      const verified = await client.verifyOfficialPet(attempt.asset_address, intent.wallet_address, 'finalized');
      ensure(verified.record.edition.equals(client.pdas.edition(intent.edition_id)[0]) && verified.record.species === intent.source.species
        && verified.record.checkpoint.toString() === (BigInt(String(attempt.instruction_inputs.expectedCheckpoint)) + 1n).toString()
        && verified.record.form === intent.source.form && verified.record.bond === intent.source.bond
        && Buffer.from(verified.record.event_hash).toString('hex') === intent.source.event_hash,
        'CHECKPOINT_MISMATCH', '最终成长记录与签发内容不同。');
    }
  }
}

/** Incomplete or disabled deployment does not read any key file, including the default Solana CLI wallet. */
export function chainServiceFromEnvironment(repository: Repository, env: NodeJS.ProcessEnv = process.env): ChainService {
  const required = ['CHAIN_PROGRAM_ID', 'CHAIN_COLLECTION_ADDRESS', 'CHAIN_RPC_URL', 'CHAIN_PUBLIC_RPC_URL', 'CHAIN_ISSUER_KEYPAIR_PATH', 'CHAIN_EDITIONS_JSON'];
  if (env.CHAIN_ENABLED !== 'true' || required.some(name => !env[name]) || (repository.network === 'localnet' && !env.CHAIN_GENESIS_HASH)) return new ChainService(repository);
  ensure(isAbsolute(env.CHAIN_ISSUER_KEYPAIR_PATH!), 'INVALID_ISSUER_PATH', '签发密钥必须使用明确的绝对路径。');
  publicRpc(env.CHAIN_PUBLIC_RPC_URL!);
  const bytes: unknown = JSON.parse(readFileSync(env.CHAIN_ISSUER_KEYPAIR_PATH!, 'utf8'));
  ensure(Array.isArray(bytes) && bytes.length === 64 && bytes.every(x => Number.isInteger(x) && x >= 0 && x <= 255), 'INVALID_ISSUER', '签发密钥格式无效。');
  const issuer = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  return new ChainService(repository, { network: repository.network, programId: env.CHAIN_PROGRAM_ID!, collectionAddress: env.CHAIN_COLLECTION_ADDRESS!,
    rpc: createChainRpcConnection(env.CHAIN_RPC_URL!),
    publicRpcUrl: env.CHAIN_PUBLIC_RPC_URL!, expectedGenesisHash: env.CHAIN_GENESIS_HASH, issuer,
    editions: JSON.parse(env.CHAIN_EDITIONS_JSON!) as ChainConfiguration['editions'] });
}
