import test from 'node:test';
import assert from 'node:assert/strict';
import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { AccountInfo, TransactionInstruction } from '@solana/web3.js';
import { publicKey as umiKey } from '@metaplex-foundation/umi';
import { Key, PluginType, getPluginHeaderV1AccountDataSerializer } from '@metaplex-foundation/mpl-core';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { getCollectionV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js';
import { getPluginRegistryV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js';
import {
  CORE_PROGRAM_ID, PROGRAM_ID, UPGRADEABLE_LOADER_ID, GENESIS_HASHES, PIXEL_PETS_IDL,
  ChainClientError, PixelPetsClient, PixelPetsInstructions, PixelPetsPdas,
  integer, u64LE, solToLamports, lamportsToSol, saleAmounts, hash32,
  assertCoSignedTransaction, createGiftInstruction, isImmutableMetadataUri,
} from '../src/index.ts';
import type { RpcClient, ConfigAccount, PetRecordAccount, OfferAccount } from '../src/index.ts';

const wallet = Keypair.generate();
const issuer = Keypair.generate();
const asset = Keypair.generate();
const recipient = Keypair.generate();
const collection = Keypair.generate().publicKey;
const feeRecipient = Keypair.generate().publicKey;
const desiredAsset = Keypair.generate().publicKey;
const pdas = new PixelPetsPdas();
const instructions = new PixelPetsInstructions();
const coder = new BorshAccountsCoder(PIXEL_PETS_IDL);
const claimId = Buffer.alloc(32, 7);
const origin = Array(32).fill(8) as number[];
const hash = Keypair.generate().publicKey.toBase58();
const signature = '4'.repeat(88);
const metadataUri = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq/metadata.json';
const code = (expected: string) => (error: unknown) => error instanceof ChainClientError && error.code === expected;

function account(data: Uint8Array, owner = PROGRAM_ID, executable = false): AccountInfo<Buffer> {
  return { data: Buffer.from(data), owner, executable, lamports: 1, rentEpoch: 0 };
}
function coreAssetData(owner: PublicKey, plugins: 'locked' | 'none' | 'delegate' | 'mutable' = 'locked'): Buffer {
  const base = Buffer.from(getAssetV1AccountDataSerializer().serialize({ key: Key.AssetV1, owner: umiKey(owner.toBase58()),
    updateAuthority: { __kind: 'Collection', fields: [umiKey(collection.toBase58())] }, name: 'Pet', uri: metadataUri, seq: null }));
  if (plugins === 'none') return base;
  const types = plugins === 'delegate' ? [PluginType.ImmutableMetadata, PluginType.AddBlocker, PluginType.TransferDelegate]
    : [PluginType.ImmutableMetadata, PluginType.AddBlocker];
  const start = base.length + 9;
  const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: BigInt(start + types.length) });
  const registry = getPluginRegistryV1AccountDataSerializer().serialize({ key: Key.PluginRegistryV1, registry: types.map((pluginType, index) => ({
    pluginType, offset: start + index, authority: { __kind: plugins === 'mutable' ? 'Owner' : 'None' },
  })), externalRegistry: [] });
  return Buffer.concat([base, header, Buffer.from(types), registry]);
}
function claimInstruction() {
  return instructions.claim({ payer: wallet.publicKey, recipient: wallet.publicKey, issuer: issuer.publicKey, collection,
    asset: asset.publicKey, editionId: '9007199254740993', claimId, expiresAt: '1800000000' });
}
async function fixture() {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const config: ConfigAccount = { admin: wallet.publicKey, issuer: issuer.publicKey, collection, fee_recipient: feeRecipient, fee_bps: 250, paused: false, bump: pdas.config()[1] };
  const record: PetRecordAccount = { asset: asset.publicKey, edition: pdas.edition('9007199254740993')[0], serial: 1,
    origin_hash: origin, rules_version: 1, species: 0, form: 0, checkpoint: new BN(0), bond: 0,
    event_hash: Array(32).fill(0), checkpoint_slot: new BN(9), active_offer: PublicKey.default, next_offer_nonce: new BN(3), bump: pdas.petRecord(asset.publicKey)[1] };
  const offer: OfferAccount = { maker: wallet.publicKey, asset: asset.publicKey, desired_asset: desiredAsset, fee_recipient: feeRecipient,
    nonce: new BN(3), expires_at: new BN(1800000000), offered_checkpoint: new BN(0), desired_checkpoint: new BN(0),
    price_lamports: new BN('9007199254740993'), fee_bps: 250, kind: 1, bump: pdas.offer(asset.publicKey, '3')[1] };
  const state = { genesis: 'local-fixture-genesis', height: 90, simulationError: null as unknown,
    fee: 15000 as number | null, status: null as unknown, transaction: null as unknown,
    simulations: [] as Record<string, unknown>[], readCommitments: [] as unknown[] };
  const put = async (name: string, address: PublicKey, value: object) => accounts.set(address.toBase58(), account(await coder.encode(name, value)));
  await put('Config', pdas.config()[0], config);
  await put('PetRecord', pdas.petRecord(asset.publicKey)[0], record);
  await put('Offer', pdas.offer(asset.publicKey, '3')[0], offer);
  await put('Edition', record.edition, { edition_id: new BN('9007199254740993'), max_supply: 100, issued: 1, origin_hash: origin,
    rules_version: 1, species: 0, name: 'Pet', uri: metadataUri, bump: pdas.edition('9007199254740993')[1] });
  const programData = Buffer.alloc(45); programData.writeUInt32LE(3); programData[12] = 1; wallet.publicKey.toBuffer().copy(programData, 13);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); pdas.programData()[0].toBuffer().copy(program, 4);
  accounts.set(PROGRAM_ID.toBase58(), account(program, UPGRADEABLE_LOADER_ID, true));
  accounts.set(pdas.programData()[0].toBase58(), account(programData, UPGRADEABLE_LOADER_ID));
  accounts.set(CORE_PROGRAM_ID.toBase58(), account(Buffer.alloc(0), UPGRADEABLE_LOADER_ID, true));
  accounts.set(asset.publicKey.toBase58(), account(coreAssetData(wallet.publicKey), CORE_PROGRAM_ID));
  accounts.set(collection.toBase58(), account(getCollectionV1AccountDataSerializer().serialize({ key: Key.CollectionV1,
    updateAuthority: umiKey(pdas.config()[0].toBase58()), name: 'Pets', uri: metadataUri, numMinted: 1, currentSize: 1 }), CORE_PROGRAM_ID));
  // Narrow read-only fake: no sendTransaction/sendRawTransaction/requestAirdrop exists.
  const rpc = {
    async getGenesisHash() { return state.genesis; },
    async getAccountInfo(address: PublicKey, commitment: unknown) { state.readCommitments.push(commitment); return accounts.get(address.toBase58()) ?? null; },
    async getLatestBlockhash() { return { blockhash: hash, lastValidBlockHeight: 100 }; },
    async getFeeForMessage() { return { context: { slot: 9 }, value: state.fee }; },
    async simulateTransaction(_transaction: unknown, options: Record<string, unknown>) {
      state.simulations.push(options); return { context: { slot: 9 }, value: { err: state.simulationError, logs: ['fixture simulation'], unitsConsumed: 5000 } };
    },
    async getSignatureStatuses() { return { context: { slot: 9 }, value: [state.status] }; },
    async getBlockHeight() { return state.height; },
    async getTransaction() { return state.transaction; },
  } as unknown as RpcClient;
  const client = new PixelPetsClient({ rpc, network: 'localnet', expectedGenesisHash: state.genesis, expectedCollection: collection });
  return { client, rpc, state, accounts, config, record, offer, put };
}

