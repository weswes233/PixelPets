import test from 'node:test';
import assert from 'node:assert/strict';
import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import type { AccountInfo } from '@solana/web3.js';
import { publicKey as umiKey } from '@metaplex-foundation/umi';
import { Key, PluginType, getPluginHeaderV1AccountDataSerializer } from '@metaplex-foundation/mpl-core';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { getCollectionV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js';
import { getPluginRegistryV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js';
import { CORE_PROGRAM_ID, PROGRAM_ID, UPGRADEABLE_LOADER_ID, PIXEL_PETS_IDL, PixelPetsPdas } from '../../chain-client/src/index.ts';
import type { ConfigAccount, PetRecordAccount, OfferAccount } from '../../chain-client/src/index.ts';
import { MarketReader } from '../src/market-reader.ts';
import type { MarketRpc } from '../src/market-reader.ts';
import { Repository, start } from '../src/public.ts';
import type { AddressInfo } from 'node:net';

const pdas = new PixelPetsPdas();
const coder = new BorshAccountsCoder(PIXEL_PETS_IDL);
const key = () => Keypair.generate().publicKey;
const uri = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq/pet.json';
const matches = (expected: string) => (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === expected;
function account(data: Uint8Array, owner = PROGRAM_ID, executable = false): AccountInfo<Buffer> {
  return { data: Buffer.from(data), owner, executable, lamports: 1, rentEpoch: 0 };
}
function coreAsset(owner: PublicKey, collection: PublicKey): Buffer {
  const base = Buffer.from(getAssetV1AccountDataSerializer().serialize({ key: Key.AssetV1, owner: umiKey(owner.toBase58()),
    updateAuthority: { __kind: 'Collection', fields: [umiKey(collection.toBase58())] }, name: '苔苔', uri, seq: null }));
  const start = base.length + 9;
  const types = [PluginType.ImmutableMetadata, PluginType.AddBlocker];
  const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: BigInt(start + types.length) });
  const registry = getPluginRegistryV1AccountDataSerializer().serialize({ key: Key.PluginRegistryV1,
    registry: types.map((pluginType, index) => ({ pluginType, offset: start + index, authority: { __kind: 'None' } })), externalRegistry: [] });
  return Buffer.concat([base, header, Buffer.from(types), registry]);
}
async function fixture() {
  const collection = key(); const maker = key();
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const catalogue: PublicKey[] = [];
  const state = { genesis: 'market-test-genesis', slot: 123, clock: 1_800_000_000n,
    rpcFailure: '' as '' | 'catalogue' | 'snapshot', catalogueCalls: 0, batchCalls: 0, accountCalls: 0,
    maxBatch: 0, beforeSnapshot: undefined as (() => void) | undefined };
  const put = async (name: string, address: PublicKey, value: object) => accounts.set(address.toBase58(), account(await coder.encode(name, value)));
  const config: ConfigAccount = { admin: maker, issuer: key(), collection, fee_recipient: key(), fee_bps: 250, paused: false, bump: pdas.config()[1] };
  await put('Config', pdas.config()[0], config);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); pdas.programData()[0].toBuffer().copy(program, 4);
  const programData = Buffer.alloc(45); programData.writeUInt32LE(3); programData[12] = 1; maker.toBuffer().copy(programData, 13);
  accounts.set(PROGRAM_ID.toBase58(), account(program, UPGRADEABLE_LOADER_ID, true));
  accounts.set(pdas.programData()[0].toBase58(), account(programData, UPGRADEABLE_LOADER_ID));
  accounts.set(CORE_PROGRAM_ID.toBase58(), account(Buffer.alloc(0), UPGRADEABLE_LOADER_ID, true));
  accounts.set(collection.toBase58(), account(getCollectionV1AccountDataSerializer().serialize({ key: Key.CollectionV1,
    updateAuthority: umiKey(pdas.config()[0].toBase58()), name: 'Pets', uri, numMinted: 1, currentSize: 1 }), CORE_PROGRAM_ID));
  const setClock = () => {
    const clock = Buffer.alloc(40); clock.writeBigUInt64LE(BigInt(state.slot)); clock.writeBigInt64LE(state.clock, 32);
    accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(clock, new PublicKey('Sysvar1111111111111111111111111111111111111')));
  };
  setClock();
  const addPet = async (asset: PublicKey, owner: PublicKey, activeOffer = PublicKey.default, nonce = '0') => {
    const record: PetRecordAccount = { asset, edition: pdas.edition('1')[0], serial: 1, origin_hash: Array(32).fill(1), rules_version: 1,
      species: 0, form: 1, checkpoint: new BN('9007199254740993'), bond: 6, event_hash: Array(32).fill(2), checkpoint_slot: new BN(90),
      active_offer: activeOffer, next_offer_nonce: new BN(nonce), bump: pdas.petRecord(asset)[1] };
    await put('PetRecord', pdas.petRecord(asset)[0], record);
    accounts.set(asset.toBase58(), account(coreAsset(owner, collection), CORE_PROGRAM_ID));
    return record;
  };
  const addOffer = async (options: { kind?: number; nonce?: string; price?: string; expiry?: bigint } = {}) => {
    const asset = key(); const nonce = options.nonce ?? '9007199254740993'; const [address, bump] = pdas.offer(asset, nonce);
    const kind = options.kind ?? 1; const desired = kind === 0 ? key() : PublicKey.default;
    const record = await addPet(asset, address, address, (BigInt(nonce) + 1n).toString());
    const desiredRecord = kind === 0 ? await addPet(desired, key()) : null;
    const offer: OfferAccount = { maker, asset, desired_asset: desired, fee_recipient: config.fee_recipient, nonce: new BN(nonce),
      expires_at: new BN((options.expiry ?? state.clock + 900n).toString()), offered_checkpoint: record.checkpoint,
      desired_checkpoint: desiredRecord?.checkpoint ?? new BN(0), price_lamports: new BN(options.price ?? (kind === 0 ? '0' : '18446744073709551615')),
      fee_bps: 250, kind, bump };
    await put('Offer', address, offer); catalogue.push(address);
    return { address, offer, record, desiredRecord };
  };
  const rpc = {
    async getGenesisHash() { return state.genesis; },
    async getAccountInfo(address: PublicKey, commitment: unknown) {
      assert.equal(commitment, 'finalized'); state.accountCalls++; return accounts.get(address.toBase58()) ?? null;
    },
    async getProgramAccounts(programId: PublicKey, options: Record<string, unknown>) {
      state.catalogueCalls++;
      if (state.rpcFailure === 'catalogue') throw new Error('fixture RPC outage');
      assert.ok(programId.equals(PROGRAM_ID)); assert.equal(options.commitment, 'finalized'); assert.equal(options.withContext, true);
      assert.deepEqual(options.filters, [{ dataSize: coder.size('Offer') }, { memcmp: coder.memcmp('Offer') }]);
      return { context: { slot: state.slot }, value: catalogue.map(pubkey => ({ pubkey, account: accounts.get(pubkey.toBase58())! })) };
    },
    async getMultipleAccountsInfoAndContext(addresses: PublicKey[], options: Record<string, unknown>) {
      state.batchCalls++; state.maxBatch = Math.max(state.maxBatch, addresses.length);
      if (state.rpcFailure === 'snapshot') throw new Error('fixture RPC outage');
      assert.equal(options.commitment, 'finalized');
      if (options.minContextSlot !== undefined) assert.equal(options.minContextSlot, state.slot);
      state.beforeSnapshot?.();
      return { context: { slot: state.slot }, value: addresses.map(address => accounts.get(address.toBase58()) ?? null) };
    },
  } as unknown as MarketRpc;
  const options = { rpc, network: 'localnet' as const, expectedGenesisHash: state.genesis, programId: PROGRAM_ID.toBase58(), collectionAddress: collection.toBase58() };
  return { reader: new MarketReader(options), rpc, options, accounts, catalogue, state, config, collection, maker, put, addOffer, addPet, setClock };
}

