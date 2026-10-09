import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { CORE_PROGRAM_ID, PROGRAM_ID } from '../../chain-client/src/index.ts';
import { Repository } from '../src/repository.ts';
import { OwnershipService } from '../src/ownership-service.ts';
import type { Pet } from '../src/domain.ts';
import { fixture, matches, key, pdas, coreAsset, account } from './fixtures/ownership.ts';

test('a transient Clock/context mismatch discards the entire read and requires a fresh valid snapshot before writing', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  const originalRead = f.options.rpc.getMultipleAccountsInfoAndContext.bind(f.options.rpc);
  let attempts = 0;
  f.options.rpc.getMultipleAccountsInfoAndContext = async (keys, options) => {
    const response = await originalRead(keys, options); attempts++;
    if (attempts === 1) {
      response.value = response.value.map(value => value ? { ...value, data: Buffer.from(value.data) } : null);
      const clockIndex = keys.findIndex(key => key.equals(SYSVAR_CLOCK_PUBKEY));
      response.value[clockIndex]!.data.writeBigUInt64LE(BigInt(response.context.slot + 1));
      // If the inconsistent response were applied, this fake owner would steal the relationship.
      response.value[keys.findIndex(key => key.equals(f.asset))] = account(coreAsset(f.walletB, f.collection), CORE_PROGRAM_ID);
    }
    return response;
  };
  const result = await f.service.withOwnedPet(f.authA, f.pet.id, fence => f.repository.rename(f.A.user_id, f.pet.id, { nickname: 'verified only' }, fence));
  assert.equal(attempts, 2); assert.equal(result.pet.nickname, 'verified only');
  assert.equal(f.service.listPets(f.B.user_id).pets.length, 0);
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS n FROM ownership_transfers').get()!.n, 0);
});

test('persistent inconsistent Clock snapshots stop after three reads and never apply a transfer or mutation', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  const originalRead = f.options.rpc.getMultipleAccountsInfoAndContext.bind(f.options.rpc);
  let attempts = 0;
  f.options.rpc.getMultipleAccountsInfoAndContext = async (keys, options) => {
    const response = await originalRead(keys, options); attempts++;
    return { ...response, context: { slot: response.context.slot + 1 } };
  };
  await assert.rejects(f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('inconsistent writes are forbidden')), matches('OWNERSHIP_CLOCK_MISMATCH'));
  assert.equal(attempts, 3); assert.equal(f.repository.listPets(f.A.user_id).pets[0].nickname, 'A private name');
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS n FROM ownership_transfers').get()!.n, 0);
});

test('A to B transfer resets uncheckpointed growth and private relationship; preserves original journal', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  await f.service.syncWallet(f.authA); const originalEntries = f.repository.journal(f.A.user_id).entries;
  const before = f.service.listPets(f.A.user_id).pets[0];
  assert.equal(before.bond, 27); assert.equal(before.nickname, 'A private name');
  f.transfer(f.walletB); const result = await f.service.syncWallet(f.authB);
  assert.equal(result.ownership.unavailable, 0); assert.equal(result.pets.length, 1);
  const pet = result.pets[0]; assert.equal(pet.id, f.pet.id); assert.equal(pet.bond, 3); assert.equal(pet.form, 'seed');
  assert.equal(pet.nickname, '苔苔'); assert.equal(pet.care_count, 0); assert.equal(pet.energy, 80); assert.equal(pet.mood, 70);
  assert.deepEqual(pet.traits, { sun: 0, moon: 0 }); assert.equal(pet.chain.checkpoint, '2'); assert.equal(pet.chain.intent_id, undefined);
  assert.equal((pet.chain as Pet['chain'] & { received: boolean }).received, true);
  assert.equal(pet.created_at, new Date(f.state.now).toISOString()); assert.ok(pet.revision > before.revision);
  assert.equal(f.service.listPets(f.A.user_id).pets.length, 0); assert.deepEqual(f.repository.journal(f.A.user_id).entries, originalEntries);
  assert.equal(f.repository.journal(f.B.user_id).entries.length, 0);
  await assert.rejects(f.service.withOwnedPet(f.authA, pet.id, () => assert.fail('old owner care')), matches('PET_NOT_FOUND'));
  const updated = await f.service.withOwnedPet(f.authB, pet.id, fence => { fence(); return f.repository.rename(f.B.user_id, pet.id, { nickname: 'B new name' }); });
  assert.equal(updated.pet.nickname, 'B new name');
});

test('a receiving wallet can already have three free pets; reception bypasses adoption cap', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  for (let n = 0; n < 3; n++) f.repository.adopt(f.B.user_id, { species_id: 'wisp', nickname: `free ${n}`, event_id: `adopt-free-${n}` });
  f.transfer(f.walletB); const result = await f.service.syncWallet(f.authB);
  assert.equal(result.pets.length, 4); assert.equal(result.pets.filter(pet => pet.chain.status === 'registered').length, 1);
});