test('u64/i64 inputs retain precision and reject numbers, exponent notation and overflow', () => {
  assert.equal(integer('18446744073709551615'), 18446744073709551615n);
  assert.equal(integer(new BN('9007199254740993')), 9007199254740993n);
  assert.equal(integer('-9223372036854775808', 64, true), -9223372036854775808n);
  for (const value of [5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => integer(value as never), code('UNSAFE_INTEGER'));
  for (const value of ['1e9', '1.0', '01', '-1']) assert.throws(() => integer(value), code('INVALID_INTEGER'));
  assert.throws(() => integer('18446744073709551616'), code('INTEGER_RANGE'));
  assert.throws(() => integer('-9223372036854775809', 64, true), code('INTEGER_RANGE'));
  assert.throws(() => integer('1', 0), code('INTEGER_RANGE'));
  assert.equal(u64LE('9007199254740993').toString('hex'), '0100000000002000');
});

test('SOL display and fee rounding use integer arithmetic including above 2^53', () => {
  assert.equal(solToLamports('0.000000001'), '1');
  assert.equal(solToLamports('9007199.254740993'), '9007199254740993');
  assert.equal(lamportsToSol('9007199254740993'), '9007199.254740993');
  assert.deepEqual(saleAmounts('101', 250), { grossLamports: '101', feeLamports: '2', sellerLamports: '99' });
  assert.throws(() => solToLamports('0.0000000001'), code('INVALID_AMOUNT'));
  assert.throws(() => saleAmounts('100', 501), code('INVALID_FEE'));
  assert.throws(() => hash32('00'), code('INVALID_HASH'));
});

test('public genesis constants are complete 32-byte hashes rather than Wallet Standard chain prefixes', () => {
  assert.deepEqual(GENESIS_HASHES, {
    devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
    mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  });
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  for (const hash of Object.values(GENESIS_HASHES)) {
    const value = [...hash].reduce((number, digit) => number * 58n + BigInt(alphabet.indexOf(digit)), 0n);
    const decodedBytes = Math.ceil(value.toString(16).length / 2) + (hash.match(/^1*/)?.[0].length ?? 0);
    assert.equal(decodedBytes, 32);
  }
});

test('metadata accepts supported content IDs and canonical paths; names and gateways are insufficient', () => {
  const cid = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';
  const arId = Buffer.alloc(32, 1).toString('base64url');
  for (const uri of [metadataUri, `ipfs://${cid}`, `ipfs://${cid}/`,
    'ipfs://QmYwAPJzv5CZsnAzt8auVZRnB2EYgGHcSfUuw9FVxuXYFD/pet.json',
    `ipfs://${cid}/folder/%E8%8B%94.json`, `ar://${arId}`, `ar://${arId}/pet.json`]) {
    assert.equal(isImmutableMetadataUri(uri), true, uri);
  }
  for (const uri of ['ipfs://pet', 'ipfs://pets', 'ipfs://example.com', `https://ipfs.io/ipfs/${cid}`,
    `ipns://${cid}`, `ipfs://user@${cid}`, `ipfs://${cid}?filename=pet.json`, `ipfs://${cid}#json`,
    `ipfs://${cid}/../pet.json`, `ipfs://${cid}/%2e%2e/pet.json`, `ipfs://${cid}/%252e%252e/pet.json`,
    `ipfs://${cid}/a%2fb.json`, `ipfs://${cid}/a%5cb.json`, `ipfs://${cid}/a//b.json`,
    `ipfs://${cid}/a b.json`, `ipfs://${cid}/%00.json`, `ipfs://${cid}/%ff.json`,
    `ipfs://${cid}/a\\b.json`, `ar://${arId}=`, `ar://${arId.slice(0, 42)}F`, 'ar://short',
    `ipfs://${cid}/${'x'.repeat(200)}`, undefined, null]) {
    assert.equal(isImmutableMetadataUri(uri), false, String(uri));
  }
  const initialize = { admin: wallet.publicKey, collection, name: 'Pets', uri: metadataUri,
    issuer: issuer.publicKey, feeRecipient, feeBps: 250 };
  const edition = { admin: wallet.publicKey, editionId: '1', maxSupply: 10, originHash: origin,
    rulesVersion: 1, species: 0, name: 'Pets', uri: metadataUri };
  assert.throws(() => instructions.initialize({ ...initialize, uri: 'ipfs://pets' }), code('INVALID_METADATA'));
  assert.throws(() => instructions.createEdition({ ...edition, uri: 'ar://pet' }), code('INVALID_METADATA'));
});

test('CID decoding rejects truncated hashes, trailing bytes, unsupported hashes and non-minimal varints', () => {
  const encode = (bytes: number[]) => {
    let bits = '';
    for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
    bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0');
    return 'b' + bits.match(/.{5}/g)!.map(part => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(part, 2)]).join('');
  };
  const good = [1, 0x55, 0x12, 32, ...Array(32).fill(3)];
  assert.equal(isImmutableMetadataUri(`ipfs://${encode(good)}`), true);
  for (const bytes of [good.slice(0, -1), [...good, 0], [0x81, 0, ...good.slice(1)],
    [2, ...good.slice(1)], [1, 0x72, ...good.slice(2)], [1, 0x55, 0, 32, ...Array(32).fill(3)],
    [1, 0x55, 0x12, 31, ...Array(31).fill(3)]]) {
    assert.equal(isImmutableMetadataUri(`ipfs://${encode(bytes)}`), false, Buffer.from(bytes).toString('hex'));
  }
  const canonical = encode(good);
  assert.equal(isImmutableMetadataUri(`ipfs://${canonical.slice(0, -1)}n`), false, 'nonzero unused base32 bits');
  assert.equal(isImmutableMetadataUri(`ipfs://${canonical}a`), false, 'extra base32 padding');
});