test('catalogue preserves all u64 prices, fee rounding, nonces and checkpoints', async () => {
  const f = await fixture(); const row = await f.addOffer();
  const page = await f.reader.list();
  assert.equal(page.slot, 123); assert.equal(page.chain_time, '1800000000'); assert.equal(page.offers.length, 1);
  assert.deepEqual(page.rejected, []); assert.equal(page.has_more, false);
  const card = page.offers[0];
  assert.equal(card.price_lamports, '18446744073709551615'); assert.equal(card.fee_lamports, '461168601842738790');
  assert.equal(card.seller_lamports, '17985575471866812825'); assert.equal(card.nonce, '9007199254740993');
  assert.equal(card.pet.checkpoint, '9007199254740993'); assert.equal(card.pet.species_id, 'moss'); assert.equal(card.pet.form, 'sun');
  assert.equal(card.pet.owner_address, row.address.toBase58()); assert.equal(card.can_settle, true);
  assert.equal(f.state.batchCalls, 1); assert.equal(f.state.accountCalls, 3);
});

test('swaps display the verified target pet and no SOL charge', async () => {
  const f = await fixture(); const row = await f.addOffer({ kind: 0 });
  const { offer } = await f.reader.detail(row.offer.asset.toBase58(), row.offer.nonce.toString());
  assert.equal(offer.kind, 'swap'); assert.equal(offer.price_lamports, '0'); assert.equal(offer.fee_lamports, '0');
  assert.equal(offer.desired_pet?.asset_address, row.offer.desired_asset.toBase58());
  assert.equal(f.state.catalogueCalls, 0);
});

