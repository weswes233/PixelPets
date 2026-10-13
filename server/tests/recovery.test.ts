import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Repository, start } from '../src/public.ts';

function wallet() {
  const key = generateKeyPairSync('ed25519');
  const bytes = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  let n = BigInt(`0x${bytes.toString('hex')}`); let address = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (n > 0n) { address = alphabet[Number(n % 58n)] + address; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; address = `1${address}`; }
  return { address, sign: (message: string) => sign(null, Buffer.from(message), key.privateKey).toString('base64') };
}
async function fixture(path = ':memory:') {
  let now = 1800000000000;
  const repo = new Repository(path, { clock: () => now, publicOrigin: 'https://pets.example.test', network: 'devnet' });
  const server = await start({ repository: repo, port: 0, rateLimit: { requests: 1000, guestCreations: 12, windowMs: 60000 } });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(method: string, route: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${origin}/api/v1${route}`, { method, headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; data: any; error: any } };
  }
  async function guest() {
    const response = await request('POST', '/guests', {}); assert.equal(response.status, 201);
    return response.body.data as { token: string; user_id: string };
  }
  async function link(key: ReturnType<typeof wallet>, token: string) {
    const challenge = await request('POST', '/wallet/challenge', { address: key.address }, token); assert.equal(challenge.status, 200);
    const result = await request('POST', '/wallet/verify', {
      challenge_id: challenge.body.data.challenge_id, signature: key.sign(challenge.body.data.message),
    }, token); assert.equal(result.status, 200); return result.body.data;
  }
  async function challenge(key: ReturnType<typeof wallet>) {
    const response = await request('POST', '/wallet/recovery/challenge', { address: key.address });
    assert.equal(response.status, 200); return response.body.data as { challenge_id: string; message: string; expires_at: string };
  }
  async function recover(key: ReturnType<typeof wallet>) {
    const c = await challenge(key);
    const response = await request('POST', '/wallet/recovery/verify', { challenge_id: c.challenge_id, signature: key.sign(c.message) });
    assert.equal(response.status, 200); return response.body.data;
  }
  return { repo, request, guest, link, challenge, recover, advance: (milliseconds: number) => { now += milliseconds; },
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repo.close(); } };
}

test('a new device recovers the same pets and journal without moving or merging either guest profile', async () => {
  const f = await fixture();
  try {
    const original = await f.guest(); const deviceGuest = await f.guest(); const key = wallet();
    const pet = (await f.request('POST', '/pets', { species_id: 'moss', nickname: '原来的苔苔', event_id: 'old_pet_0001' }, original.token)).body.data.pet;
    await f.request('POST', `/pets/${pet.id}/care`, { action: 'play', event_id: 'old_care_0001' }, original.token);
    const guestPet = (await f.request('POST', '/pets', { species_id: 'wisp', nickname: '游客的微光', event_id: 'new_pet_0001' }, deviceGuest.token)).body.data.pet;
    const linked = await f.link(key, original.token);
    const oldJournal = (await f.request('GET', '/journal', undefined, original.token)).body.data;
    const challenge = await f.challenge(key);
    const result = await f.request('POST', '/wallet/recovery/verify', {
      challenge_id: challenge.challenge_id, signature: key.sign(challenge.message),
    }, deviceGuest.token);
    assert.equal(result.status, 200);
    const restored = result.body.data;
    assert.deepEqual(Object.keys(restored).sort(), ['expires_at', 'game_expires_at', 'game_token', 'network', 'token', 'user_id', 'wallet_address']);
    assert.equal(restored.user_id, original.user_id); assert.equal(restored.wallet_address, key.address); assert.equal(restored.network, 'devnet');
    assert.equal(Date.parse(restored.expires_at) - 1800000000000, 86400000);
    assert.equal(Date.parse(restored.game_expires_at) - 1800000000000, 30 * 86400000);
    assert.notEqual(restored.token, restored.game_token); assert.notEqual(restored.game_token, original.token);
    assert.deepEqual((await f.request('GET', '/pets', undefined, restored.game_token)).body.data,
      (await f.request('GET', '/pets', undefined, original.token)).body.data);
    assert.deepEqual((await f.request('GET', '/journal', undefined, restored.game_token)).body.data, oldJournal);
    assert.deepEqual((await f.request('GET', '/pets', undefined, deviceGuest.token)).body.data.pets.map((item: { id: string }) => item.id), [guestPet.id]);
    assert.equal((await f.request('GET', '/wallet/session', undefined, linked.token)).status, 200);
    assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 2);
    const rows = f.repo.db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(rows.every(row => typeof row.token_hash === 'string' && /^[a-f0-9]{64}$/.test(row.token_hash)));
  } finally { await f.close(); }
});

test('recovery uses a distinct purpose and rejects bad signatures, tampering, expiry and replay', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const key = wallet(); const attacker = wallet(); await f.link(key, a.token);
    const c = await f.challenge(key);
    assert.match(c.message, /^pets\.example\.test wants you to sign in/);
    assert.match(c.message, /Recover your existing PixelPets account/);
    assert.match(c.message, /URI: https:\/\/pets\.example\.test/);
    assert.match(c.message, /Chain ID: solana:devnet/);
    assert.match(c.message, /urn:pixelpets:account-recovery$/);
    for (const signature of [attacker.sign(c.message), key.sign(c.message.replace('solana:devnet', 'solana:mainnet')), 'invalid']) {
      const response = await f.request('POST', '/wallet/recovery/verify', { challenge_id: c.challenge_id, signature });
      assert.equal(response.status, 401); assert.equal(response.body.error.code, 'INVALID_SIGNATURE');
    }
    const proof = { challenge_id: c.challenge_id, signature: key.sign(c.message) };
    assert.equal((await f.request('POST', '/wallet/verify', proof, a.token)).body.error.code, 'CHALLENGE_EXPIRED');
    const binding = (await f.request('POST', '/wallet/challenge', { address: key.address }, a.token)).body.data;
    assert.equal((await f.request('POST', '/wallet/recovery/verify', {
      challenge_id: binding.challenge_id, signature: key.sign(binding.message),
    })).body.error.code, 'CHALLENGE_EXPIRED');
    assert.equal((await f.request('POST', '/wallet/recovery/verify', proof)).status, 200);
    assert.equal((await f.request('POST', '/wallet/recovery/verify', proof)).body.error.code, 'CHALLENGE_EXPIRED');
    const expired = await f.challenge(key); f.advance(300000);
    assert.equal((await f.request('POST', '/wallet/recovery/verify', {
      challenge_id: expired.challenge_id, signature: key.sign(expired.message),
    })).body.error.code, 'CHALLENGE_EXPIRED');
  } finally { await f.close(); }
});

test('unsigned challenges do not reveal linked accounts and a signed unlinked wallet does not create an account', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const bound = wallet(); const unknown = wallet(); await f.link(bound, a.token);
    const linked = await f.challenge(bound); const unlinked = await f.challenge(unknown);
    assert.deepEqual(Object.keys(linked).sort(), ['challenge_id', 'expires_at', 'message']);
    assert.deepEqual(Object.keys(unlinked).sort(), Object.keys(linked).sort());
    assert.equal(linked.expires_at, unlinked.expires_at);
    assert.ok(!linked.message.includes(a.user_id));
    const before = f.repo.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n;
    const signed = { challenge_id: unlinked.challenge_id, signature: unknown.sign(unlinked.message) };
    assert.equal((await f.request('POST', '/wallet/recovery/verify', { ...signed, signature: bound.sign(unlinked.message) })).body.error.code, 'INVALID_SIGNATURE');
    const result = await f.request('POST', '/wallet/recovery/verify', signed);
    assert.equal(result.status, 404); assert.equal(result.body.error.code, 'WALLET_NOT_LINKED');
    assert.equal((await f.request('POST', '/wallet/recovery/verify', signed)).body.error.code, 'CHALLENGE_EXPIRED');
    assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 1);
    assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, before);
    assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM wallets').get()!.n, 1);
  } finally { await f.close(); }
});

test('recovered player credentials can play for 30 days but cannot authorize wallet or chain routes', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const key = wallet(); await f.link(key, a.token); const restored = await f.recover(key);
    const adopted = await f.request('POST', '/pets', { species_id: 'puddle', nickname: '啵啵', event_id: 'restored_0001' }, restored.game_token);
    assert.equal(adopted.status, 201); const id = adopted.body.data.pet.id;
    const denied: [string, string, unknown][] = [
      ['GET', '/wallet/session', undefined], ['DELETE', '/wallet/session', undefined],
      ['POST', `/pets/${id}/claim-intent`, {}], ['POST', `/pets/${id}/checkpoint-intent`, {}],
      ['GET', '/chain/intents/00000000-0000-0000-0000-000000000000', undefined],
      ['POST', '/chain/intents/00000000-0000-0000-0000-000000000000/confirm', {}],
    ];
    for (const [method, route, body] of denied) assert.equal((await f.request(method, route, body, restored.game_token)).status, 401, route);
    assert.equal((await f.request('POST', `/pets/${id}/care`, { action: 'play', event_id: 'restored_0002' }, restored.game_token)).status, 200);
    f.advance(86400000);
    assert.equal((await f.request('GET', '/wallet/session', undefined, restored.token)).status, 401);
    assert.equal((await f.request('GET', '/pets', undefined, restored.game_token)).status, 200);
    f.advance(29 * 86400000);
    assert.equal((await f.request('GET', '/pets', undefined, restored.game_token)).status, 401);
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).status, 200);
  } finally { await f.close(); }
});

test('separate devices coexist and disconnect revokes only the current wallet token', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const stranger = await f.guest(); const key = wallet(); const otherKey = wallet();
    const original = await f.link(key, a.token); const reconnected = await f.link(key, a.token);
    const first = await f.recover(key); const second = await f.recover(key);
    for (const session of [original, reconnected, first, second]) assert.equal((await f.request('GET', '/wallet/session', undefined, session.token)).status, 200);
    assert.equal((await f.request('DELETE', '/wallet/session', undefined, first.token)).status, 200);
    assert.equal((await f.request('GET', '/wallet/session', undefined, first.token)).status, 401);
    for (const token of [original.token, reconnected.token, second.token]) assert.equal((await f.request('GET', '/wallet/session', undefined, token)).status, 200);
    assert.equal((await f.request('GET', '/pets', undefined, first.game_token)).status, 200);
    for (const [keyToBind, token] of [[key, stranger.token], [otherKey, a.token]] as const) {
      const c = (await f.request('POST', '/wallet/challenge', { address: keyToBind.address }, token)).body.data;
      const response = await f.request('POST', '/wallet/verify', { challenge_id: c.challenge_id, signature: keyToBind.sign(c.message) }, token);
      assert.equal(response.status, 409); assert.equal(response.body.error.code, 'WALLET_ALREADY_LINKED');
    }
  } finally { await f.close(); }
});

test('recovery validates fields and origin before revealing data and applies a shared challenge/verify limit', async () => {
  const f = await fixture();
  try {
    const key = wallet();
    assert.equal((await f.request('POST', '/wallet/recovery/challenge', { address: 'bad' })).body.error.code, 'INVALID_ADDRESS');
    assert.equal((await f.request('POST', '/wallet/recovery/challenge', { address: key.address, user_id: 'target' })).body.error.code, 'INVALID_INPUT');
    assert.equal((await f.request('POST', '/wallet/recovery/challenge', { address: key.address }, undefined, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await f.request('POST', '/wallet/recovery/verify', { challenge_id: 'x'.repeat(1000), signature: 'bad' })).body.error.code, 'INVALID_CHALLENGE');
    assert.equal((await f.request('POST', '/wallet/recovery/verify', { challenge_id: '00000000-0000-0000-0000-000000000000', signature: 'bad', user_id: 'target' })).body.error.code, 'INVALID_INPUT');
    // Four requests above reached the recovery limiter; the rejected Origin did not.
    for (let i = 0; i < 16; i++) assert.equal((await f.request('POST', '/wallet/recovery/challenge', { address: key.address })).status, 200);
    const limited = await f.request('POST', '/wallet/recovery/verify', { challenge_id: '00000000-0000-0000-0000-000000000000', signature: 'bad' });
    assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED'); assert.equal(limited.body.error.retry_after_ms, 60000);
    f.advance(60000); assert.equal((await f.request('POST', '/wallet/recovery/challenge', { address: key.address })).status, 200);
  } finally { await f.close(); }
});

test('simultaneous copies of a valid proof issue exactly one pair of sessions', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const key = wallet(); await f.link(key, a.token); const c = await f.challenge(key);
    const proof = { challenge_id: c.challenge_id, signature: key.sign(c.message) };
    const before = Number(f.repo.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n);
    const attempts = await Promise.all([f.request('POST', '/wallet/recovery/verify', proof), f.request('POST', '/wallet/recovery/verify', proof)]);
    assert.deepEqual(attempts.map(attempt => attempt.status).sort(), [200, 401]);
    assert.equal(Number(f.repo.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n), before + 2);
  } finally { await f.close(); }
});

test('additive migration preserves legacy profiles and higher schema versions; recovery persists and binds deployment context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-recovery-')); const path = join(directory, 'pets.sqlite');
  let f = await fixture(path);
  try {
    const a = await f.guest(); const key = wallet(); await f.link(key, a.token);
    const pet = (await f.request('POST', '/pets', { species_id: 'moss', nickname: '旧档案', event_id: 'migrated_0001' }, a.token)).body.data.pet;
    f.repo.db.exec('DROP TABLE wallet_recovery_challenges; PRAGMA user_version=1');
    await f.close(); f = await fixture(path);
    assert.equal(f.repo.db.prepare('PRAGMA user_version').get()!.user_version, 3); // v3 adds additive travel tables
    assert.equal((await f.request('GET', '/pets', undefined, a.token)).body.data.pets[0].id, pet.id);
    assert.equal((await f.request('GET', '/journal', undefined, a.token)).body.data.entries.length, 1);
    const challenge = await f.challenge(key); f.repo.db.exec('PRAGMA user_version=19');
    await f.close(); f = await fixture(path);
    assert.equal(f.repo.db.prepare('PRAGMA user_version').get()!.user_version, 19);
    const proof = { challenge_id: challenge.challenge_id, signature: key.sign(challenge.message) };
    f.repo.publicOrigin = 'https://different.example.test';
    assert.equal((await f.request('POST', '/wallet/recovery/verify', proof)).body.error.code, 'CHALLENGE_EXPIRED');
    f.repo.publicOrigin = 'https://pets.example.test'; f.repo.network = 'mainnet-beta';
    assert.equal((await f.request('POST', '/wallet/recovery/verify', proof)).body.error.code, 'CHALLENGE_EXPIRED');
    f.repo.network = 'devnet';
    const restored = await f.request('POST', '/wallet/recovery/verify', proof); assert.equal(restored.status, 200);
    await f.close(); f = await fixture(path);
    assert.equal((await f.request('GET', '/pets', undefined, restored.body.data.game_token)).body.data.pets[0].id, pet.id);
    assert.equal((await f.request('GET', '/wallet/session', undefined, restored.body.data.token)).status, 200);
    assert.equal((await f.request('POST', '/wallet/recovery/verify', proof)).body.error.code, 'CHALLENGE_EXPIRED');
  } finally {
    await f.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
