import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import type { AccountInfo, Connection } from '@solana/web3.js';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { CORE_PROGRAM_ID, ChainClientError, PixelPetsClient, publicKey } from '../../chain-client/src/index.ts';
import type { OfferAccount, PetRecordAccount, RpcClient, SupportedNetwork } from '../../chain-client/src/index.ts';
import { ApiError, catalog, hash, iso } from './domain.ts';
import type { Pet } from './domain.ts';
import type { Repository } from './repository.ts';
import { speciesTemperament } from './travel-content.ts';

export type OwnershipRpc = Pick<Connection, 'getGenesisHash' | 'getMultipleAccountsInfoAndContext'>;
export type OwnershipConfiguration = {
  rpc: OwnershipRpc; network: SupportedNetwork; programId: string; collectionAddress: string; expectedGenesisHash?: string;
};
export type OwnershipAuth = { user_id: string; kind: string };
export type OwnershipView = { status: 'owned' | 'escrow' | 'unverified'; can_interact: boolean; slot: number | null; checked_at: string | null };
type AssetRow = { scope: string; pet_id: string; asset_address: string; owner_address: string; beneficiary_address: string;
  slot: number; digest: string; state: 'owned' | 'escrow'; checked_at: string; last_error: string | null };
type PetRow = { id: string; user_id: string; data: string };
type Snapshot = { slot: number; digest: string; owner: string; beneficiary: string; state: 'owned' | 'escrow'; record: PetRecordAccount };
type Lease = { scope: string; token: string; lost: boolean };
const HOLDING_USER = 'pixel-pets:ownership:holding:v1';
const MAX_REGISTERED_SCAN = 128;
const LEASE_MS = 120000;
const SYSVAR_OWNER = new PublicKey('Sysvar1111111111111111111111111111111111111');
const species = ['moss', 'puddle', 'wisp'] as const;
const forms = ['seed', 'sun', 'moon'] as const;
function ensure(value: unknown, code: string, message: string, status = 409): asserts value {
  if (!value) throw new ApiError(status, code, message);
}
function readOnlyRpc(getAccountInfo: RpcClient['getAccountInfo'], genesis: string): RpcClient {
  const forbidden = async (): Promise<never> => { throw new Error('OwnershipService never signs or broadcasts.'); };
  return { getAccountInfo, getGenesisHash: async () => genesis, getLatestBlockhash: forbidden, getFeeForMessage: forbidden,
    simulateTransaction: forbidden, getSignatureStatuses: forbidden, getBlockHeight: forbidden };
}

