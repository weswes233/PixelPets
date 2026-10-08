import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Repository, start } from '../src/public.ts';

async function fixture(path = ':memory:', limits?: { requests: number; guestCreations: number; windowMs: number }) {
  let now = 1800000000000;
  const repo = new Repository(path, { clock: () => now, publicOrigin: 'https://pets.example.test' });
  const server = await start({ repository: repo, port: 0, rateLimit: limits });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(method: string, route: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${origin}/api/v1${route}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; data: any; error: any } };
  }
  async function guest() { const result = await request('POST', '/guests', {}); assert.equal(result.status, 201); return result.body.data as { token: string; user_id: string }; }
  async function adopt(token: string, species = 'moss', id = 'adoption_0001') {
    const result = await request('POST', '/pets', { species_id: species, nickname: '小伙伴', event_id: id }, token);
    assert.equal(result.status, 201); return result.body.data.pet;
  }
  async function close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repo.close(); }
  return { repo, server, origin, request, guest, adopt, close, advance: (milliseconds: number) => { now += milliseconds; } };
}

function wallet() {
  const key = generateKeyPairSync('ed25519');
  const raw = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  let n = BigInt(`0x${raw.toString('hex')}`); let address = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (n > 0n) { address = alphabet[Number(n % 58n)] + address; n /= 58n; }
  for (const byte of raw) { if (byte !== 0) break; address = `1${address}`; }
  return { address, sign: (message: string) => sign(null, Buffer.from(message), key.privateKey).toString('base64') };
}

test('guest identity isolates pets, care, rename and journal; tokens are only hashed in DB', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const b = await f.guest(); const pet = await f.adopt(a.token);
    assert.deepEqual((await f.request('GET', '/pets', undefined, b.token)).body.data.pets, []);
    assert.equal((await f.request('POST', `/pets/${pet.id}/care`, { action: 'play', event_id: 'isolated_0001' }, b.token)).status, 404);
    assert.equal((await f.request('PATCH', `/pets/${pet.id}`, { nickname: '偷改' }, b.token)).status, 404);
    assert.equal((await f.request('GET', '/journal', undefined, b.token)).body.data.entries.length, 0);
    assert.equal((await f.request('GET', '/pets', undefined, 'bad-token')).status, 401);
    const rows = f.repo.db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(rows.every(row => typeof row.token_hash === 'string' && row.token_hash.length === 64 && row.token_hash !== a.token));
  } finally { await f.close(); }
});

test('concurrent adoption replay creates one pet and one journal entry; changed request conflicts', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const input = { species_id: 'wisp', nickname: '灯灯', event_id: 'parallel_0001' };
    const attempts = await Promise.all(Array.from({ length: 10 }, () => f.request('POST', '/pets', input, a.token)));
    assert.ok(attempts.every(item => item.status === 201));
    assert.equal(new Set(attempts.map(item => item.body.data.pet.id)).size, 1);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets.length, 1);
    assert.equal((await f.request('GET', '/journal', undefined, a.token)).body.data.entries.length, 1);
    assert.equal((await f.request('POST', '/pets', { ...input, nickname: '改名' }, a.token)).status, 409);
    await f.adopt(a.token, 'moss', 'adoption_0002'); await f.adopt(a.token, 'puddle', 'adoption_0003');
    const extra = await f.request('POST', '/pets', { ...input, event_id: 'adoption_0004' }, a.token);
    assert.equal(extra.status, 409); assert.equal(extra.body.error.code, 'PET_LIMIT');
  } finally { await f.close(); }
});