test('PDA seeds use fixed-width little endian and claim replay identity ignores recipient', () => {
  const expected = PublicKey.findProgramAddressSync([Buffer.from('offer'), asset.publicKey.toBuffer(), Buffer.from('0100000000002000', 'hex')], PROGRAM_ID);
  assert.equal(pdas.offer(asset.publicKey, '9007199254740993')[0].toBase58(), expected[0].toBase58());
  assert.notEqual(pdas.offer(asset.publicKey, '3')[0].toBase58(), pdas.offer(asset.publicKey, '4')[0].toBase58());
  assert.equal(pdas.claimReceipt(claimId)[0].toBase58(), pdas.claimReceipt(claimId.toString('hex'))[0].toBase58());
});

test('all contract builders match IDL account order, signer flags and lossless arguments', () => {
  const listing = { maker: wallet.publicKey, collection, asset: asset.publicKey, nonce: '9007199254740993', expiresAt: '1800000000' };
  const items: TransactionInstruction[] = [
    instructions.initialize({ admin: wallet.publicKey, collection, name: 'Pets', uri: metadataUri, issuer: issuer.publicKey, feeRecipient, feeBps: 250 }),
    instructions.configure({ admin: wallet.publicKey, issuer: issuer.publicKey, feeRecipient, feeBps: 250, paused: false }),
    instructions.createEdition({ admin: wallet.publicKey, editionId: '9007199254740993', maxSupply: 100, originHash: origin, rulesVersion: 1, species: 0, name: 'Pet', uri: metadataUri }),
    claimInstruction(), instructions.checkpoint({ owner: wallet.publicKey, issuer: issuer.publicKey, collection, asset: asset.publicKey, expectedCheckpoint: '0', form: 1, bond: 6, eventHash: claimId }),
    instructions.createSwap({ ...listing, desiredAsset }), instructions.createSale({ ...listing, priceLamports: '9007199254740993' }),
    instructions.acceptSwap({ ...listing, taker: recipient.publicKey, desiredAsset }),
    instructions.buy({ ...listing, buyer: recipient.publicKey, feeRecipient, expectedPriceLamports: '9007199254740993' }),
    instructions.cancel({ ...listing, caller: wallet.publicKey }),
  ];
  assert.equal(items.length, PIXEL_PETS_IDL.instructions.length);
  for (const item of items) {
    const decoded = instructions.coder.decode(item.data)!;
    const schema = PIXEL_PETS_IDL.instructions.find(i => i.name === decoded.name)!;
    assert.deepEqual(item.keys.map(key => [key.isSigner, key.isWritable]), schema.accounts.map(a => ['signer' in a && a.signer === true, 'writable' in a && a.writable === true]));
    assert.deepEqual(instructions.coder.encode(decoded.name, decoded.data), item.data);
  }
  const sale = instructions.coder.decode(items[6].data)!.data as { price_lamports: BN; nonce: BN };
  assert.equal(sale.price_lamports.toString(), '9007199254740993');
  assert.equal(sale.nonce.toString(), '9007199254740993');
});

