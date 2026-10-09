import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PublicKey } from '@solana/web3.js';
import type { Keypair } from '@solana/web3.js';
import { start } from '../src/app.ts';
import { fixture } from './fixtures/ownership.ts';

// Requests use the real HTTP router, SQLite authentication and ownership service.
// RPC is an encoded account fixture, not a validator; real-chain verification is separate.
async function httpFixture() {
  const f = await fixture();
  const server = await start({ repository: f.repository, ownershipService: f.service, port: 0 });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  async function request(method: string, path: string, input?: unknown, token?: string) {
    const response = await fetch(base + path, { method, headers: {
      ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, body: await response.json() as { ok: boolean; data: any; error: { code: string } } };
  }
  async function login(token: string, wallet: Keypair) {
    const challenge = await request('POST', '/wallet/challenge', { address: wallet.publicKey.toBase58() }, token);
    const privateKey = createPrivateKey({ format: 'der', type: 'pkcs8',
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), wallet.secretKey.slice(0, 32)]) });
    const verified = await request('POST', '/wallet/verify', { challenge_id: challenge.body.data.challenge_id,
      signature: sign(null, Buffer.from(challenge.body.data.message), privateKey).toString('base64') }, token);
    assert.equal(verified.status, 200); return String(verified.body.data.token);
  }
  const tokenA = await login(f.A.token, f.walletKeyA); const tokenB = await login(f.B.token, f.walletKeyB);
  const close = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); f.repository.close(); };
  return { ...f, request, tokenA, tokenB, close };
}

test('HTTP asset sync requires wallet proof; care and rename return the verified ownership view', async t => {
  const f = await httpFixture(); t.after(f.close);
  assert.equal((await f.request('POST', '/wallet/assets/sync', {}, f.A.token)).status, 401);
  const unverified = await f.request('GET', '/pets', undefined, f.A.token);
  assert.equal(unverified.body.data.pets[0].ownership.status, 'unverified');
  const denied = await f.request('POST', `/pets/${f.pet.id}/care`, { action: 'play', event_id: 'unsigned-care' }, f.A.token);
  assert.equal(denied.status, 401); assert.equal(denied.body.error.code, 'WALLET_SESSION_REQUIRED');
  const synced = await f.request('POST', '/wallet/assets/sync', {}, f.tokenA);
  assert.equal(synced.status, 200); assert.equal(synced.body.data.ownership.synchronized, 1);
  assert.equal(synced.body.data.pets[0].ownership.status, 'owned');
  const care = await f.request('POST', `/pets/${f.pet.id}/care`, { action: 'play', event_id: 'signed-care-1' }, f.tokenA);
  assert.equal(care.status, 200); assert.equal(care.body.data.pet.bond, 28);
  assert.equal(care.body.data.pet.ownership.can_interact, true);
  const renamed = await f.request('PATCH', `/pets/${f.pet.id}`, { nickname: 'Verified name' }, f.tokenA);
  assert.equal(renamed.status, 200); assert.equal(renamed.body.data.pet.ownership.status, 'owned');
});

test('HTTP stale owner is rejected before a manual sync and cannot replay a saved care or adoption response', async t => {
  const f = await httpFixture(); t.after(f.close);
  const input = { action: 'play', event_id: 'last-owner-care' };
  assert.equal((await f.request('POST', `/pets/${f.pet.id}/care`, input, f.tokenA)).status, 200);
  const journalA = await f.request('GET', '/journal', undefined, f.A.token);
  f.transfer(f.walletB);
  const rejected = await f.request('POST', `/pets/${f.pet.id}/care`, input, f.tokenA);
  assert.equal(rejected.status, 403); assert.equal(rejected.body.error.code, 'PET_OWNER_CHANGED');
  const old = await f.request('GET', '/pets', undefined, f.A.token); assert.deepEqual(old.body.data.pets, []);
  const next = await f.request('GET', '/pets', undefined, f.B.token);
  assert.equal(next.body.data.pets[0].bond, 3); assert.equal(next.body.data.pets[0].nickname, '苔苔');
  assert.equal((await f.request('POST', `/pets/${f.pet.id}/care`, input, f.tokenA)).status, 404);
  assert.equal((await f.request('PATCH', `/pets/${f.pet.id}`, { nickname: 'Stale' }, f.tokenA)).status, 404);
  assert.equal((await f.request('POST', `/pets/${f.pet.id}/checkpoint-intent`, {}, f.tokenA)).status, 404);
  assert.equal((await f.request('POST', '/pets', { species_id: 'moss', nickname: 'A private name', event_id: 'adopt-primary' }, f.A.token)).status, 404);
  assert.throws(() => f.repository.care(f.A.user_id, f.pet.id, input), { code: 'PET_NOT_FOUND' });
  assert.deepEqual((await f.request('GET', '/journal', undefined, f.A.token)).body.data, journalA.body.data);
  assert.deepEqual((await f.request('GET', '/journal', undefined, f.B.token)).body.data.entries, []);
  const newCare = await f.request('POST', `/pets/${f.pet.id}/care`, { action: 'rest', event_id: 'new-owner-care' }, f.tokenB);
  assert.equal(newCare.status, 200); assert.equal(newCare.body.data.pet.bond, 4);
});