test('fee schedule is the offer snapshot; paused protocol remains visible but cannot settle', async () => {
  const f = await fixture(); await f.addOffer({ price: '101' });
  f.config.fee_bps = 500; f.config.fee_recipient = key(); f.config.paused = true;
  await f.put('Config', pdas.config()[0], f.config);
  const page = await f.reader.list();
  assert.equal(page.paused, true); assert.equal(page.offers[0].fee_bps, 250); assert.equal(page.offers[0].fee_lamports, '2');
  assert.equal(page.offers[0].can_settle, false);
});

test('offer expiration uses the chain Clock and the exact boundary; details retain expired offers', async () => {
  const f = await fixture(); const expired = await f.addOffer({ expiry: f.state.clock });
  await f.addOffer({ expiry: f.state.clock + 1n });
  const page = await f.reader.list();
  assert.equal(page.offers.length, 1); assert.equal(page.rejected[0].code, 'OFFER_EXPIRED');
  const detail = await f.reader.detail(expired.offer.asset.toBase58(), expired.offer.nonce.toString());
  assert.equal(detail.offer.status, 'expired'); assert.equal(detail.offer.can_settle, false);
  f.state.clock += 1n; f.setClock();
  assert.equal((await f.reader.list()).offers.length, 0);
});

test('foreign owner and forged offer PDA never become market cards', async () => {
  const f = await fixture(); const foreign = await f.addOffer(); const forged = await f.addOffer();
  f.accounts.get(foreign.address.toBase58())!.owner = key();
  const fakeAddress = key(); f.accounts.set(fakeAddress.toBase58(), f.accounts.get(forged.address.toBase58())!);
  f.catalogue[1] = fakeAddress;
  const page = await f.reader.list();
  assert.equal(page.offers.length, 0);
  assert.deepEqual(page.rejected.map(x => x.code).sort(), ['ACCOUNT_OWNER_MISMATCH', 'PDA_MISMATCH']);
});