test('network selection is explicit and localnet cannot impersonate a public cluster', async () => {
  const { rpc, client, state } = await fixture();
  assert.throws(() => new PixelPetsClient({ rpc } as never), code('UNSUPPORTED_NETWORK'));
  assert.throws(() => new PixelPetsClient({ rpc, network: 'localnet' }), code('INVALID_GENESIS'));
  assert.throws(() => new PixelPetsClient({ rpc, network: 'localnet', expectedGenesisHash: GENESIS_HASHES.devnet }), code('INVALID_GENESIS'));
  for (const network of ['devnet', 'mainnet-beta'] as const) {
    const remote = new PixelPetsClient({ rpc, network });
    await assert.rejects(remote.assertNetwork(), code('NETWORK_MISMATCH'));
  }
  state.genesis = GENESIS_HASHES.devnet;
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()] }), code('NETWORK_MISMATCH'));
  assert.equal(state.simulations.length, 0);
});

test('prepare validates deployment then simulates and preserves the fresh asset signature', async () => {
  const { client, state } = await fixture();
  const prepared = await client.prepareClaim({ payer: wallet.publicKey, recipient: wallet.publicKey, assetSigner: asset,
    editionId: '9007199254740993', claimId, expiresAt: '1800000000' });
  assert.equal(prepared.networkFeeLamports, '15000');
  assert.equal(prepared.lastValidBlockHeight, 100);
  assert.equal(prepared.requiredSigners.length, 3);
  assert.ok(prepared.requiredSigners.includes(asset.publicKey.toBase58()));
  assertCoSignedTransaction(prepared.expectedMessage, prepared.transactionBase64, { requiredSigners: [asset.publicKey] });
  assert.deepEqual(state.simulations, [{ commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false }]);
  assert.equal((await client.fetchEdition('9007199254740993')).edition_id.toString(), '9007199254740993');
});

