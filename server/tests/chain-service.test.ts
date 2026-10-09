import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, Transaction, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import type { AccountInfo } from '@solana/web3.js';
import { publicKey as umiKey } from '@metaplex-foundation/umi';
import { Key, PluginType, getPluginHeaderV1AccountDataSerializer } from '@metaplex-foundation/mpl-core';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { getCollectionV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js';
import { getPluginRegistryV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js';
import { CORE_PROGRAM_ID, PROGRAM_ID, UPGRADEABLE_LOADER_ID, PIXEL_PETS_IDL, PixelPetsPdas,
  assertCoSignedTransaction } from '../../chain-client/src/index.ts';
import { Repository, start, ChainService, chainServiceFromEnvironment } from '../src/public.ts';
import type { ChainConfiguration, ChainRpc } from '../src/public.ts';
import type { Pet } from '../src/domain.ts';
import { ApiError } from '../src/domain.ts';
import { createChainRpcConnection } from '../src/chain-service.ts';

// Real SQLite persistence, Anchor account bytes, Core plugin records and Ed25519 signatures.
// Only RPC responses are controlled fixtures; this suite does not execute Solana programs.
const pdas = new PixelPetsPdas();
const coder = new BorshAccountsCoder(PIXEL_PETS_IDL);
const originHash = Array(32).fill(7) as number[];
const code = (expected: string) => (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === expected;
type Packet = Awaited<ReturnType<ChainService['prepare']>>;
type Prepared = Packet & { transaction_base64: string; expected_message_base64: string; asset_address: string;
  last_valid_block_height: number; instruction_inputs: Record<string, string | number>; attempt: number; required_signers: string[] };
function account(data: Uint8Array, owner = PROGRAM_ID, executable = false): AccountInfo<Buffer> {
  return { data: Buffer.from(data), owner, executable, lamports: 1, rentEpoch: 0 };
}
function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`); let result = '';
  while (n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = `1${result}`; }
  return result;
}
function signed(prepared: Prepared, wallet: Keypair) {
  const tx = Transaction.from(Buffer.from(prepared.transaction_base64, 'base64'));
  tx.partialSign(wallet);
  return { tx, signature: base58(tx.signature!), transaction_base64: tx.serialize().toString('base64') };
}
function submitted(proof: ReturnType<typeof signed>) {
  return { signature: proof.signature, transaction_base64: proof.transaction_base64 };
}
function coreAssetData(owner: PublicKey, collection: PublicKey): Buffer {
  const base = Buffer.from(getAssetV1AccountDataSerializer().serialize({ key: Key.AssetV1, owner: umiKey(owner.toBase58()),
    updateAuthority: { __kind: 'Collection', fields: [umiKey(collection.toBase58())] }, name: 'Moss', uri: 'ipfs://fixture-moss', seq: null }));
  const types = [PluginType.ImmutableMetadata, PluginType.AddBlocker]; const start = base.length + 9;
  const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: BigInt(start + types.length) });
  const registry = getPluginRegistryV1AccountDataSerializer().serialize({ key: Key.PluginRegistryV1,
    registry: types.map((pluginType, index) => ({ pluginType, offset: start + index, authority: { __kind: 'None' } })), externalRegistry: [] });
  return Buffer.concat([base, header, Buffer.from(types), registry]);
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pixel-pets-chain-service-')); const path = join(directory, 'pets.sqlite');
  let now = 1800000000000;
  const repositoryOptions = { network: 'localnet' as const, publicOrigin: 'https://pets.example.test', clock: () => now };
  const repo = new Repository(path, repositoryOptions);
  const issuer = Keypair.generate(); const admin = Keypair.generate(); const collection = Keypair.generate().publicKey;
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const state = { genesis: Keypair.generate().publicKey.toBase58(), slot: 42, height: 90, lastValidBlockHeight: 100,
    blockhash: Keypair.generate().publicKey.toBase58(), status: null as unknown, transaction: null as unknown,
    simulations: 0, simulationError: null as unknown, lookupError: false };
  const put = async (name: string, address: PublicKey, value: object) => accounts.set(address.toBase58(), account(await coder.encode(name, value)));
  const config = { admin: admin.publicKey, issuer: issuer.publicKey, collection, fee_recipient: admin.publicKey, fee_bps: 250, paused: false, bump: pdas.config()[1] };
  await put('Config', pdas.config()[0], config);
  for (let species = 0; species < 3; species++) {
    await put('Edition', pdas.edition(String(species + 1))[0], { edition_id: new BN(species + 1), max_supply: 100,
      issued: 0, origin_hash: originHash, rules_version: 1, species, name: 'Pet', uri: 'ipfs://fixture-pet', bump: pdas.edition(String(species + 1))[1] });
  }
  const program = Buffer.alloc(36); program.writeUInt32LE(2); pdas.programData()[0].toBuffer().copy(program, 4);
  const programData = Buffer.alloc(45); programData.writeUInt32LE(3); programData[12] = 1; admin.publicKey.toBuffer().copy(programData, 13);
  accounts.set(PROGRAM_ID.toBase58(), account(program, UPGRADEABLE_LOADER_ID, true));
  accounts.set(pdas.programData()[0].toBase58(), account(programData, UPGRADEABLE_LOADER_ID));
  accounts.set(CORE_PROGRAM_ID.toBase58(), account(Buffer.alloc(0), UPGRADEABLE_LOADER_ID, true));
  accounts.set(collection.toBase58(), account(getCollectionV1AccountDataSerializer().serialize({ key: Key.CollectionV1,
    updateAuthority: umiKey(pdas.config()[0].toBase58()), name: 'Pets', uri: 'ipfs://fixture-collection', numMinted: 0, currentSize: 0 }), CORE_PROGRAM_ID));
  // There is deliberately no broadcast or airdrop method on this RPC fixture.
  const rpc = {
    async getGenesisHash() { return state.genesis; },
    async getAccountInfo(address: PublicKey) { return accounts.get(address.toBase58()) ?? null; },
    async getMultipleAccountsInfoAndContext(keys: PublicKey[]) {
      const clock = Buffer.alloc(40); clock.writeBigUInt64LE(BigInt(state.slot));
      accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(clock, new PublicKey('Sysvar1111111111111111111111111111111111111')));
      return { context: { slot: state.slot }, value: keys.map(key => accounts.get(key.toBase58()) ?? null) };
    },
    async getLatestBlockhash() { return { blockhash: state.blockhash, lastValidBlockHeight: state.lastValidBlockHeight }; },
    async getFeeForMessage() { return { context: { slot: 9 }, value: 15000 }; },
    async simulateTransaction() { state.simulations++; return { context: { slot: 9 }, value: { err: state.simulationError, logs: ['test RPC simulation'], unitsConsumed: 5000 } }; },
    async getSignatureStatuses() { if (state.lookupError) throw new Error('Fixture RPC unavailable'); return { context: { slot: 9 }, value: [state.status] }; },
    async getBlockHeight() { return state.height; },
    async getTransaction() { return state.transaction; },
  } as unknown as ChainRpc;
  const configuration: ChainConfiguration = { network: 'localnet', programId: PROGRAM_ID.toBase58(), collectionAddress: collection.toBase58(),
    issuer, rpc, editions: { moss: '1', puddle: '2', wisp: '3' }, publicRpcUrl: 'http://127.0.0.1:8899', expectedGenesisHash: state.genesis, claimLifetimeSeconds: 30 };
  const service = new ChainService(repo, configuration);
  const server = await start({ repository: repo, chainService: service, port: 0 });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  async function request(method: string, route: string, body?: unknown, token?: string) {
    const response = await fetch(url + route, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; data: any; error: { code: string } } };
  }
  function player() {
    const guest = repo.guest(); const wallet = Keypair.generate();
    const challenge = repo.challenge(guest.user_id, { address: wallet.publicKey.toBase58() });
    const privateKey = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.slice(0, 32))]) });
    const session = repo.verifyWallet(guest.user_id, { challenge_id: challenge.challenge_id,
      signature: sign(null, Buffer.from(challenge.message), privateKey).toString('base64') });
    const { pet } = repo.adopt(guest.user_id, { species_id: 'moss', nickname: '苔苔', event_id: 'claim_test_adoption' }) as { pet: Pet };
    return { guest, wallet, session, auth: repo.authenticate(session.token, true), pet };
  }
  async function prepare(p: ReturnType<typeof player>) {
    const result = await service.prepare(p.auth, p.pet.id, 'claim', {});
    assert.ok(result.transaction_base64); assert.ok(result.expected_message_base64); assert.equal(result.state, 'prepared');
    return result as Prepared;
  }
  async function land(prepared: Prepared, proof: ReturnType<typeof signed>, wallet: Keypair) {
    const asset = new PublicKey(prepared.asset_address); const edition = pdas.edition(prepared.edition_id)[0];
    await put('PetRecord', pdas.petRecord(asset)[0], { asset, edition, serial: 1, origin_hash: originHash, rules_version: 1, species: 0,
      form: 0, checkpoint: new BN(0), bond: 0, event_hash: Array(32).fill(0), checkpoint_slot: new BN(9), active_offer: PublicKey.default,
      next_offer_nonce: new BN(0), bump: pdas.petRecord(asset)[1] });
    await put('ClaimReceipt', pdas.claimReceipt(prepared.claim_id)[0], { claim_id: Array.from(Buffer.from(prepared.claim_id, 'hex')),
      recipient: wallet.publicKey, asset, edition, origin_hash: originHash, rules_version: 1,
      expires_at: new BN(String(prepared.instruction_inputs.expiresAt)), bump: pdas.claimReceipt(prepared.claim_id)[1] });
    accounts.set(asset.toBase58(), account(coreAssetData(wallet.publicKey, collection), CORE_PROGRAM_ID));
    state.status = { err: null, slot: 42, confirmations: null, confirmationStatus: 'finalized' };
    state.transaction = { slot: 42, meta: { err: null }, transaction: { signatures: proof.tx.signatures.map(item => base58(item.signature!)), message: proof.tx.compileMessage() } };
  }
  async function close() {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repo.close();
    // This exact path was produced by mkdtempSync above, never supplied by configuration.
    rmSync(directory, { recursive: true, force: true });
  }
  return { repo, path, repositoryOptions, service, configuration, config, state, accounts, collection, issuer, put,
    request, player, prepare, land, close, advance: (milliseconds: number) => { now += milliseconds; } };
}

test('disabled/incomplete configuration never opens an issuer file, and configured readiness verifies deployment', async () => {
  const f = await fixture();
  try {
    const p = f.player();
    for (const env of [{ CHAIN_ISSUER_KEYPAIR_PATH: 'does-not-exist' }, { CHAIN_ENABLED: 'true', CHAIN_ISSUER_KEYPAIR_PATH: 'does-not-exist' }]) {
      const disabled = chainServiceFromEnvironment(f.repo, env);
      assert.equal((await disabled.publicConfig()).enabled, false);
      await assert.rejects(disabled.prepare(p.auth, p.pet.id, 'claim', {}), code('CHAIN_DISABLED'));
    }
    assert.equal((await f.service.publicConfig()).enabled, true);
    f.accounts.delete(PROGRAM_ID.toBase58());
    assert.equal((await f.service.publicConfig()).reason, 'PROGRAM_NOT_DEPLOYED');
    await assert.rejects(f.prepare(p), code('PROGRAM_NOT_DEPLOYED'));
    assert.equal(f.state.simulations, 0);
  } finally { await f.close(); }
});

test('HTTP chain routes require wallet sessions and isolate pet, intent and signed recovery data by owner', async () => {
  const f = await fixture();
  try {
    const a = f.player(); const b = f.player(); const prepared = await f.prepare(a);
    const proof = signed(prepared, a.wallet); await f.service.confirm(a.auth, prepared.intent_id, submitted(proof));
    for (const [method, route, body] of [
      ['POST', `/pets/${a.pet.id}/claim-intent`, {}], ['POST', `/pets/${a.pet.id}/checkpoint-intent`, {}],
      ['GET', `/chain/intents/${prepared.intent_id}`, undefined], ['POST', `/chain/intents/${prepared.intent_id}/confirm`, submitted(proof)],
    ] as const) {
      assert.equal((await f.request(method, route, body, a.guest.token)).status, 401);
      assert.equal((await f.request(method, route, body)).status, 401);
      const foreign = await f.request(method, route, body, b.session.token);
      assert.equal(foreign.status, 404); assert.equal(foreign.body.data, undefined);
    }
    const recovery = await f.request('GET', `/chain/intents/${prepared.intent_id}`, undefined, a.session.token);
    assert.equal(recovery.status, 200); assert.equal(recovery.body.data.signed_transaction_base64, proof.transaction_base64);
  } finally { await f.close(); }
});

test('parallel claim preparation is idempotent, genuinely co-signed and rejects caller-selected claim traits', async () => {
  const f = await fixture();
  try {
    const p = f.player();
    const packets = await Promise.all(Array.from({ length: 8 }, () => f.prepare(p)));
    assert.equal(new Set(packets.map(item => item.intent_id)).size, 1);
    assert.equal(new Set(packets.map(item => item.transaction_base64)).size, 1);
    assert.equal(f.state.simulations, 1);
    const prepared = packets[0];
    assertCoSignedTransaction(Buffer.from(prepared.expected_message_base64, 'base64'), prepared.transaction_base64,
      { requiredSigners: [f.issuer.publicKey, prepared.asset_address] });
    assert.equal(prepared.claim_id, f.service.canonicalClaimId(p.pet.id));
    assert.equal(prepared.instruction_inputs.recipient, p.wallet.publicKey.toBase58());
    assert.equal(f.repo.listPets(p.auth.user_id).pets[0].revision, 2);
    await assert.rejects(f.service.prepare(p.auth, p.pet.id, 'claim', { bond: 100, recipient: Keypair.generate().publicKey.toBase58() }), code('INVALID_INPUT'));
  } finally { await f.close(); }
});

test('server-clock expiry cannot issue another asset while the old blockhash can still land', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const first = await f.prepare(p); f.advance(31000);
    const expired = await f.service.prepare(p.auth, p.pet.id, 'claim', {});
    assert.equal(expired.state, 'expired'); assert.equal(expired.asset_address, first.asset_address); assert.equal(f.state.simulations, 1);
    f.state.height = 101; f.state.lastValidBlockHeight = 120; f.state.blockhash = Keypair.generate().publicKey.toBase58();
    const second = await f.prepare(p);
    assert.equal(second.intent_id, first.intent_id); assert.equal(second.claim_id, first.claim_id);
    assert.equal(second.attempt, 2); assert.notEqual(second.asset_address, first.asset_address);
    assert.equal(second.attempts[0].state, 'expired'); assert.equal(f.state.simulations, 2);
  } finally { await f.close(); }
});

test('late discovery of an older finalized attempt returns its exact asset and transaction instead of the newer attempt', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const first = await f.prepare(p); const proof = signed(first, p.wallet);
    assert.equal((await f.service.confirm(p.auth, first.intent_id, submitted(proof))).state, 'pending');
    // An RPC missing historical status initially reports the old transaction as
    // expired. A new attempt is prepared before that RPC reveals the first landing.
    f.advance(31000); f.state.height = 101; f.state.lastValidBlockHeight = 120;
    f.state.blockhash = Keypair.generate().publicKey.toBase58();
    const second = await f.prepare(p);
    assert.equal(second.attempt, 2); assert.equal(second.intent_id, first.intent_id);
    assert.notEqual(second.asset_address, first.asset_address);
    await f.land(first, proof, p.wallet);
    const confirmed = await f.service.get(p.auth, first.intent_id);
    assert.equal(confirmed.state, 'confirmed'); assert.equal(confirmed.attempt, 1);
    assert.equal(confirmed.asset_address, first.asset_address);
    assert.equal(confirmed.asset_address, confirmed.pet.chain.asset_address);
    assert.equal(confirmed.signature, proof.signature);
    assert.equal(confirmed.signed_transaction_base64, proof.transaction_base64);
    assert.equal(confirmed.transaction_base64, first.transaction_base64);
    assert.equal(confirmed.expected_message_base64, first.expected_message_base64);
    assert.equal(confirmed.finalized_slot, 42);
    assert.equal(confirmed.attempts.length, 2);
    assert.equal((await f.service.prepare(p.auth, p.pet.id, 'claim', {})).asset_address, first.asset_address);
  } finally { await f.close(); }
});

test('confirmation rejects incomplete/invalid signatures, wrong transaction signatures and injected transfers', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const prepared = await f.prepare(p); const proof = signed(prepared, p.wallet);
    await assert.rejects(f.service.confirm(p.auth, prepared.intent_id, { signature: proof.signature, transaction_base64: prepared.transaction_base64 }), code('INVALID_SIGNATURE'));
    const broken = Transaction.from(Buffer.from(proof.transaction_base64, 'base64'));
    broken.signatures.find(item => item.publicKey.equals(f.issuer.publicKey))!.signature![0] ^= 1;
    await assert.rejects(f.service.confirm(p.auth, prepared.intent_id, { signature: proof.signature,
      transaction_base64: broken.serialize({ verifySignatures: false }).toString('base64') }), code('INVALID_SIGNATURE'));
    await assert.rejects(f.service.confirm(p.auth, prepared.intent_id, { signature: '4'.repeat(88), transaction_base64: proof.transaction_base64 }), code('SIGNATURE_MISMATCH'));
    const injected = Transaction.from(Buffer.from(proof.transaction_base64, 'base64'));
    injected.add(SystemProgram.transfer({ fromPubkey: p.wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    await assert.rejects(f.service.confirm(p.auth, prepared.intent_id, { signature: proof.signature,
      transaction_base64: injected.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') }), code('TRANSACTION_REPLACED'));
    const unchanged = await f.service.get(p.auth, prepared.intent_id);
    assert.equal(unchanged.state, 'prepared'); assert.equal(unchanged.signed_transaction_base64, undefined);
  } finally { await f.close(); }
});

test('signed proof persists before RPC failure and recovers through a new repository/service instance', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const prepared = await f.prepare(p); const proof = signed(prepared, p.wallet);
    f.state.lookupError = true;
    await assert.rejects(f.service.confirm(p.auth, prepared.intent_id, submitted(proof)), /Fixture RPC unavailable/);
    f.state.lookupError = false;
    const reopened = new Repository(f.path, f.repositoryOptions);
    try {
      const service = new ChainService(reopened, f.configuration);
      const pending = await service.get(reopened.authenticate(p.session.token, true), prepared.intent_id);
      assert.equal(pending.state, 'pending'); assert.equal(pending.signed_transaction_base64, proof.transaction_base64);
      assert.equal(pending.pet.chain.status, 'pending');
      await f.land(prepared, proof, p.wallet);
      const confirmed = await service.get(p.auth, prepared.intent_id);
      assert.equal(confirmed.state, 'confirmed'); assert.equal(confirmed.pet.chain.status, 'registered');
      assert.equal(confirmed.pet.chain.asset_address, prepared.asset_address); assert.equal(confirmed.finalized_slot, 42);
      const revision = confirmed.pet.revision;
      assert.equal((await service.confirm(p.auth, prepared.intent_id, submitted(proof))).pet.revision, revision, 'confirmation replay must not mutate pet twice');
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('SQLite lease prevents parallel service entry and fences a stale response after another process recovers it', async () => {
  const f = await fixture();
  const reopened = new Repository(f.path, f.repositoryOptions);
  const recovering = new ChainService(reopened, f.configuration);
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const original = f.configuration.rpc.getSignatureStatuses;
  let calls = 0;
  f.configuration.rpc.getSignatureStatuses = async (...args) => {
    if (++calls === 1) { entered(); await held; }
    return original.apply(f.configuration.rpc, args);
  };
  try {
    const p = f.player(); const prepared = await f.prepare(p); const proof = signed(prepared, p.wallet);
    const stale = f.service.confirm(p.auth, prepared.intent_id, submitted(proof));
    // Install the rejection handler before yielding so a regression is reported as
    // an assertion failure, never as an unhandled asynchronous rejection.
    const staleResult = assert.rejects(stale, code('CHAIN_LEASE_LOST'));
    await reached;
    await assert.rejects(recovering.get(p.auth, prepared.intent_id), code('CHAIN_BUSY'));
    f.advance(120001);
    await f.land(prepared, proof, p.wallet);
    const confirmed = await recovering.get(p.auth, prepared.intent_id);
    assert.equal(confirmed.state, 'confirmed');
    const stored = reopened.db.prepare('SELECT data FROM chain_intents WHERE id=?').get(prepared.intent_id)!.data;
    const revision = confirmed.pet.revision;
    release(); await staleResult;
    assert.equal(reopened.db.prepare('SELECT data FROM chain_intents WHERE id=?').get(prepared.intent_id)!.data, stored);
    assert.equal(f.repo.listPets(p.auth.user_id).pets[0].revision, revision, 'stale confirmation must not apply a second pet update');
  } finally { release(); reopened.close(); await f.close(); }
});

test('confirmed status without the exact finalized transaction never registers a pet', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const prepared = await f.prepare(p); const proof = signed(prepared, p.wallet);
    await f.service.confirm(p.auth, prepared.intent_id, submitted(proof));
    f.state.status = { err: null, slot: 42, confirmations: 1, confirmationStatus: 'confirmed' };
    assert.equal((await f.service.get(p.auth, prepared.intent_id)).state, 'pending');
    await f.land(prepared, proof, p.wallet); const correctTransaction = f.state.transaction;
    f.state.transaction = null;
    assert.equal((await f.service.get(p.auth, prepared.intent_id)).state, 'pending');
    const unrelated = new Transaction({ feePayer: p.wallet.publicKey, recentBlockhash: f.state.blockhash })
      .add(SystemProgram.transfer({ fromPubkey: p.wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    unrelated.sign(p.wallet);
    f.state.transaction = { slot: 42, meta: { err: null }, transaction: { signatures: [proof.signature], message: unrelated.compileMessage() } };
    await assert.rejects(f.service.get(p.auth, prepared.intent_id), code('FINALIZED_TRANSACTION_MISMATCH'));
    assert.equal(f.repo.listPets(p.auth.user_id).pets[0].chain.status, 'pending');
    f.state.transaction = correctTransaction;
    assert.equal((await f.service.get(p.auth, prepared.intent_id)).state, 'confirmed');
  } finally { await f.close(); }
});

test('matching finalized transaction still requires its real receipt, official Core ownership and immutable policy', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const prepared = await f.prepare(p); const proof = signed(prepared, p.wallet);
    await f.service.confirm(p.auth, prepared.intent_id, submitted(proof)); await f.land(prepared, proof, p.wallet);
    const receiptAddress = pdas.claimReceipt(prepared.claim_id)[0].toBase58(); const receipt = f.accounts.get(receiptAddress)!;
    f.accounts.delete(receiptAddress);
    await assert.rejects(f.service.get(p.auth, prepared.intent_id), code('ACCOUNT_MISSING'));
    f.accounts.set(receiptAddress, receipt);
    f.accounts.set(prepared.asset_address, account(coreAssetData(Keypair.generate().publicKey, f.collection), CORE_PROGRAM_ID));
    await assert.rejects(f.service.get(p.auth, prepared.intent_id), code('ASSET_OWNER_MISMATCH'));
    assert.equal(f.repo.listPets(p.auth.user_id).pets[0].chain.status, 'pending');
    await f.land(prepared, proof, p.wallet);
    assert.equal((await f.service.get(p.auth, prepared.intent_id)).pet.chain.status, 'registered');
  } finally { await f.close(); }
});

test('checkpoint uses authoritative care, retains concurrent nickname edits, and verifies the exact final progression', async () => {
  const f = await fixture();
  try {
    const p = f.player();
    await assert.rejects(f.service.prepare(p.auth, p.pet.id, 'checkpoint', {}), code('PET_NOT_REGISTERED'));
    const claim = await f.prepare(p); const claimProof = signed(claim, p.wallet);
    await f.service.confirm(p.auth, claim.intent_id, submitted(claimProof)); await f.land(claim, claimProof, p.wallet);
    await f.service.get(p.auth, claim.intent_id);
    f.repo.care(p.auth.user_id, p.pet.id, { action: 'feed', event_id: 'checkpoint_feed_1' });
    const checkpoint = await f.service.prepare(p.auth, p.pet.id, 'checkpoint', {}) as Prepared;
    assert.equal(checkpoint.instruction_inputs.bond, 1);
    assert.equal(checkpoint.instruction_inputs.form, 0);
    assert.equal(checkpoint.instruction_inputs.expectedCheckpoint, '0');
    assert.equal(checkpoint.asset_address, claim.asset_address);
    assert.deepEqual(new Set(checkpoint.required_signers), new Set([p.wallet.publicKey.toBase58(), f.issuer.publicKey.toBase58()]));
    await assert.rejects(f.service.prepare(p.auth, p.pet.id, 'checkpoint', { bond: 999 }), code('INVALID_INPUT'));
    f.repo.rename(p.auth.user_id, p.pet.id, { nickname: '小苔苔' });
    assert.equal((await f.service.prepare(p.auth, p.pet.id, 'checkpoint', {})).intent_id, checkpoint.intent_id,
      'a later revision must wait for an earlier checkpoint while its blockhash is still valid');
    const proof = signed(checkpoint, p.wallet);
    f.state.status = null; f.state.transaction = null;
    assert.equal((await f.service.confirm(p.auth, checkpoint.intent_id, submitted(proof))).state, 'pending');
    const recordAddress = pdas.petRecord(new PublicKey(checkpoint.asset_address))[0];
    const originalRecord = coder.decode('PetRecord', f.accounts.get(recordAddress.toBase58())!.data);
    await f.put('PetRecord', recordAddress, { ...originalRecord, checkpoint: new BN(1), bond: 2,
      event_hash: Array.from(Buffer.from(String(checkpoint.instruction_inputs.eventHash), 'hex')) });
    f.state.status = { err: null, slot: 43, confirmations: null, confirmationStatus: 'finalized' };
    f.state.transaction = { slot: 43, meta: { err: null }, transaction: {
      signatures: proof.tx.signatures.map(item => base58(item.signature!)), message: proof.tx.compileMessage() } };
    await assert.rejects(f.service.get(p.auth, checkpoint.intent_id), code('CHECKPOINT_MISMATCH'));
    await f.put('PetRecord', recordAddress, { ...originalRecord, checkpoint: new BN(1), bond: 1,
      event_hash: Array.from(Buffer.from(String(checkpoint.instruction_inputs.eventHash), 'hex')) });
    const confirmed = await f.service.get(p.auth, checkpoint.intent_id);
    assert.equal(confirmed.state, 'confirmed'); assert.equal(confirmed.pet.chain.checkpoint, '1');
    assert.equal(confirmed.pet.nickname, '小苔苔'); assert.equal(confirmed.pet.bond, 1);
  } finally { await f.close(); }
});

test('RPC transport aborts stalled headers and response bodies, and never retries rate limits internally', async () => {
  let mode: 'headers' | 'body' | 'rate-limit' = 'headers'; let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (mode === 'body') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); }
    else if (mode === 'rate-limit') { response.writeHead(429); response.end('fixture rate limit'); }
    // The other two modes deliberately keep the HTTP connection open.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const next of ['headers', 'body'] as const) {
      mode = next; const before = Date.now();
      await assert.rejects(createChainRpcConnection(endpoint, 100).getGenesisHash(), code('RPC_TIMEOUT'));
      assert.ok(Date.now() - before < 2000, 'stalled HTTP must be aborted, not left in the background');
    }
    mode = 'rate-limit'; const before = requests;
    await assert.rejects(createChainRpcConnection(endpoint, 1000).getGenesisHash(), /429/);
    assert.equal(requests - before, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('a failed on-chain attempt can retry with one canonical receipt identity and a new transaction', async () => {
  const f = await fixture();
  try {
    const p = f.player(); const first = await f.prepare(p); const proof = signed(first, p.wallet);
    f.state.status = { err: { InstructionError: [0, 'Custom'] }, slot: 42, confirmations: null, confirmationStatus: 'finalized' };
    assert.equal((await f.service.confirm(p.auth, first.intent_id, submitted(proof))).state, 'failed');
    const retry = await f.prepare(p);
    assert.equal(retry.intent_id, first.intent_id); assert.equal(retry.claim_id, first.claim_id);
    assert.notEqual(retry.asset_address, first.asset_address); assert.equal(retry.attempt, 2);
  } finally { await f.close(); }
});

test('HTTP claim confirmation and checkpoint routes retain ownership fencing after an external transfer', async t => {
  const f = await fixture(); t.after(f.close);
  const a = f.player(); const b = f.player();
  const first = await f.request('POST', `/pets/${a.pet.id}/claim-intent`, {}, a.session.token);
  assert.equal(first.status, 200); const claim = first.body.data as Prepared; const proof = signed(claim, a.wallet);
  await f.land(claim, proof, a.wallet);
  const confirmed = await f.request('POST', `/chain/intents/${claim.intent_id}/confirm`, submitted(proof), a.session.token);
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.data.pet.chain.status, 'registered');
  const care = await f.request('POST', `/pets/${a.pet.id}/care`, { action: 'play', event_id: 'http-chain-care' }, a.session.token);
  assert.equal(care.status, 200); assert.equal(care.body.data.pet.ownership.status, 'owned');
  const checkpoint = await f.request('POST', `/pets/${a.pet.id}/checkpoint-intent`, {}, a.session.token);
  assert.equal(checkpoint.status, 200); const checkpointProof = signed(checkpoint.body.data as Prepared, a.wallet);
  f.accounts.set(claim.asset_address, account(coreAssetData(b.wallet.publicKey, f.collection), CORE_PROGRAM_ID)); f.state.slot++;
  const before = f.repo.db.prepare('SELECT data FROM chain_intents WHERE id=?').get(checkpoint.body.data.intent_id)!.data;
  const denied = await f.request('POST', `/chain/intents/${checkpoint.body.data.intent_id}/confirm`, submitted(checkpointProof), a.session.token);
  assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'PET_OWNER_CHANGED');
  assert.equal(f.repo.db.prepare('SELECT data FROM chain_intents WHERE id=?').get(checkpoint.body.data.intent_id)!.data, before);
  assert.equal((await f.request('GET', `/chain/intents/${claim.intent_id}`, undefined, a.session.token)).status, 404);
  assert.equal((await f.request('GET', `/chain/intents/${checkpoint.body.data.intent_id}`, undefined, a.session.token)).status, 404);
  const received = (await f.request('GET', '/pets', undefined, b.guest.token)).body.data.pets.find((pet: Pet) => pet.id === a.pet.id);
  assert.equal(received.bond, 0); assert.equal(received.chain.checkpoint, '0'); assert.equal(received.ownership.status, 'owned');
});

test('ownership fence prevents preparation writes after an awaited simulation loses its lease', async t => {
  const f = await fixture(); t.after(f.close); const p = f.player(); let valid = true;
  const simulate = f.configuration.rpc.simulateTransaction.bind(f.configuration.rpc);
  f.configuration.rpc.simulateTransaction = (async (...args: any[]) => {
    const value = await (simulate as any)(...args); valid = false; return value;
  }) as typeof f.configuration.rpc.simulateTransaction;
  const fence = () => { if (!valid) throw new ApiError(409, 'OWNERSHIP_LEASE_LOST', 'test ownership lease expired'); };
  await assert.rejects(f.service.prepare(p.auth, p.pet.id, 'claim', {}, fence), code('OWNERSHIP_LEASE_LOST'));
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS total FROM chain_intents').get()!.total, 0);
  assert.equal(f.repo.listPets(p.guest.user_id).pets[0].chain.status, 'unregistered');
});

test('ownership fence preserves proof but prevents final pet writes after an awaited confirmation loses its lease', async t => {
  const f = await fixture(); t.after(f.close); const p = f.player(); const claim = await f.prepare(p); const proof = signed(claim, p.wallet);
  await f.land(claim, proof, p.wallet); let valid = true;
  const getTransaction = f.configuration.rpc.getTransaction.bind(f.configuration.rpc);
  f.configuration.rpc.getTransaction = (async (...args: any[]) => {
    const value = await (getTransaction as any)(...args); valid = false; return value;
  }) as typeof f.configuration.rpc.getTransaction;
  const fence = () => { if (!valid) throw new ApiError(409, 'OWNERSHIP_LEASE_LOST', 'test ownership lease expired'); };
  await assert.rejects(f.service.confirm(p.auth, claim.intent_id, submitted(proof), fence), code('OWNERSHIP_LEASE_LOST'));
  const persisted = JSON.parse(String(f.repo.db.prepare('SELECT data FROM chain_intents WHERE id=?').get(claim.intent_id)!.data));
  assert.equal(persisted.state, 'pending'); assert.equal(persisted.attempts[0].signature, proof.signature);
  assert.equal(f.repo.listPets(p.guest.user_id).pets[0].chain.status, 'pending');
  f.configuration.rpc.getTransaction = getTransaction;
  assert.equal((await f.service.get(p.auth, claim.intent_id, () => {})).state, 'confirmed');
});