test('Core collection, escrow owner, active offer and checkpoint are independently checked', async () => {
  for (const variant of ['collection', 'escrow', 'active', 'checkpoint', 'nonce'] as const) {
    const f = await fixture(); const row = await f.addOffer();
    if (variant === 'collection') f.accounts.set(row.offer.asset.toBase58(), account(coreAsset(row.address, key()), CORE_PROGRAM_ID));
    if (variant === 'escrow') f.accounts.set(row.offer.asset.toBase58(), account(coreAsset(f.maker, f.collection), CORE_PROGRAM_ID));
    if (variant === 'active') row.record.active_offer = PublicKey.default;
    if (variant === 'checkpoint') row.record.checkpoint = new BN(0);
    if (variant === 'nonce') row.record.next_offer_nonce = new BN(0);
    await f.put('PetRecord', pdas.petRecord(row.offer.asset)[0], row.record);
    const page = await f.reader.list();
    assert.equal(page.offers.length, 0, variant);
    assert.equal(page.rejected[0].code, { collection: 'COLLECTION_MISMATCH', escrow: 'ASSET_OWNER_MISMATCH', active: 'OFFER_INACTIVE',
      checkpoint: 'CHECKPOINT_CHANGED', nonce: 'INVALID_NONCE' }[variant]);
  }
});

test('unknown kinds, excessive fees and invalid sale/swap payloads are rejected', async () => {
  for (const variant of ['kind', 'fee', 'price', 'target', 'swap'] as const) {
    const f = await fixture(); const row = await f.addOffer({ kind: variant === 'swap' ? 0 : 1 });
    if (variant === 'kind') row.offer.kind = 9;
    if (variant === 'fee') row.offer.fee_bps = 501;
    if (variant === 'price') row.offer.price_lamports = new BN(0);
    if (variant === 'target') row.offer.desired_asset = key();
    if (variant === 'swap') row.offer.price_lamports = new BN(1);
    await f.put('Offer', row.address, row.offer);
    assert.equal((await f.reader.list()).offers.length, 0, variant);
  }
});

test('changed or listed swap targets cannot be represented as settleable', async () => {
  for (const variant of ['checkpoint', 'listed', 'self'] as const) {
    const f = await fixture(); const row = await f.addOffer({ kind: 0 });
    if (variant === 'checkpoint') row.desiredRecord!.checkpoint = new BN(0);
    if (variant === 'listed') row.desiredRecord!.active_offer = key();
    if (variant === 'self') f.accounts.set(row.offer.desired_asset.toBase58(), account(coreAsset(f.maker, f.collection), CORE_PROGRAM_ID));
    await f.put('PetRecord', pdas.petRecord(row.offer.desired_asset)[0], row.desiredRecord!);
    const page = await f.reader.list();
    assert.equal(page.offers.length, 0); assert.equal(page.rejected[0].code,
      { checkpoint: 'DESIRED_CHECKPOINT_CHANGED', listed: 'DESIRED_PET_LISTED', self: 'SELF_TRADE' }[variant]);
  }
});

test('pagination bounds detailed validation and never skips rejected entries invisibly', async () => {
  const f = await fixture(); for (let i = 0; i < 20; i++) await f.addOffer({ kind: 0 });
  const first = await f.reader.list(); const second = await f.reader.list({ cursor: first.next_cursor! });
  assert.equal(first.scanned, 16); assert.equal(first.offers.length, 16); assert.equal(first.has_more, true);
  assert.equal(second.offers.length, 4); assert.equal(second.has_more, false);
  assert.equal(new Set([...first.offers, ...second.offers].map(x => x.offer_address)).size, 20);
  assert.ok(f.state.maxBatch <= 83); assert.equal(f.state.batchCalls, 2); assert.equal(f.state.accountCalls, 6);
  await assert.rejects(f.reader.list({ limit: 17 }), matches('INVALID_LIMIT'));
  await assert.rejects(f.reader.list({ limit: 0 }), matches('INVALID_LIMIT'));
});