test('prepare fails closed for missing deployment, wrong programs and changed account privileges', async () => {
  const { client, accounts } = await fixture();
  const item = claimInstruction(); item.keys[0].isSigner = false;
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [item] }), code('INVALID_ACCOUNTS'));
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient.publicKey, lamports: 1 })] }), code('PROGRAM_MISMATCH'));
  accounts.delete(PROGRAM_ID.toBase58());
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()] }), code('PROGRAM_NOT_DEPLOYED'));
});

test('prepare rejects issuer substitution and canonical collection substitution', async () => {
  const { client } = await fixture();
  for (const [index, expected] of [[2, 'ISSUER_MISMATCH'], [5, 'COLLECTION_MISMATCH']] as const) {
    const item = claimInstruction(); item.keys[index].pubkey = recipient.publicKey;
    await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [item] }), code(expected));
  }
});

test('co-signing accepts additional valid signatures and refuses every message mutation', () => {
  const tx = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: hash }).add(claimInstruction());
  tx.partialSign(asset); const expected = tx.serializeMessage(); tx.partialSign(issuer);
  const wire = tx.serialize({ requireAllSignatures: false });
  assertCoSignedTransaction(expected, wire, { requiredSigners: [issuer.publicKey, asset.publicKey] });
  assert.throws(() => assertCoSignedTransaction(expected, wire, { requireAllSignatures: true }), code('INVALID_SIGNATURE'));
  assert.throws(() => assertCoSignedTransaction(expected, wire, { requiredSigners: [recipient.publicKey] }), code('MISSING_COSIGNATURE'));
  for (const mutate of [
    (t: Transaction) => { t.recentBlockhash = Keypair.generate().publicKey.toBase58(); },
    (t: Transaction) => { t.feePayer = recipient.publicKey; },
    (t: Transaction) => { t.instructions[0].data[8] ^= 1; },
    (t: Transaction) => { t.instructions[0].keys[1].pubkey = recipient.publicKey; },
    (t: Transaction) => { t.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient.publicKey, lamports: 1 })); },
  ]) {
    const altered = Transaction.from(wire); mutate(altered);
    assert.throws(() => assertCoSignedTransaction(expected, altered.serialize({ requireAllSignatures: false, verifySignatures: false })), code('TRANSACTION_REPLACED'));
  }
  const corrupted = Transaction.from(wire); corrupted.signatures.find(s => s.publicKey.equals(issuer.publicKey))!.signature![0] ^= 1;
  assert.throws(() => assertCoSignedTransaction(expected, corrupted.serialize({ requireAllSignatures: false, verifySignatures: false })), code('INVALID_SIGNATURE'));
});