test('the old owner cannot care after a transfer even before either player requests a refresh', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); await f.service.syncWallet(f.authA);
  f.transfer(f.walletB);
  await assert.rejects(f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('stale owner care')), matches('PET_OWNER_CHANGED'));
  assert.equal(f.service.listPets(f.B.user_id).pets.length, 1);
  assert.equal(f.service.listPets(f.A.user_id).pets.length, 0);
});

test('escrow parks the pet, disallows care and cancellation restores the same owner progress', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  await f.service.syncWallet(f.authA); await f.escrow(); await f.service.syncWallet(f.authA);
  const pet = f.service.listPets(f.A.user_id).pets[0];
  assert.equal(pet.ownership?.status, 'escrow'); assert.equal(pet.ownership?.can_interact, false);
  assert.equal(f.repository.listPets(f.A.user_id).pets.length, 0);
  await assert.rejects(f.service.withOwnedPet(f.authA, pet.id, () => assert.fail('escrow care')), matches('PET_ESCROWED'));
  f.record.active_offer = PublicKey.default; await f.saveRecord(); f.transfer(f.walletA);
  const restored = (await f.service.syncWallet(f.authA)).pets[0];
  assert.equal(restored.bond, 27); assert.equal(restored.nickname, 'A private name'); assert.equal(restored.ownership?.status, 'owned');
});

test('sale out of escrow resets buyer growth instead of inheriting seller off-chain progress', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); await f.service.syncWallet(f.authA);
  await f.escrow(); await f.service.syncWallet(f.authA);
  f.record.active_offer = PublicKey.default; await f.saveRecord(); f.transfer(f.walletB);
  const result = await f.service.syncWallet(f.authB);
  assert.equal(result.pets[0].bond, 3); assert.equal(f.service.listPets(f.A.user_id).pets.length, 0);
});

test('transfer to an unbound wallet parks the asset until that actual wallet binds', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); const unbound = key();
  f.transfer(unbound); await f.service.syncWallet(f.authA);
  assert.equal(f.service.listPets(f.A.user_id).pets.length, 0); assert.equal(f.service.listPets(f.B.user_id).pets.length, 0);
  const C = f.repository.guest(); f.repository.db.prepare('INSERT INTO wallets VALUES (?,?,?)').run(unbound.toBase58(), C.user_id, new Date(f.state.now).toISOString());
  const pets = (await f.service.syncWallet({ user_id: C.user_id, kind: 'wallet' })).pets;
  assert.equal(pets.length, 1); assert.equal(pets[0].bond, 3); assert.equal(pets[0].ownership?.can_interact, true);
});

test('repeated identical sync does not mutate revision, create duplicate transfers or duplicate pets', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); f.transfer(f.walletB);
  const first = await f.service.syncWallet(f.authB); const second = await f.service.syncWallet(f.authB);
  assert.equal(second.pets.length, 1); assert.equal(second.pets[0].revision, first.pets[0].revision);
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS count FROM ownership_transfers').get()!.count, 1);
});

test('stale finalized slots and conflicting same-slot responses cannot revert ownership', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); await f.service.syncWallet(f.authA);
  f.transfer(f.walletB); await f.service.syncWallet(f.authB);
  f.state.slot--; f.clock(); f.accounts.set(f.asset.toBase58(), account(coreAsset(f.walletA, f.collection), CORE_PROGRAM_ID));
  assert.equal((await f.service.syncWallet(f.authA)).ownership.unavailable, 1);
  assert.equal(f.repository.listPets(f.B.user_id).pets.length, 1);
  f.state.slot++; f.clock();
  await assert.rejects(f.service.withOwnedPet(f.authB, f.pet.id, () => assert.fail('conflicting snapshot')), matches('CONFLICTING_OWNERSHIP_SNAPSHOT'));
  assert.equal(f.repository.listPets(f.B.user_id).pets.length, 1);
});

test('first ownership query honors confirmed transaction slots and local checkpoint evidence', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  f.repository.db.exec('CREATE TABLE chain_intents (id TEXT, pet_id TEXT, data TEXT)');
  f.repository.db.prepare('INSERT INTO chain_intents VALUES (?,?,?)').run('proof', f.pet.id,
    JSON.stringify({ attempts: [{ state: 'confirmed', finalized_slot: 101 }] }));
  await assert.rejects(f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('old bank care')), matches('STALE_OWNERSHIP_SNAPSHOT'));
  f.state.slot = 101; f.clock(); f.record.checkpoint = new BN(1); await f.saveRecord();
  await assert.rejects(f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('old checkpoint care')), matches('STALE_OWNERSHIP_SNAPSHOT'));
});