test('RPC outages and missing or mismatched chain Clock throw instead of returning an empty market', async () => {
  for (const failure of ['catalogue', 'snapshot'] as const) {
    const f = await fixture(); f.state.rpcFailure = failure;
    await assert.rejects(f.reader.list(), matches('MARKET_RPC_UNAVAILABLE'));
  }
  const f = await fixture(); f.accounts.delete(SYSVAR_CLOCK_PUBKEY.toBase58());
  await assert.rejects(f.reader.list(), matches('CHAIN_CLOCK_UNAVAILABLE'));
  f.setClock(); f.accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!.data.writeBigUInt64LE(124n);
  await assert.rejects(f.reader.list(), matches('CHAIN_CLOCK_MISMATCH'));
});

test('network mismatch, canonical collection mismatch and disabled reader fail explicitly', async () => {
  const f = await fixture(); f.state.genesis = 'another-chain';
  await assert.rejects(f.reader.list(), matches('NETWORK_MISMATCH'));
  f.state.genesis = f.options.expectedGenesisHash; f.config.collection = key(); await f.put('Config', pdas.config()[0], f.config);
  await assert.rejects(f.reader.list(), matches('COLLECTION_MISMATCH'));
  await assert.rejects(new MarketReader().list(), matches('MARKET_DISABLED'));
});

test('closed offer between catalogue and snapshot is rejected, while absent detail is a 404', async () => {
  const f = await fixture(); const row = await f.addOffer();
  f.state.beforeSnapshot = () => f.accounts.delete(row.address.toBase58());
  const page = await f.reader.list(); assert.equal(page.offers.length, 0); assert.equal(page.rejected[0].code, 'OFFER_CHANGED');
  f.state.beforeSnapshot = undefined;
  await assert.rejects(f.reader.detail(row.offer.asset.toBase58(), row.offer.nonce.toString()), matches('OFFER_NOT_FOUND'));
});

test('a valid empty catalogue still returns verified network, finalized slot and chain time', async () => {
  const f = await fixture(); const page = await f.reader.list();
  assert.deepEqual(page.offers, []); assert.deepEqual(page.rejected, []); assert.equal(page.scanned, 0);
  assert.equal(page.slot, 123); assert.equal(page.chain_time, '1800000000'); assert.equal(page.collection_address, f.collection.toBase58());
});

test('HTTP catalogue requires a session, exposes precise SOL strings, validates query and preserves RPC failure', async () => {
  const f = await fixture(); const row = await f.addOffer({ price: '9007199254740993' });
  const repository = new Repository(':memory:'); const guest = repository.guest();
  const server = await start({ repository, marketReader: f.reader, port: 0 });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const get = async (route: string, token?: string) => {
    const response = await fetch(base + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, payload: await response.json() as any };
  };
  try {
    assert.equal((await get('/offers')).status, 401);
    const list = await get('/offers?limit=1', guest.token); assert.equal(list.status, 200);
    assert.equal(list.payload.data.offers[0].price_sol, '9007199.254740993');
    assert.equal(list.payload.data.offers[0].price_lamports, '9007199254740993');
    const detail = await get(`/offers/${row.offer.asset.toBase58()}/${row.offer.nonce.toString()}`, guest.token);
    assert.equal(detail.payload.data.offer.offer_address, row.address.toBase58());
    assert.equal((await get('/offers?limit=1&limit=2', guest.token)).status, 400);
    assert.equal((await get('/offers?wallet=ignored', guest.token)).status, 400);
    f.state.rpcFailure = 'catalogue'; const unavailable = await get('/offers', guest.token);
    assert.equal(unavailable.status, 503); assert.equal(unavailable.payload.error.code, 'MARKET_RPC_UNAVAILABLE');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repository.close();
  }
});