test('signed transaction verification rejects missing signatures and expiration, then simulates all signatures', async () => {
  const { client, state } = await fixture();
  const prepared = await client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()], temporarySigners: [asset] });
  await assert.rejects(client.verifySignedTransaction(prepared, prepared.transactionBase64), code('INVALID_SIGNATURE'));
  prepared.transaction.partialSign(wallet, issuer); const wire = prepared.transaction.serialize();
  await client.verifySignedTransaction(prepared, wire);
  assert.equal(state.simulations.at(-1)!.sigVerify, true);
  state.height = 101;
  await assert.rejects(client.verifySignedTransaction(prepared, wire), code('TRANSACTION_EXPIRED'));
});

test('simulation failures include diagnostics and unavailable fees do not become zero', async () => {
  const { client, state } = await fixture();
  state.simulationError = { InstructionError: [0, 'Custom'] };
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()] }), code('SIMULATION_FAILED'));
  state.simulationError = null; state.fee = null;
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()] }), code('FEE_UNAVAILABLE'));
});

test('official identity requires program owner, canonical record, collection and immutable plugins', async () => {
  const { client, accounts } = await fixture();
  const good = accounts.get(asset.publicKey.toBase58())!;
  await client.verifyOfficialPet(asset.publicKey, wallet.publicKey);
  accounts.set(asset.publicKey.toBase58(), { ...good, owner: PROGRAM_ID });
  await assert.rejects(client.verifyOfficialPet(asset.publicKey, wallet.publicKey), code('ACCOUNT_OWNER_MISMATCH'));
  for (const plugins of ['none', 'delegate', 'mutable'] as const) {
    accounts.set(asset.publicKey.toBase58(), account(coreAssetData(wallet.publicKey, plugins), CORE_PROGRAM_ID));
    await assert.rejects(client.verifyOfficialPet(asset.publicKey, wallet.publicKey), code('UNSAFE_CORE_PLUGINS'));
  }
  accounts.set(asset.publicKey.toBase58(), good);
  await assert.rejects(client.verifyOfficialPet(asset.publicKey, recipient.publicKey), code('ASSET_OWNER_MISMATCH'));
});

test('official identity rejects wrong Core account types even with decodable data', async () => {
  const { client, accounts } = await fixture();
  const goodAsset = accounts.get(asset.publicKey.toBase58())!;
  const badAsset = Buffer.from(goodAsset.data); badAsset[0] = Key.CollectionV1;
  accounts.set(asset.publicKey.toBase58(), { ...goodAsset, data: badAsset });
  await assert.rejects(client.verifyOfficialPet(asset.publicKey, wallet.publicKey), code('INVALID_ASSET'));
  accounts.set(asset.publicKey.toBase58(), goodAsset);
  const goodCollection = accounts.get(collection.toBase58())!;
  const badCollection = Buffer.from(goodCollection.data); badCollection[0] = Key.AssetV1;
  accounts.set(collection.toBase58(), { ...goodCollection, data: badCollection });
  await assert.rejects(client.verifyOfficialPet(asset.publicKey, wallet.publicKey), code('INVALID_COLLECTION'));
});