test('RPC outage fails closed for a registered pet while free unregistered care still works', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); await f.service.syncWallet(f.authA);
  const { pet: free } = f.repository.adopt(f.A.user_id, { species_id: 'wisp', nickname: 'free', event_id: 'adopt-free-pet' }) as { pet: Pet };
  f.state.failed = true;
  await assert.rejects(f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('care during outage')), matches('OWNERSHIP_RPC_UNAVAILABLE'));
  assert.equal(f.service.listPets(f.A.user_id).pets.find(pet => pet.id === f.pet.id)!.ownership?.can_interact, false);
  const result = await f.service.withOwnedPet({ user_id: f.A.user_id, kind: 'guest' }, free.id, () => f.repository.care(f.A.user_id, free.id, { action: 'play', event_id: 'free-offline-care' })) as { pet: Pet };
  assert.equal(result.pet.bond, 1);
});

test('foreign collection, plugins, program, genesis and record are not trusted', async t => {
  for (const variant of ['collection', 'plugins', 'program', 'genesis', 'record', 'clock'] as const) {
    const f = await fixture(); t.after(() => f.repository.close()); f.transfer(f.walletB);
    if (variant === 'collection') f.accounts.set(f.asset.toBase58(), account(coreAsset(f.walletB, key()), CORE_PROGRAM_ID));
    if (variant === 'plugins') f.accounts.set(f.asset.toBase58(), account(coreAsset(f.walletB, f.collection, false), CORE_PROGRAM_ID));
    if (variant === 'program') f.accounts.get(PROGRAM_ID.toBase58())!.executable = false;
    if (variant === 'genesis') f.state.genesis = 'other-network';
    if (variant === 'record') f.accounts.get(pdas.petRecord(f.asset)[0].toBase58())!.owner = key();
    if (variant === 'clock') f.accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!.data.writeBigUInt64LE(0n);
    const result = await f.service.syncWallet(f.authB); assert.equal(result.pets.length, 0, variant); assert.equal(result.ownership.unavailable, 1, variant);
  }
});

test('current owner requires a wallet session and an unknown external NFT is never imported', async t => {
  const f = await fixture(); t.after(() => f.repository.close());
  await assert.rejects(f.service.withOwnedPet({ user_id: f.A.user_id, kind: 'guest' }, f.pet.id, () => assert.fail('guest write')), matches('WALLET_SESSION_REQUIRED'));
  f.accounts.set(key().toBase58(), account(coreAsset(f.walletB, f.collection), CORE_PROGRAM_ID));
  assert.equal((await f.service.syncWallet(f.authB)).pets.length, 0);
});

test('registered pet changes are stopped when no chain configuration is available', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); const service = new OwnershipService(f.repository);
  await assert.rejects(service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('disabled ownership write')), matches('OWNERSHIP_DISABLED'));
  assert.equal(service.listPets(f.A.user_id).pets[0].ownership?.can_interact, false);
});

test('another process cannot steal a live lease; expired worker cannot apply its old RPC response', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-ownership-')); const path = join(directory, 'pets.sqlite');
  const f = await fixture(path); const otherRepo = new Repository(path, { network: 'localnet', clock: () => f.state.now });
  const other = new OwnershipService(otherRepo, f.options);
  t.after(() => { f.repository.close(); otherRepo.close(); rmSync(directory, { recursive: true, force: true }); });
  await f.service.syncWallet(f.authA);
  let release!: () => void; let observed!: () => void;
  const readStarted = new Promise<void>(resolve => { observed = resolve; });
  const pendingRead = new Promise<void>(resolve => { release = resolve; });
  f.state.afterRead = async () => { observed(); await pendingRead; };
  const oldWork = f.service.withOwnedPet(f.authA, f.pet.id, () => assert.fail('expired worker wrote'));
  await readStarted;
  assert.equal((await other.syncWallet(f.authB)).ownership.unavailable, 1);
  f.state.now += 120001; f.state.afterRead = undefined; f.transfer(f.walletB);
  assert.equal((await other.syncWallet(f.authB)).pets.length, 1);
  release(); await assert.rejects(oldWork, matches('OWNERSHIP_LEASE_LOST'));
  assert.equal(f.repository.listPets(f.B.user_id).pets.length, 1); assert.equal(f.repository.listPets(f.A.user_id).pets.length, 0);
});

test('write callback fence rejects use after its owning request has completed', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); let expired!: () => void;
  await f.service.withOwnedPet(f.authA, f.pet.id, fence => { expired = fence; fence(); });
  assert.throws(() => expired(), matches('OWNERSHIP_LEASE_LOST'));
});

test('forged escrow cannot attach the asset to an arbitrary beneficial owner', async t => {
  const f = await fixture(); t.after(() => f.repository.close()); const escrow = await f.escrow();
  escrow.offer.asset = key(); await f.put('Offer', escrow.address, escrow.offer);
  const result = await f.service.syncWallet(f.authA);
  assert.equal(result.ownership.unavailable, 1); assert.equal(f.service.listPets(f.B.user_id).pets.length, 0);
});