test('all care actions share server clock cooldown; moon growth takes six distinct actions', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token, 'puddle');
    let latest;
    for (let i = 0; i < 6; i++) {
      const care = { action: i % 2 ? 'rest' : 'explore', choice: 'moon', event_id: `care_event_${i}` };
      const responses = await Promise.all([f.request('POST', `/pets/${pet.id}/care`, care, a.token), f.request('POST', `/pets/${pet.id}/care`, care, a.token)]);
      assert.deepEqual(responses[0].body, responses[1].body);
      latest = responses[0].body.data.pet;
      assert.equal(latest.bond, i + 1); assert.equal(latest.care_count, i + 1);
      const tooSoon = await f.request('POST', `/pets/${pet.id}/care`, { action: 'feed', event_id: `cooldown_${i}` }, a.token);
      assert.equal(tooSoon.body.data.event.applied, false);
      assert.equal(tooSoon.body.data.pet.bond, i + 1);
      f.advance(12000);
    }
    assert.equal(latest.form, 'moon'); assert.deepEqual(latest.traits, { sun: 0, moon: 6 });
    assert.equal((await f.request('GET', '/journal', undefined, a.token)).body.data.entries.length, 7);
    const forbidden = await f.request('POST', `/pets/${pet.id}/care`, { action: 'feed', event_id: 'timestamp_0001', timestamp: 9999999999999 }, a.token);
    assert.equal(forbidden.status, 400);
    const old = await f.request('POST', `/pets/${pet.id}/care`, { action: 'explore', choice: 'moon', event_id: 'care_event_0' }, a.token);
    assert.equal(old.body.data.pet.bond, 1, 'replay preserves original response snapshot');
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets[0].bond, 6, 'replay never rolls back authoritative pet');
  } finally { await f.close(); }
});

test('distinct concurrent actions cannot bypass cooldown or adoption cap; event namespace includes target and operation', async () => {
  const f = await fixture();
  try {
    const a = await f.guest();
    const adopted = await Promise.all(Array.from({ length: 8 }, (_, i) => f.request('POST', '/pets', { species_id: 'moss', nickname: '伙伴', event_id: `race_adopt_${i}` }, a.token)));
    assert.equal(adopted.filter(item => item.status === 201).length, 3);
    assert.equal(adopted.filter(item => item.status === 409).length, 5);
    const pet = adopted.find(item => item.status === 201)!.body.data.pet;
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => f.request('POST', `/pets/${pet.id}/care`, { action: 'feed', event_id: `race_care_${i}` }, a.token)));
    assert.equal(attempts.filter(item => item.body.data.event.applied).length, 1);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets.find((item: { id: string }) => item.id === pet.id).bond, 1);
    const conflicting = await f.request('POST', `/pets/${pet.id}/care`, { action: 'feed', event_id: 'race_adopt_0' }, a.token);
    assert.equal(conflicting.status, 409);
    const otherPet = adopted.filter(item => item.status === 201)[1].body.data.pet;
    assert.equal((await f.request('POST', `/pets/${otherPet.id}/care`, { action: 'feed', event_id: 'race_care_0' }, a.token)).status, 409);
  } finally { await f.close(); }
});

test('sun growth is deterministic and rename cannot rewrite progression', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    for (let i = 0; i < 6; i++) { await f.request('POST', `/pets/${pet.id}/care`, { action: 'play', event_id: `sun_event_${i}` }, a.token); f.advance(12000); }
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets[0].form, 'sun');
    assert.equal((await f.request('PATCH', `/pets/${pet.id}`, { nickname: '太阳', bond: 100 }, a.token)).status, 400);
    const renamed = await f.request('PATCH', `/pets/${pet.id}`, { nickname: '太阳' }, a.token);
    assert.equal(renamed.body.data.pet.nickname, '太阳'); assert.equal(renamed.body.data.pet.bond, 6);
  } finally { await f.close(); }
});