test('gifting requires exactly owner-signed Core TransferV1 and refuses delegates, mixed instructions and escrow', async () => {
  const { client, record, put, accounts } = await fixture();
  const prepared = await client.prepareGift({ owner: wallet.publicKey, recipient: recipient.publicKey, asset: asset.publicKey });
  assert.deepEqual(prepared.requiredSigners, [wallet.publicKey.toBase58()]);
  const gift = createGiftInstruction({ owner: wallet.publicKey, recipient: recipient.publicKey, collection, asset: asset.publicKey });
  assert.equal(gift.data.toString('hex'), '0e00');
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [gift, claimInstruction()] }), code('INVALID_GIFT'));
  const malformed = createGiftInstruction({ owner: wallet.publicKey, recipient: recipient.publicKey, collection, asset: asset.publicKey });
  malformed.keys[3].isSigner = false;
  await assert.rejects(client.prepare({ payer: wallet.publicKey, instructions: [malformed] }), code('INVALID_GIFT'));
  accounts.set(asset.publicKey.toBase58(), account(coreAssetData(wallet.publicKey, 'delegate'), CORE_PROGRAM_ID));
  await assert.rejects(client.prepareGift({ owner: wallet.publicKey, recipient: recipient.publicKey, asset: asset.publicKey }), code('UNSAFE_CORE_PLUGINS'));
  accounts.set(asset.publicKey.toBase58(), account(coreAssetData(wallet.publicKey), CORE_PROGRAM_ID));
  record.active_offer = pdas.offer(asset.publicKey, '3')[0]; await put('PetRecord', pdas.petRecord(asset.publicKey)[0], record);
  await assert.rejects(client.prepareGift({ owner: wallet.publicKey, recipient: recipient.publicKey, asset: asset.publicKey }), code('ALREADY_LISTED'));
});

test('market preparation uses onchain nonce, maker and fee snapshot rather than current config', async () => {
  const { client, config, put, offer } = await fixture();
  const sale = await client.prepareSale({ maker: wallet.publicKey, asset: asset.publicKey, expiresAt: '1800000000', priceLamports: '9007199254740993' });
  assert.equal((instructions.coder.decode(sale.transaction.instructions[0].data)!.data as { nonce: BN }).nonce.toString(), '3');
  config.fee_recipient = recipient.publicKey; await put('Config', pdas.config()[0], config);
  const buy = await client.prepareBuy({ buyer: recipient.publicKey, asset: asset.publicKey, nonce: '3', expectedPriceLamports: offer.price_lamports });
  assert.equal(buy.transaction.instructions[0].keys[1].pubkey.toBase58(), wallet.publicKey.toBase58());
  assert.equal(buy.transaction.instructions[0].keys[2].pubkey.toBase58(), feeRecipient.toBase58());
  await assert.rejects(client.prepareBuy({ buyer: recipient.publicKey, asset: asset.publicKey, nonce: '3', expectedPriceLamports: '1' }), code('PRICE_CHANGED'));
});

test('pause rejects sale while cancellation still returns to the original maker', async () => {
  const { client, config, put } = await fixture(); config.paused = true; await put('Config', pdas.config()[0], config);
  await assert.rejects(client.prepareSale({ maker: wallet.publicKey, asset: asset.publicKey, expiresAt: '1800000000', priceLamports: '1' }), code('PROTOCOL_PAUSED'));
  const cancel = await client.prepareCancel({ caller: recipient.publicKey, asset: asset.publicKey, nonce: '3' });
  assert.equal(cancel.transaction.instructions[0].keys[1].pubkey.toBase58(), wallet.publicKey.toBase58());
});

