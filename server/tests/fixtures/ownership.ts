import assert from 'node:assert/strict';
import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import type { AccountInfo } from '@solana/web3.js';
import { publicKey as umiKey } from '@metaplex-foundation/umi';
import { Key, PluginType, getPluginHeaderV1AccountDataSerializer } from '@metaplex-foundation/mpl-core';
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { getCollectionV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js';
import { getPluginRegistryV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js';
import { CORE_PROGRAM_ID, PROGRAM_ID, UPGRADEABLE_LOADER_ID, PIXEL_PETS_IDL, PixelPetsPdas } from '../../../chain-client/src/index.ts';
import type { ConfigAccount, PetRecordAccount, OfferAccount } from '../../../chain-client/src/index.ts';
import { Repository } from '../../src/repository.ts';
import type { Pet } from '../../src/domain.ts';
import { OwnershipService } from '../../src/ownership-service.ts';
import type { OwnershipRpc } from '../../src/ownership-service.ts';

export const pdas = new PixelPetsPdas();
const coder = new BorshAccountsCoder(PIXEL_PETS_IDL);
export const key = () => Keypair.generate().publicKey;
const uri = 'ipfs://bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq/pet.json';
export const matches = (code: string) => (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
export function account(data: Uint8Array, owner = PROGRAM_ID, executable = false): AccountInfo<Buffer> {
  return { data: Buffer.from(data), owner, executable, lamports: 1, rentEpoch: 0 };
}
export function coreAsset(owner: PublicKey, collection: PublicKey, plugins = true): Buffer {
  const base = Buffer.from(getAssetV1AccountDataSerializer().serialize({ key: Key.AssetV1, owner: umiKey(owner.toBase58()),
    updateAuthority: { __kind: 'Collection', fields: [umiKey(collection.toBase58())] }, name: 'Public pet', uri, seq: null }));
  if (!plugins) return base;
  const start = base.length + 9; const types = [PluginType.ImmutableMetadata, PluginType.AddBlocker];
  const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: BigInt(start + types.length) });
  const registry = getPluginRegistryV1AccountDataSerializer().serialize({ key: Key.PluginRegistryV1,
    registry: types.map((pluginType, index) => ({ pluginType, offset: start + index, authority: { __kind: 'None' } })), externalRegistry: [] });
  return Buffer.concat([base, header, Buffer.from(types), registry]);
}
export async function fixture(path = ':memory:') {
  const state = { now: 1_800_000_000_000, slot: 100, genesis: 'ownership-test-genesis', failed: false, reads: 0,
    afterRead: undefined as (() => Promise<void>) | undefined };
  const repository = new Repository(path, { network: 'localnet', clock: () => state.now });
  const A = repository.guest(); const B = repository.guest(); const walletKeyA = Keypair.generate(); const walletKeyB = Keypair.generate();
  const walletA = walletKeyA.publicKey; const walletB = walletKeyB.publicKey;
  repository.db.prepare('INSERT INTO wallets VALUES (?,?,?)').run(walletA.toBase58(), A.user_id, new Date(state.now).toISOString());
  repository.db.prepare('INSERT INTO wallets VALUES (?,?,?)').run(walletB.toBase58(), B.user_id, new Date(state.now).toISOString());
  const authA = { user_id: A.user_id, kind: 'wallet' }; const authB = { user_id: B.user_id, kind: 'wallet' };
  const collection = key(); const asset = key();
  const { pet } = repository.adopt(A.user_id, { species_id: 'moss', nickname: 'A private name', event_id: 'adopt-primary' }) as { pet: Pet };
  pet.chain = { status: 'registered', network: 'localnet', program_id: PROGRAM_ID.toBase58(), asset_address: asset.toBase58(), checkpoint: '2' };
  pet.bond = 27; pet.form = 'moon'; pet.care_count = 27; pet.traits = { sun: 1, moon: 26 }; pet.energy = 11; pet.mood = 98;
  repository.db.prepare('UPDATE pets SET data=? WHERE id=?').run(JSON.stringify(pet), pet.id);
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const put = async (name: string, address: PublicKey, value: object) => accounts.set(address.toBase58(), account(await coder.encode(name, value)));
  const config: ConfigAccount = { admin: key(), issuer: key(), collection, fee_recipient: key(), fee_bps: 250, paused: false, bump: pdas.config()[1] };
  await put('Config', pdas.config()[0], config);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); pdas.programData()[0].toBuffer().copy(program, 4);
  const data = Buffer.alloc(45); data.writeUInt32LE(3); data[12] = 1; config.admin.toBuffer().copy(data, 13);
  accounts.set(PROGRAM_ID.toBase58(), account(program, UPGRADEABLE_LOADER_ID, true));
  accounts.set(pdas.programData()[0].toBase58(), account(data, UPGRADEABLE_LOADER_ID));
  accounts.set(CORE_PROGRAM_ID.toBase58(), account(Buffer.alloc(0), UPGRADEABLE_LOADER_ID, true));
  accounts.set(collection.toBase58(), account(getCollectionV1AccountDataSerializer().serialize({ key: Key.CollectionV1,
    updateAuthority: umiKey(pdas.config()[0].toBase58()), name: 'Pets', uri, numMinted: 1, currentSize: 1 }), CORE_PROGRAM_ID));
  const record: PetRecordAccount = { asset, edition: pdas.edition('1')[0], serial: 1, origin_hash: Array(32).fill(1), rules_version: 1,
    species: 0, form: 0, checkpoint: new BN('2'), bond: 3, event_hash: Array(32).fill(2), checkpoint_slot: new BN(90),
    active_offer: PublicKey.default, next_offer_nonce: new BN(0), bump: pdas.petRecord(asset)[1] };
  const saveRecord = () => put('PetRecord', pdas.petRecord(asset)[0], record);
  await saveRecord();
  accounts.set(asset.toBase58(), account(coreAsset(walletA, collection), CORE_PROGRAM_ID));
  const clock = () => { const data = Buffer.alloc(40); data.writeBigUInt64LE(BigInt(state.slot)); data.writeBigInt64LE(BigInt(Math.floor(state.now / 1000)), 32);
    accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), account(data, new PublicKey('Sysvar1111111111111111111111111111111111111'))); };
  clock();
  const rpc: OwnershipRpc = {
    async getGenesisHash() { return state.genesis; },
    async getMultipleAccountsInfoAndContext(keys, options) {
      state.reads++;
      assert.equal(typeof options, 'object'); assert.equal((options as { commitment: string }).commitment, 'finalized');
      if (state.failed) throw new Error('RPC offline');
      const snapshot = { context: { slot: state.slot }, value: keys.map(key => accounts.get(key.toBase58()) ?? null) };
      await state.afterRead?.(); return snapshot;
    },
  };
  const options = { rpc, network: 'localnet' as const, expectedGenesisHash: state.genesis, programId: PROGRAM_ID.toBase58(), collectionAddress: collection.toBase58() };
  const service = new OwnershipService(repository, options);
  const transfer = (owner: PublicKey) => { state.slot++; state.now += 15000; clock(); accounts.set(asset.toBase58(), account(coreAsset(owner, collection), CORE_PROGRAM_ID)); };
  const escrow = async () => {
    const [address, bump] = pdas.offer(asset, record.next_offer_nonce.toString());
    const offer: OfferAccount = { maker: walletA, asset, desired_asset: PublicKey.default, fee_recipient: config.fee_recipient,
      nonce: record.next_offer_nonce, expires_at: new BN('1800000900'), offered_checkpoint: record.checkpoint,
      desired_checkpoint: new BN(0), price_lamports: new BN(50), fee_bps: 250, kind: 1, bump };
    record.active_offer = address; record.next_offer_nonce = record.next_offer_nonce.addn(1);
    await put('Offer', address, offer); await saveRecord(); transfer(address); return { address, offer };
  };
  return { repository, service, options, accounts, state, A, B, authA, authB, walletA, walletB, asset, pet, collection,
    record, put, saveRecord, transfer, clock, escrow, walletKeyA, walletKeyB };
}