test('reopening durable SQLite retains token, pet, cooldown, replay and journal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-api-')); const path = join(directory, 'pets.sqlite');
  let f = await fixture(path);
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    const input = { action: 'play', event_id: 'persistent_0001' };
    const result = await f.request('POST', `/pets/${pet.id}/care`, input, a.token);
    await f.close(); f = await fixture(path);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets[0].bond, 1);
    assert.deepEqual((await f.request('POST', `/pets/${pet.id}/care`, input, a.token)).body, result.body);
    assert.equal((await f.request('POST', `/pets/${pet.id}/care`, { action: 'rest', event_id: 'persistent_0002' }, a.token)).body.data.event.applied, false);
    assert.equal((await f.request('GET', '/journal', undefined, a.token)).body.data.entries.length, 2);
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('strict validation, payload cap, origin rejection and rate limiting', async () => {
  const f = await fixture(':memory:', { requests: 100, guestCreations: 2, windowMs: 60000 });
  try {
    assert.equal((await f.request('POST', '/guests', { admin: true })).status, 400);
    const a = await f.guest();
    assert.equal((await f.request('POST', '/guests', {})).status, 429);
    assert.equal((await f.request('POST', '/pets', { species_id: 'dragon', nickname: 'x', event_id: 'invalid_0001' }, a.token)).status, 400);
    assert.equal((await f.request('POST', '/pets', { species_id: 'moss', nickname: 'x'.repeat(40000), event_id: 'oversize_0001' }, a.token)).status, 413);
    assert.equal((await f.request('GET', '/pets', undefined, a.token, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.request('GET', '/pets', undefined, a.token, { Origin: 'https://pets.example.test' })).status, 200);
    const malformed = await fetch(`${f.origin}/api/v1/pets`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((await f.request('GET', '/chain/config')).body.data.enabled, false);
    assert.equal((await f.request('POST', '/claims', {}, a.token)).status, 404);
  } finally { await f.close(); }
});

test('real Ed25519 SIWS verification binds original guest, rejects forged signatures and replay', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const b = await f.guest(); const key = wallet(); const attacker = wallet();
    const pet = await f.adopt(a.token);
    const challenge = (await f.request('POST', '/wallet/challenge', { address: key.address }, a.token)).body.data;
    assert.match(challenge.message, /^pets\.example\.test wants you to sign in/);
    assert.match(challenge.message, /URI: https:\/\/pets\.example\.test/);
    assert.match(challenge.message, /Chain ID: solana:devnet/);
    assert.equal((await f.request('POST', '/wallet/verify', { challenge_id: challenge.challenge_id, signature: attacker.sign(challenge.message) }, a.token)).status, 401);
    assert.equal((await f.request('POST', '/wallet/verify', { challenge_id: challenge.challenge_id, signature: key.sign(challenge.message) }, b.token)).status, 401);
    const signed = { challenge_id: challenge.challenge_id, signature: key.sign(challenge.message) };
    const result = await f.request('POST', '/wallet/verify', signed, a.token);
    assert.equal(result.status, 200); assert.equal(result.body.data.user_id, a.user_id);
    const walletToken = result.body.data.token;
    assert.notEqual(walletToken, a.token);
    assert.equal((await f.request('GET', '/wallet/session', undefined, walletToken)).body.data.wallet_address, key.address);
    assert.equal((await f.request('GET', '/wallet/session', undefined, a.token)).status, 401);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets[0].id, pet.id);
    assert.equal((await f.request('POST', '/wallet/verify', signed, a.token)).status, 401);
    const differentUser = (await f.request('POST', '/wallet/challenge', { address: key.address }, b.token)).body.data;
    assert.equal((await f.request('POST', '/wallet/verify', { challenge_id: differentUser.challenge_id, signature: key.sign(differentUser.message) }, b.token)).status, 409);
    assert.equal((await f.request('DELETE', '/wallet/session', undefined, walletToken)).status, 200);
    assert.equal((await f.request('GET', '/wallet/session', undefined, walletToken)).status, 401);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).status, 200);
  } finally { await f.close(); }
});

test('wallet challenge expiry, message tampering, input injection and session renewal invalidate stale proof', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const key = wallet();
    assert.equal((await f.request('POST', '/wallet/challenge', { address: 'invalid' }, a.token)).status, 400);
    assert.equal((await f.request('POST', '/wallet/challenge', { address: key.address, origin: 'evil' }, a.token)).status, 400);
    const challenge = (await f.request('POST', '/wallet/challenge', { address: key.address }, a.token)).body.data;
    assert.equal((await f.request('POST', '/wallet/verify', { challenge_id: challenge.challenge_id, signature: key.sign(challenge.message.replace('pets.example.test', 'attacker.example')) }, a.token)).status, 401);
    f.advance(300000);
    assert.equal((await f.request('POST', '/wallet/verify', { challenge_id: challenge.challenge_id, signature: key.sign(challenge.message) }, a.token)).status, 401);
    const login = async () => {
      const c = (await f.request('POST', '/wallet/challenge', { address: key.address }, a.token)).body.data;
      return (await f.request('POST', '/wallet/verify', { challenge_id: c.challenge_id, signature: key.sign(c.message) }, a.token)).body.data.token;
    };
    const old = await login(); const current = await login();
    assert.equal((await f.request('GET', '/wallet/session', undefined, old)).status, 401);
    assert.equal((await f.request('GET', '/wallet/session', undefined, current)).status, 200);
    f.advance(86400000);
    assert.equal((await f.request('GET', '/wallet/session', undefined, current)).status, 401);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).status, 200);
  } finally { await f.close(); }
});