test('HTTP receiving assets does not consume free adoption slots, while original registered and escrow pets do', async t => {
  const f = await httpFixture(); t.after(f.close);
  for (const token of [f.A.token, f.B.token]) for (let index = 0; index < 2; index++) {
    assert.equal((await f.request('POST', '/pets', { species_id: 'wisp', nickname: `free ${index}`, event_id: `free-pet-${index}` }, token)).status, 201);
  }
  const adopt = { species_id: 'wisp', nickname: 'third', event_id: 'third-free-pet' };
  assert.equal((await f.request('POST', '/pets', adopt, f.A.token)).status, 409);
  await f.escrow(); assert.equal((await f.request('POST', '/wallet/assets/sync', {}, f.tokenA)).status, 200);
  assert.equal((await f.request('POST', '/pets', adopt, f.A.token)).status, 409);
  f.record.active_offer = PublicKey.default; await f.saveRecord(); f.transfer(f.walletB);
  const received = await f.request('POST', '/wallet/assets/sync', {}, f.tokenB);
  assert.equal(received.status, 200); assert.equal(received.body.data.pets.length, 3);
  assert.equal(received.body.data.pets.find((pet: { id: string }) => pet.id === f.pet.id).chain.received, true);
  assert.equal((await f.request('POST', '/pets', adopt, f.B.token)).status, 201);
  assert.equal((await f.request('POST', '/pets', { ...adopt, event_id: 'fourth-free-pet' }, f.B.token)).status, 409);
});

test('HTTP escrow is visible but blocks care, rename and checkpoint until cancellation', async t => {
  const f = await httpFixture(); t.after(f.close);
  await f.escrow();
  const sync = await f.request('POST', '/wallet/assets/sync', {}, f.tokenA);
  assert.equal(sync.body.data.pets[0].ownership.status, 'escrow');
  assert.equal(sync.body.data.pets[0].ownership.can_interact, false);
  for (const [method, path, input] of [
    ['POST', `/pets/${f.pet.id}/care`, { action: 'feed', event_id: 'escrow-care' }],
    ['PATCH', `/pets/${f.pet.id}`, { nickname: 'Escrow rename' }],
    ['POST', `/pets/${f.pet.id}/checkpoint-intent`, {}],
  ] as const) {
    const result = await f.request(method, path, input, f.tokenA);
    assert.equal(result.status, 409); assert.equal(result.body.error.code, 'PET_ESCROWED');
  }
  f.record.active_offer = PublicKey.default; await f.saveRecord(); f.transfer(f.walletA);
  const renamed = await f.request('PATCH', `/pets/${f.pet.id}`, { nickname: 'Back home' }, f.tokenA);
  assert.equal(renamed.status, 200); assert.equal(renamed.body.data.pet.bond, 27);
  assert.equal(renamed.body.data.pet.ownership.can_interact, true);
});

test('HTTP RPC failure disables registered care and refresh marks it unverified; free care remains usable', async t => {
  const f = await httpFixture(); t.after(f.close);
  assert.equal((await f.request('POST', '/wallet/assets/sync', {}, f.tokenA)).status, 200);
  f.state.failed = true;
  const failed = await f.request('POST', `/pets/${f.pet.id}/care`, { action: 'feed', event_id: 'network-offline' }, f.tokenA);
  assert.equal(failed.status, 503); assert.equal(failed.body.error.code, 'OWNERSHIP_RPC_UNAVAILABLE');
  assert.equal((await f.request('GET', '/pets', undefined, f.A.token)).body.data.pets[0].ownership.status, 'unverified');
  const adopted = await f.request('POST', '/pets', { species_id: 'puddle', nickname: 'Offline free', event_id: 'offline-free-pet' }, f.A.token);
  assert.equal(adopted.status, 201);
  const care = await f.request('POST', `/pets/${adopted.body.data.pet.id}/care`, { action: 'play', event_id: 'offline-free-care' }, f.A.token);
  assert.equal(care.status, 200); assert.equal(care.body.data.pet.bond, 1);
});