test('finalized status preserves unknown, pending and failed outcomes', async () => {
  const { client, state } = await fixture();
  assert.deepEqual(await client.queryFinalized(signature, 100), { state: 'unknown', signature, blockhashExpired: false });
  state.height = 101;
  assert.equal((await client.queryFinalized(signature, 100)).state, 'unknown');
  state.status = { slot: 9, err: null, confirmationStatus: 'confirmed' };
  assert.equal((await client.queryFinalized(signature)).state, 'pending');
  state.status = { slot: 9, err: { InstructionError: [0, 'InvalidArgument'] }, confirmationStatus: 'finalized' };
  assert.equal((await client.queryFinalized(signature)).state, 'failed');
  state.status = { slot: 9, err: null, confirmationStatus: 'finalized' };
  assert.equal((await client.queryFinalized(signature)).state, 'finalized');
});

test('finalized verification binds signature and exact message; null history is not success', async () => {
  const { client, state } = await fixture();
  const prepared = await client.prepare({ payer: wallet.publicKey, instructions: [claimInstruction()] });
  state.status = { slot: 9, err: null, confirmationStatus: 'finalized' };
  assert.equal((await client.verifyFinalizedTransaction(prepared, signature)).verified, false);
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: prepared.transaction.compileMessage() } };
  assert.equal((await client.verifyFinalizedTransaction(prepared, signature)).verified, true);
  state.transaction = { slot: 8, meta: { err: null }, transaction: { signatures: [signature], message: prepared.transaction.compileMessage() } };
  await assert.rejects(client.verifyFinalizedTransaction(prepared, signature), code('FINALIZED_TRANSACTION_MISMATCH'));
  const other = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: hash }).add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient.publicKey, lamports: 1 }));
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: other.compileMessage() } };
  await assert.rejects(client.verifyFinalizedTransaction(prepared, signature), code('FINALIZED_TRANSACTION_MISMATCH'));
});

test('finalized claim checks receipt identity, provenance and final Core owner', async () => {
  const { client, state, put } = await fixture();
  const receipt = { claim_id: Array.from(claimId), recipient: wallet.publicKey, asset: asset.publicKey, edition: pdas.edition('9007199254740993')[0],
    origin_hash: origin, rules_version: 1, expires_at: new BN(1800000000), bump: pdas.claimReceipt(claimId)[1] };
  await put('ClaimReceipt', pdas.claimReceipt(claimId)[0], receipt);
  const input = { signature, claimId, recipient: wallet.publicKey, asset: asset.publicKey, editionId: '9007199254740993' };
  assert.equal((await client.verifyFinalizedClaim(input)).verified, false);
  state.status = { slot: 9, err: null, confirmationStatus: 'finalized' };
  assert.equal((await client.verifyFinalizedClaim(input)).verified, false);
  const claimTransaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: hash }).add(claimInstruction());
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: claimTransaction.compileMessage() } };
  state.readCommitments.length = 0;
  assert.equal((await client.verifyFinalizedClaim(input)).verified, true);
  assert.ok(state.readCommitments.every(c => c === 'finalized'));
  state.transaction = { slot: 8, meta: { err: null }, transaction: { signatures: [signature], message: claimTransaction.compileMessage() } };
  await assert.rejects(client.verifyFinalizedClaim(input), code('FINALIZED_TRANSACTION_MISMATCH'));
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: claimTransaction.compileMessage() } };
  await assert.rejects(client.verifyFinalizedClaim({ ...input, recipient: recipient.publicKey }), code('CLAIM_MISMATCH'));
  const unrelated = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: hash }).add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient.publicKey, lamports: 1 }));
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: unrelated.compileMessage() } };
  await assert.rejects(client.verifyFinalizedClaim(input), code('FINALIZED_TRANSACTION_MISMATCH'));
  state.transaction = { slot: 9, meta: { err: null }, transaction: { signatures: [signature], message: claimTransaction.compileMessage() } };
  receipt.origin_hash = Array(32).fill(1); await put('ClaimReceipt', pdas.claimReceipt(claimId)[0], receipt);
  await assert.rejects(client.verifyFinalizedClaim(input), code('CLAIM_MISMATCH'));
});