/** Owns only reconciliation. Callers must keep every registered-pet mutation inside withOwnedPet. */
export class OwnershipService {
  readonly repository: Repository;
  readonly configuration?: OwnershipConfiguration;
  readonly client?: PixelPetsClient;
  private readonly queue = new Map<string, Promise<unknown>>();
  constructor(repository: Repository, configuration?: OwnershipConfiguration) {
    this.repository = repository;
    if (configuration) {
      ensure(configuration.network === repository.network, 'NETWORK_MISMATCH', '资产同步与游戏网络不一致。', 500);
      ensure(configuration.collectionAddress, 'COLLECTION_REQUIRED', '资产同步必须配置官方集合。', 500);
      this.configuration = configuration;
      this.client = new PixelPetsClient({ ...configuration, expectedCollection: configuration.collectionAddress,
        rpc: readOnlyRpc(async () => null, configuration.expectedGenesisHash ?? ''), commitment: 'finalized' });
    }
    repository.db.exec(`CREATE TABLE IF NOT EXISTS ownership_assets (
      scope TEXT PRIMARY KEY, pet_id TEXT UNIQUE NOT NULL REFERENCES pets(id), asset_address TEXT NOT NULL,
      owner_address TEXT NOT NULL, beneficiary_address TEXT NOT NULL, slot INTEGER NOT NULL,
      digest TEXT NOT NULL, state TEXT NOT NULL, checked_at TEXT NOT NULL, last_error TEXT);
      CREATE INDEX IF NOT EXISTS ownership_beneficiary ON ownership_assets(beneficiary_address);
      CREATE TABLE IF NOT EXISTS ownership_leases (scope TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ownership_transfers (
        id TEXT PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES pets(id), from_user_id TEXT NOT NULL REFERENCES users(id),
        to_wallet TEXT NOT NULL, slot INTEGER NOT NULL, previous_data TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(pet_id,slot));`);
  }
  private config(): OwnershipConfiguration {
    ensure(this.configuration && this.client, 'OWNERSHIP_DISABLED', '暂时无法核验链上伙伴归属，请稍后重试；未登记伙伴仍可照顾。', 503);
    return this.configuration;
  }
  private scope(asset: string): string {
    const config = this.config();
    return JSON.stringify([config.network, this.client!.expectedGenesisHash, config.programId, config.collectionAddress, asset]);
  }
  private row(petId: string): PetRow {
    const row = this.repository.db.prepare('SELECT id,user_id,data FROM pets WHERE id=?').get(petId) as PetRow | undefined;
    ensure(row, 'PET_NOT_FOUND', '找不到这位伙伴。', 404); return row;
  }
  private tracked(petId: string): AssetRow | undefined {
    return this.repository.db.prepare('SELECT * FROM ownership_assets WHERE pet_id=?').get(petId) as AssetRow | undefined;
  }
  private minimumSlot(petId: string): number {
    let minimum = this.tracked(petId)?.slot ?? 0;
    // A just-confirmed checkpoint can be newer than the most recent ownership scan.
    // Reuse the transaction evidence instead of accepting an older bank on first sync.
    if (this.repository.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chain_intents'").get()) {
      for (const row of this.repository.db.prepare('SELECT data FROM chain_intents WHERE pet_id=?').all(petId)) {
        const intent = JSON.parse(String(row.data)) as { attempts?: { state?: string; finalized_slot?: number }[] };
        for (const attempt of intent.attempts ?? []) if (attempt.state === 'confirmed' && Number.isSafeInteger(attempt.finalized_slot)) {
          minimum = Math.max(minimum, attempt.finalized_slot!);
        }
      }
    }
    return minimum;
  }
  private wallet(userId: string): string | undefined {
    const row = this.repository.db.prepare('SELECT address FROM wallets WHERE user_id=?').get(userId);
    return row ? String(row.address) : undefined;
  }
  private assertPetScope(pet: Pet): string {
    const config = this.config();
    ensure(pet.chain.status === 'registered' && pet.chain.network === config.network && pet.chain.program_id === config.programId
      && pet.chain.asset_address, 'PET_NETWORK_MISMATCH', '这位伙伴的登记不属于当前网络。');
    return publicKey(pet.chain.asset_address).toBase58();
  }
  private fence(lease: Lease): void {
    ensure(!lease.lost && this.repository.db.prepare('SELECT 1 FROM ownership_leases WHERE scope=? AND token=? AND expires_at>?')
      .get(lease.scope, lease.token, this.repository.clock()), 'OWNERSHIP_LEASE_LOST', '归属核验已由另一项请求接管，请刷新。');
  }
  private async exclusive<T>(scope: string, operation: (lease: Lease) => Promise<T>): Promise<T> {
    const previous = this.queue.get(scope) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const lease: Lease = { scope, token: randomUUID(), lost: false };
      this.repository.transaction(() => {
        const now = this.repository.clock();
        this.repository.db.prepare('DELETE FROM ownership_leases WHERE scope=? AND expires_at<=?').run(scope, now);
        const inserted = this.repository.db.prepare('INSERT OR IGNORE INTO ownership_leases VALUES (?,?,?)').run(scope, lease.token, now + LEASE_MS);
        ensure(inserted.changes === 1, 'OWNERSHIP_BUSY', '伙伴的归属正在同步，请稍后再试。');
      });
      const renewal = setInterval(() => {
        try {
          const now = this.repository.clock();
          if (this.repository.db.prepare('UPDATE ownership_leases SET expires_at=? WHERE scope=? AND token=? AND expires_at>?')
            .run(now + LEASE_MS, scope, lease.token, now).changes !== 1) lease.lost = true;
        } catch { /* The original lease remains the write boundary. */ }
      }, 30000);
      renewal.unref();
      try { const result = await operation(lease); this.fence(lease); return result; }
      finally { clearInterval(renewal); this.repository.db.prepare('DELETE FROM ownership_leases WHERE scope=? AND token=?').run(scope, lease.token); }
    });
    this.queue.set(scope, next);
    try { return await next; } finally { if (this.queue.get(scope) === next) this.queue.delete(scope); }
  }
  private async snapshot(asset: string, minimumSlot: number): Promise<Snapshot> {
    const config = this.config(); const client = this.client!;
    const genesis = await config.rpc.getGenesisHash();
    ensure(genesis === client.expectedGenesisHash, 'NETWORK_MISMATCH', '链上网络不匹配，已停止归属同步。', 503);
    const keys = [client.instructions.programId, client.pdas.programData()[0], CORE_PROGRAM_ID, client.pdas.config()[0],
      publicKey(config.collectionAddress), SYSVAR_CLOCK_PUBKEY, publicKey(asset), client.pdas.petRecord(asset)[0]];
    const readOnce = async (addresses: PublicKey[], minSlot: number) => {
      const response = await config.rpc.getMultipleAccountsInfoAndContext(addresses, { commitment: 'finalized', minContextSlot: minSlot });
      ensure(Number.isSafeInteger(response.context.slot) && response.context.slot >= minSlot && response.value.length === addresses.length,
        'STALE_OWNERSHIP_SNAPSHOT', '归属快照过旧或不完整，请重试。', 503);
      const accounts = new Map(addresses.map((key, index) => [key.toBase58(), response.value[index]]));
      const clock = accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58());
      if (!(clock && clock.owner.equals(SYSVAR_OWNER) && !clock.executable && clock.data.length === 40
        && clock.data.readBigUInt64LE(0) === BigInt(response.context.slot))) {
        throw new ApiError(503, 'OWNERSHIP_CLOCK_MISMATCH', '无法确认资产快照的一致性。', {
          snapshot_slot: response.context.slot,
          clock_slot: clock?.data.length === 40 ? clock.data.readBigUInt64LE(0).toString() : null,
        });
      }
      const reader = new PixelPetsClient({ ...config, expectedCollection: config.collectionAddress,
        rpc: readOnlyRpc(async key => accounts.get(key.toBase58()) ?? null, genesis), commitment: 'finalized' });
      await reader.assertDeployment();
      const assetInfo = accounts.get(asset);
      ensure(assetInfo && !assetInfo.executable && assetInfo.owner.equals(CORE_PROGRAM_ID), 'ACCOUNT_OWNER_MISMATCH', '宠物资产不存在或不属于 Core。');
      for (const [address, name] of [[reader.pdas.config()[0], 'Config'], [reader.pdas.petRecord(asset)[0], 'PetRecord']] as const) {
        const info = accounts.get(address.toBase58());
        ensure(info && !info.executable && info.data.length === reader.accountCoder.size(name), 'INVALID_ACCOUNT_DATA', '游戏账户长度或类型无效。');
      }
      const collectionInfo = accounts.get(config.collectionAddress);
      ensure(collectionInfo && !collectionInfo.executable, 'INVALID_COLLECTION', '官方集合账户无效。');
      const [base] = getAssetV1AccountDataSerializer().deserialize(assetInfo.data);
      const verified = await reader.verifyOfficialPet(asset, base.owner);
      const record = verified.record;
      ensure(species[record.species] && forms[record.form] && Number.isSafeInteger(record.bond) && record.bond >= 0 && record.bond <= 100
        && BigInt(record.checkpoint_slot.toString()) <= BigInt(response.context.slot), 'INVALID_PET_RECORD', '链上成长记录无效。');
      return { accounts, reader, verified, slot: response.context.slot };
    };
    const read = async (addresses: PublicKey[], minSlot: number) => {
      // Agave can briefly return Clock data from a different bank than response.context.
      // Discard that entire read. Bounded retries never relax the matching-slot check.
      for (let attempt = 0; ; attempt++) {
        try { return await readOnce(addresses, minSlot); }
        catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'OWNERSHIP_CLOCK_MISMATCH' || attempt >= 2) throw error;
          minSlot = Math.max(minSlot, Number(error.details?.snapshot_slot ?? minSlot));
          await delay(100 * (attempt + 1));
        }
      }
    };
    let view = await read(keys, minimumSlot);
    let state: Snapshot['state'] = 'owned'; let beneficiary: string = view.verified.coreAsset.owner;
    if (!view.verified.record.active_offer.equals(PublicKey.default)) {
      const offerAddress = view.verified.record.active_offer;
      view = await read([...keys, offerAddress], view.slot);
      const record = view.verified.record;
      ensure(record.active_offer.equals(offerAddress) && view.verified.coreAsset.owner === offerAddress.toBase58(),
        'OWNERSHIP_CHANGED', '伙伴的托管状态已变化，请刷新。');
      const offerInfo = view.accounts.get(offerAddress.toBase58());
      ensure(offerInfo && !offerInfo.executable && offerInfo.owner.equals(client.instructions.programId)
        && offerInfo.data.length === client.accountCoder.size('Offer'), 'INVALID_ESCROW', '无法验证托管挂单。');
      const offer = client.accountCoder.decode<OfferAccount>('Offer', offerInfo.data);
      const [canonical, bump] = client.pdas.offer(asset, offer.nonce);
      ensure(canonical.equals(offerAddress) && offer.bump === bump && offer.asset.equals(publicKey(asset))
        && offer.offered_checkpoint.eq(record.checkpoint) && BigInt(record.next_offer_nonce.toString()) === BigInt(offer.nonce.toString()) + 1n
        && !offer.maker.equals(PublicKey.default) && (offer.kind === 0 || offer.kind === 1), 'INVALID_ESCROW', '托管记录与宠物不一致。');
      beneficiary = offer.maker.toBase58(); state = 'escrow';
    }
    ensure(await config.rpc.getGenesisHash() === genesis, 'NETWORK_MISMATCH', '查询期间链上网络发生变化。', 503);
    const digest = hash(JSON.stringify([...view.accounts].map(([key, value]) => [key, value?.owner.toBase58(), value?.data.toString('base64')])
      .filter(([key]) => key !== SYSVAR_CLOCK_PUBKEY.toBase58())));
    return { slot: view.slot, digest, owner: view.verified.coreAsset.owner, beneficiary, state, record: view.verified.record };
  }
  private apply(petId: string, snapshot: Snapshot, lease: Lease): void {
    this.repository.transaction(() => {
      this.fence(lease);
      const row = this.row(petId); const pet = JSON.parse(row.data) as Pet;
      const asset = this.assertPetScope(pet); ensure(this.scope(asset) === lease.scope, 'OWNERSHIP_CHANGED', '伙伴的登记已变化。');
      ensure(snapshot.slot >= this.minimumSlot(petId), 'STALE_OWNERSHIP_SNAPSHOT', '归属快照落后于已确认的成长登记。', 503);
      ensure(pet.chain.checkpoint === undefined || BigInt(snapshot.record.checkpoint.toString()) >= BigInt(pet.chain.checkpoint),
        'STALE_OWNERSHIP_SNAPSHOT', '归属快照落后于已保存的成长记录。', 503);
      const previous = this.tracked(petId);
      ensure(!previous || previous.scope === lease.scope, 'PET_NETWORK_MISMATCH', '档案存在其他网络的资产记录。');
      ensure(!previous || snapshot.slot >= previous.slot, 'STALE_OWNERSHIP_SNAPSHOT', '不能用旧快照覆盖最新归属。', 503);
      ensure(!previous || snapshot.slot !== previous.slot || snapshot.digest === previous.digest,
        'CONFLICTING_OWNERSHIP_SNAPSHOT', '同一最终区块返回了不同资产状态。', 503);
      const previousBeneficiary = previous?.beneficiary_address ?? this.wallet(row.user_id);
      const transferred = previousBeneficiary !== snapshot.beneficiary;
      const binding = this.repository.db.prepare('SELECT user_id FROM wallets WHERE address=?').get(snapshot.beneficiary);
      const nextUser = snapshot.state === 'owned' && binding ? String(binding.user_id) : HOLDING_USER;
      const now = iso(this.repository.clock());
      if (nextUser === HOLDING_USER) this.repository.db.prepare('INSERT OR IGNORE INTO users(id,created_at) VALUES (?,?)').run(HOLDING_USER, now);
      if (transferred) {
        // Historical private notes keep their original user_id. Never copy them to a buyer.
        this.repository.db.prepare('INSERT INTO ownership_transfers VALUES (?,?,?,?,?,?,?)')
          .run(randomUUID(), petId, row.user_id, snapshot.beneficiary, snapshot.slot, JSON.stringify(pet), now);
        pet.species_id = species[snapshot.record.species]; pet.nickname = catalog.species[snapshot.record.species].name;
        pet.form = forms[snapshot.record.form]; pet.bond = snapshot.record.bond;
        pet.energy = 80; pet.mood = 70; pet.care_count = 0; pet.traits = { sun: 0, moon: 0 };
        pet.favorite = pet.species_id === 'moss' ? 'sun' : 'moon'; pet.created_at = now;
        // Temperament is part of the private relationship; the receiver starts from the species base.
        pet.temperament = speciesTemperament[pet.species_id];
        pet.chain = { status: 'registered', network: this.configuration!.network, program_id: this.configuration!.programId,
          asset_address: asset, checkpoint: snapshot.record.checkpoint.toString() };
        Object.assign(pet.chain, { received: true });
      } else {
        ensure(pet.species_id === species[snapshot.record.species], 'PET_SPECIES_MISMATCH', '本地物种与链上身份不一致。');
        // Adopt chain advances, but keep this same owner's legitimate unsaved care progress.
        if (snapshot.record.bond > pet.bond) pet.bond = snapshot.record.bond;
        if (snapshot.record.form !== 0 && pet.form !== forms[snapshot.record.form]) pet.form = forms[snapshot.record.form];
        pet.chain.checkpoint = snapshot.record.checkpoint.toString();
      }
      const changed = transferred || row.user_id !== nextUser || previous?.state !== snapshot.state || JSON.stringify(pet) !== row.data;
      if (changed) {
        pet.revision += 1; pet.updated_at = now;
        this.repository.db.prepare('UPDATE pets SET user_id=?,data=?,last_care_at=CASE WHEN ? THEN NULL ELSE last_care_at END WHERE id=?')
          .run(nextUser, JSON.stringify(pet), transferred ? 1 : 0, petId);
      }
      this.repository.db.prepare(`INSERT INTO ownership_assets VALUES (?,?,?,?,?,?,?,?,?,NULL)
        ON CONFLICT(scope) DO UPDATE SET owner_address=excluded.owner_address,beneficiary_address=excluded.beneficiary_address,
          slot=excluded.slot,digest=excluded.digest,state=excluded.state,checked_at=excluded.checked_at,last_error=NULL`)
        .run(lease.scope, petId, asset, snapshot.owner, snapshot.beneficiary, snapshot.slot, snapshot.digest, snapshot.state, now);
    });
  }
  private async reconcile(petId: string, lease: Lease): Promise<void> {
    const pet = JSON.parse(this.row(petId).data) as Pet;
    try {
      const snapshot = await this.snapshot(this.assertPetScope(pet), this.minimumSlot(petId));
      this.apply(petId, snapshot, lease);
    } catch (error) {
      this.repository.transaction(() => {
        this.fence(lease);
        this.repository.db.prepare('UPDATE ownership_assets SET last_error=? WHERE pet_id=?')
          .run(error instanceof ApiError || error instanceof ChainClientError ? error.code : 'OWNERSHIP_RPC_UNAVAILABLE', petId);
      });
      if (error instanceof ApiError || error instanceof ChainClientError) throw error;
      throw new ApiError(503, 'OWNERSHIP_RPC_UNAVAILABLE', '暂时无法确认链上归属，请稍后再试；未登记伙伴仍可照顾。');
    }
  }
  /** Callback must call fence inside each transaction after any await, immediately before writing. */
  async withOwnedPet<T>(auth: OwnershipAuth, petId: string, operation: (fence: () => void) => T | Promise<T>): Promise<T> {
    const row = this.row(petId); const pet = JSON.parse(row.data) as Pet;
    const tracked = this.tracked(petId);
    const wallet = this.wallet(auth.user_id);
    ensure(row.user_id === auth.user_id || (tracked && tracked.beneficiary_address === wallet), 'PET_NOT_FOUND', '找不到这位伙伴。', 404);
    if (pet.chain.status !== 'registered') return await operation(() => {
      const current = this.row(petId);
      ensure(current.user_id === auth.user_id && (JSON.parse(current.data) as Pet).chain.status !== 'registered',
        'OWNERSHIP_CHANGED', '伙伴的链上状态发生变化，请重试。');
    });
    ensure(auth.kind === 'wallet' && wallet, 'WALLET_SESSION_REQUIRED', '请重新用持有这位伙伴的钱包签名登录。', 401);
    const asset = this.assertPetScope(pet);
    return this.exclusive(this.scope(asset), async lease => {
      await this.reconcile(petId, lease);
      const current = this.tracked(petId)!;
      ensure(current.state === 'owned', 'PET_ESCROWED', '伙伴正在市场托管，取消挂单后才能继续照顾。');
      ensure(current.owner_address === wallet && this.row(petId).user_id === auth.user_id, 'PET_OWNER_CHANGED', '伙伴已经交给新的主人，请刷新伙伴列表。', 403);
      const fence = () => {
        this.fence(lease);
        ensure(this.row(petId).user_id === auth.user_id, 'PET_OWNER_CHANGED', '伙伴的归属已经变化。', 403);
      };
      fence(); return await operation(fence);
    });
  }
  /** Registered assets known to this service only; no unverified wallet NFT import. */
  async syncWallet(auth: OwnershipAuth) {
    ensure(auth.kind === 'wallet', 'WALLET_SESSION_REQUIRED', '请先用钱包签名登录。', 401);
    const wallet = this.wallet(auth.user_id); ensure(wallet, 'WALLET_NOT_LINKED', '尚未连接钱包。', 401);
    this.config();
    const rows = this.repository.db.prepare("SELECT id,data FROM pets WHERE json_extract(data,'$.chain.status')='registered' ORDER BY id LIMIT ?")
      .all(MAX_REGISTERED_SCAN + 1) as { id: string; data: string }[];
    ensure(rows.length <= MAX_REGISTERED_SCAN, 'OWNERSHIP_INDEX_REQUIRED', '资产目录需要升级索引后才能完整同步。', 503);
    let synchronized = 0; let unavailable = 0;
    for (const row of rows) {
      const pet = JSON.parse(row.data) as Pet;
      // Do not silently exclude foreign-network assets owned by this user; their mutations stay blocked.
      try {
        const asset = this.assertPetScope(pet);
        await this.exclusive(this.scope(asset), lease => this.reconcile(row.id, lease)); synchronized++;
      } catch { unavailable++; }
    }
    return { ...this.listPets(auth.user_id), ownership: { scope: 'registered_here' as const, scanned: rows.length, synchronized, unavailable } };
  }
  listPets(userId: string): { pets: (Pet & { ownership?: OwnershipView })[] } {
    const wallet = this.wallet(userId);
    const rows = this.repository.db.prepare(`SELECT DISTINCT p.id,p.data FROM pets p LEFT JOIN ownership_assets o ON o.pet_id=p.id
      WHERE p.user_id=? OR (o.beneficiary_address=? AND o.state='escrow') ORDER BY p.rowid`).all(userId, wallet ?? '') as { id: string; data: string }[];
    return { pets: rows.map(row => {
      const pet = JSON.parse(row.data) as Pet;
      if (pet.chain.status !== 'registered') return pet;
      const record = this.tracked(pet.id);
      const validScope = this.configuration && pet.chain.network === this.configuration.network && pet.chain.program_id === this.configuration.programId;
      const verified = !!validScope && record && !record.last_error && record.beneficiary_address === wallet;
      return { ...pet, ownership: { status: verified ? record.state : 'unverified', can_interact: !!verified && record.state === 'owned',
        slot: record?.slot ?? null, checked_at: record?.checked_at ?? null } };
    }) };
  }
}
