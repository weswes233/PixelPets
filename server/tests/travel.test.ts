import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Repository, start, canonicalJson, sha256Hex } from '../src/public.ts';
import { LOOT_TABLE_HASH, collectibles, parseEventCode, renderStory, routes } from '../src/travel-content.ts';
import { assertCanonical } from '../src/canonical.ts';

const DAY = 86400000;
async function fixture(path = ':memory:', startAt = Date.UTC(2026, 9, 10, 1, 0, 0)) {
  let now = startAt;
  const repo = new Repository(path, { clock: () => now, publicOrigin: 'https://pets.example.test' });
  const server = await start({ repository: repo, port: 0, travelDurationMs: 45000, rateLimit: { requests: 10000, guestCreations: 100, windowMs: 60000 } });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(method: string, route: string, body?: unknown, token?: string) {
    const response = await fetch(`${origin}/api/v1${route}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; data: any; error: any } };
  }
  async function guest() { return (await request('POST', '/guests', {})).body.data as { token: string; user_id: string }; }
  async function adopt(token: string, species = 'wisp', id = 'adopt_00001') {
    const result = await request('POST', '/pets', { species_id: species, nickname: 'Lumi', event_id: id }, token); assert.equal(result.status, 201); return result.body.data.pet;
  }
  const go = (token: string, pet: string, id: string, route = 'moonlit_lane', packing = 'tiny_lantern') =>
    request('POST', `/pets/${pet}/trips`, { event_id: id, route_id: route, packing_id: packing }, token);
  async function close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repo.close(); }
  return { repo, request, guest, adopt, go, close, advance: (ms: number) => { now += ms; }, now: () => now };
}

test('public travel catalog discloses demo acceleration, odds, versions and non-asset keepsakes', async () => {
  const f = await fixture();
  try {
    const catalog = (await f.request('GET', '/travel/catalog')).body.data;
    assert.equal(catalog.demo.duration_ms, 45000); assert.match(catalog.demo.label, /accelerated/i);
    assert.equal(catalog.routes.length, 2); assert.equal(catalog.collectibles.length, 8);
    assert.equal(catalog.odds.tiers.reduce((sum: number, tier: { percent: number }) => sum + tier.percent, 0), 100);
    assert.equal(catalog.loot_table_hash, LOOT_TABLE_HASH); assert.match(catalog.disclosure, /not tokens or NFTs/);
    assert.doesNotMatch(JSON.stringify(catalog), /provably fair|fully on-chain/i);
  } finally { await f.close(); }
});

test('away notes reflect the snapshotted personality and packing, without exposing a result', async () => {
  const f = await fixture();
  try {
    const a = await f.guest();
    const notes: string[] = [];
    for (const [i, species] of ['moss', 'puddle', 'wisp'].entries()) {
      const pet = await f.adopt(a.token, species, `adopt_note_000${i}`);
      const trip = (await f.go(a.token, pet.id, `trip_note_000${i}`, 'sunny_market', i === 1 ? 'snack_tin' : 'tiny_lantern')).body.data.trip;
      assert.equal(trip.result, null);
      assert.match(trip.departure_note.zh, /阳光集市/);
      assert.match(trip.departure_note.en, i === 1 ? /snack tin/ : /tiny lantern/);
      notes.push(trip.departure_note.zh);
      const row = f.repo.db.prepare('SELECT data FROM pets WHERE id=?').get(pet.id)!;
      const changed = JSON.parse(String(row.data)); changed.temperament = 'greedy';
      f.repo.db.prepare('UPDATE pets SET data=? WHERE id=?').run(JSON.stringify(changed), pet.id);
      const read = (await f.request('GET', `/trips/${trip.id}`, undefined, a.token)).body.data.trip;
      assert.deepEqual(read.departure_note, trip.departure_note);
    }
    assert.equal(new Set(notes).size, 3);
  } finally { await f.close(); }
});

test('historical postcard prose stays as written; legacy rows still render without changing result evidence', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    const trip = (await f.go(a.token, pet.id, 'trip_card_0001')).body.data.trip;
    f.advance(45000);
    const result = (await f.request('POST', `/trips/${trip.id}/reveal`, { event_id: 'reveal_card_0001' }, a.token)).body.data.trip.result;
    const row = f.repo.db.prepare('SELECT result_json FROM trips WHERE id=?').get(trip.id)!;
    const stored = JSON.parse(String(row.result_json));
    assert.deepEqual(stored.postcard.story, result.story);
    assert.deepEqual(stored.postcard.message, result.message);
    // A saved postcard from an earlier release must not be regenerated from today's templates.
    stored.postcard.story.en.lines[0] = 'A sentence saved by an earlier release.';
    f.repo.db.prepare('UPDATE trips SET result_json=? WHERE id=?').run(JSON.stringify(stored), trip.id);
    const saved = (await f.request('GET', `/trips/${trip.id}`, undefined, a.token)).body.data.trip.result;
    assert.equal(saved.story.en.lines[0], 'A sentence saved by an earlier release.');
    assert.equal(saved.result_hash, result.result_hash);
    assert.equal(saved.canonical_result, result.canonical_result);
    delete stored.postcard;
    f.repo.db.prepare('UPDATE trips SET result_json=? WHERE id=?').run(JSON.stringify(stored), trip.id);
    const legacy = (await f.request('GET', `/trips/${trip.id}`, undefined, a.token)).body.data.trip.result;
    assert.deepEqual(legacy.story, { en: renderStory(result.event_code, 'en'), zh: renderStory(result.event_code, 'zh') });
    assert.equal(legacy.result_hash, result.result_hash);
  } finally { await f.close(); }
});

test('the postcard album returns only its profile\'s trips and keeps older cards beside a new active journey', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const b = await f.guest(); const pet = await f.adopt(a.token);
    const first = (await f.go(a.token, pet.id, 'trip_album_0001')).body.data.trip;
    f.advance(45000);
    await f.request('POST', `/trips/${first.id}/reveal`, { event_id: 'reveal_album_0001' }, a.token);
    f.advance(1);
    const next = (await f.go(a.token, pet.id, 'trip_album_0002')).body.data.trip;
    const album = (await f.request('GET', '/trips', undefined, a.token)).body.data.trips;
    assert.deepEqual(album.map((t: { id: string }) => t.id), [next.id, first.id]);
    assert.ok(album[1].result.message.zh.length > 0);
    assert.deepEqual((await f.request('GET', '/trips', undefined, b.token)).body.data.trips, []);
    assert.equal((await f.request('GET', `/trips/${first.id}`, undefined, b.token)).status, 404);
  } finally { await f.close(); }
});

test('A01: concurrent starts debit one supply and create one active trip; same ID replays, changed params conflict', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    const results = await Promise.all(Array.from({ length: 8 }, () => f.go(a.token, pet.id, 'trip_start_0001')));
    assert.ok(results.every(r => r.status === 201)); assert.equal(new Set(results.map(r => r.body.data.trip.id)).size, 1);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 2);
    const other = await Promise.all([f.go(a.token, pet.id, 'trip_start_0002'), f.go(a.token, pet.id, 'trip_start_0003')]);
    assert.deepEqual(other.map(r => r.body.error.code), ['TRIP_ACTIVE', 'TRIP_ACTIVE']);
    assert.equal((await f.go(a.token, pet.id, 'trip_start_0001', 'sunny_market')).body.error.code, 'EVENT_CONFLICT');
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 2);
    assert.equal(Number(f.repo.db.prepare("SELECT COUNT(*) AS n FROM trips WHERE state='travelling'").get()!.n), 1);
    const b = await f.guest(); assert.equal((await f.go(b.token, pet.id, 'trip_start_0004')).status, 404);
  } finally { await f.close(); }
});

test('A02: the server decides readiness; early reveal is rejected and the countdown comes from server time', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    const trip = (await f.go(a.token, pet.id, 'trip_start_0001')).body.data.trip;
    assert.equal(trip.state, 'travelling'); assert.equal(trip.demo, true); assert.equal(Date.parse(trip.ready_at) - Date.parse(trip.started_at), 45000);
    f.advance(44999);
    const early = await f.request('POST', `/trips/${trip.id}/reveal`, { event_id: 'reveal_00001' }, a.token);
    assert.equal(early.status, 409); assert.equal(early.body.error.code, 'TRIP_NOT_READY'); assert.equal(early.body.error.ready_at, trip.ready_at);
    assert.equal(Number(f.repo.db.prepare('SELECT COUNT(*) AS n FROM collection_discoveries').get()!.n), 0);
    f.advance(1);
    assert.equal((await f.request('GET', `/pets/${pet.id}/trips/current`, undefined, a.token)).body.data.trip.ready, true);
  } finally { await f.close(); }
});

test('A03: reveal settles once across concurrent calls and a restart; result bytes are canonical and hash-verifiable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-travel-')); const path = join(directory, 'pets.sqlite');
  let f = await fixture(path);
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token);
    const trip = (await f.go(a.token, pet.id, 'trip_start_0001', 'sunny_market', 'snack_tin')).body.data.trip;
    const at = f.now() + 45000; await f.close(); f = await fixture(path, at);
    const reveals = await Promise.all(Array.from({ length: 6 }, (_, i) => f.request('POST', `/trips/${trip.id}/reveal`, { event_id: `reveal_0000${i}` }, a.token)));
    assert.ok(reveals.every(r => r.status === 200));
    const results = reveals.map(r => JSON.stringify(r.body.data.trip.result)); assert.equal(new Set(results).size, 1);
    assert.equal(reveals.filter(r => r.body.data.replayed === false).length, 1);
    const result = reveals[0].body.data.trip.result;
    const discoveries = Number(f.repo.db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM collection_discoveries').get()!.n);
    assert.equal(discoveries, result.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0));
    // Canonical R recomputed independently from the public fields.
    const parsed = assertCanonical(result.canonical_result) as unknown[];
    assert.equal(sha256Hex(result.canonical_result), result.result_hash);
    assert.equal(parsed[0], 'pixel-pets:trip-result:v1'); assert.equal(parsed[1], reveals[0].body.data.trip.public_receipt_id);
    assert.equal(parsed[2], 'sunny_market'); assert.equal(parsed[5], LOOT_TABLE_HASH); assert.equal(parsed[11], result.event_code);
    assert.equal(typeof parsed[8], 'string'); assert.equal(parsed[8], String(Date.parse(trip.started_at)));
    const event = parseEventCode(result.event_code); assert.equal(event.route, 'sunny_market'); assert.equal(event.packing, 'snack_tin');
    for (const item of result.items) assert.ok(routes.sunny_market.commons.includes(item.id) || routes.sunny_market.special === item.id);
    assert.match(result.story.en.lines.join(' '), /[A-Za-z]/); assert.ok(result.story.zh.lines.length === 4);
    const petAfter = reveals.find(r => r.body.data.pet)!.body.data.pet; assert.equal(petAfter.bond, 1); assert.equal(petAfter.traits.sun, 1);
    // Restart again: the result is unchanged and no further collection rows appear.
    await f.close(); f = await fixture(path, at + 1000);
    const again = await f.request('POST', `/trips/${trip.id}/reveal`, { event_id: 'reveal_00099' }, a.token);
    assert.equal(JSON.stringify(again.body.data.trip.result), results[0]); assert.equal(again.body.data.replayed, true);
    assert.equal(Number(f.repo.db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM collection_discoveries').get()!.n), discoveries);
    const collection = (await f.request('GET', '/collections', undefined, a.token)).body.data;
    assert.equal(collection.total, 8); assert.equal(collection.discovered, result.items.length);
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('supplies: 3 free per UTC day, top-up never accumulates or double grants, one per trip', async () => {
  const f = await fixture(':memory:', Date.UTC(2026, 9, 10, 23, 59, 0));
  try {
    const a = await f.guest(); const pets = [await f.adopt(a.token, 'moss', 'adopt_00001'), await f.adopt(a.token, 'puddle', 'adopt_00002'), await f.adopt(a.token, 'wisp', 'adopt_00003')];
    for (const [index, pet] of pets.entries()) assert.equal((await f.go(a.token, pet.id, `trip_start_000${index}`)).status, 201);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 0);
    f.advance(45000);
    for (const pet of pets) {
      const current = (await f.request('GET', `/pets/${pet.id}/trips/current`, undefined, a.token)).body.data.trip;
      assert.equal((await f.request('POST', `/trips/${current.id}/reveal`, { event_id: `reveal_${pet.id.slice(0, 8)}` }, a.token)).status, 200);
    }
    // Still the same UTC day: no supplies.
    const none = await f.go(a.token, pets[0].id, 'trip_start_0010'); assert.equal(none.body.error.code, 'NO_SUPPLIES');
    f.advance(60000); // crosses 00:00 UTC
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 3);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 3);
    assert.equal((await f.go(a.token, pets[0].id, 'trip_start_0011')).status, 201);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 2);
    f.advance(DAY); // next day: top up to 3, not 2+3
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 3);
  } finally { await f.close(); }
});

test('A04 (service level): a trip whose pet changed hands is cancelled once with one refund and no reward', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const b = await f.guest(); const pet = await f.adopt(a.token);
    const trip = (await f.go(a.token, pet.id, 'trip_start_0001')).body.data.trip;
    // Simulate an ownership reconciliation that moved the pet to user B (the real chain path is covered by the ownership e2e).
    f.repo.db.prepare('UPDATE pets SET user_id=? WHERE id=?').run(b.user_id, pet.id);
    f.advance(45000);
    const reveals = await Promise.all([1, 2].map(i => f.request('POST', `/trips/${trip.id}/reveal`, { event_id: `reveal_0000${i}` }, a.token)));
    for (const reveal of reveals) { assert.equal(reveal.status, 200); assert.equal(reveal.body.data.trip.state, 'cancelled'); assert.equal(reveal.body.data.trip.result, null); }
    assert.equal(Number(f.repo.db.prepare("SELECT COUNT(*) AS n FROM supplies_ledger WHERE reason='trip_cancelled_refund'").get()!.n), 1);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 3);
    assert.equal(Number(f.repo.db.prepare('SELECT COUNT(*) AS n FROM collection_discoveries').get()!.n), 0);
    // The new owner is not blocked by the old owner's trip.
    assert.equal((await f.go(b.token, pet.id, 'trip_start_0002')).status, 201);
  } finally { await f.close(); }
});

test('a new owner starting a trip cancels the previous owner\'s stale active trip and refunds that starter', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const b = await f.guest(); const pet = await f.adopt(a.token);
    await f.go(a.token, pet.id, 'trip_start_0001');
    f.repo.db.prepare('UPDATE pets SET user_id=? WHERE id=?').run(b.user_id, pet.id);
    assert.equal((await f.go(b.token, pet.id, 'trip_start_0002')).status, 201);
    const trips = f.repo.db.prepare('SELECT user_id,state,cancel_reason FROM trips ORDER BY started_at_ms, rowid').all();
    assert.deepEqual(trips.map(t => [t.user_id, t.state]), [[a.user_id, 'cancelled'], [b.user_id, 'travelling']]);
    assert.equal((await f.request('GET', '/supplies', undefined, a.token)).body.data.balance, 3);
  } finally { await f.close(); }
});

test('legacy pets without temperament travel with their species base; proofs stay private until a receipt is confirmed', async () => {
  const f = await fixture();
  try {
    const a = await f.guest(); const pet = await f.adopt(a.token, 'puddle');
    const row = f.repo.db.prepare('SELECT data FROM pets WHERE id=?').get(pet.id)!; const legacy = JSON.parse(String(row.data)); delete legacy.temperament;
    f.repo.db.prepare('UPDATE pets SET data=? WHERE id=?').run(JSON.stringify(legacy), pet.id);
    const trip = (await f.go(a.token, pet.id, 'trip_start_0001')).body.data.trip; assert.equal(trip.temperament, 'greedy');
    f.advance(45000);
    const revealed = (await f.request('POST', `/trips/${trip.id}/reveal`, { event_id: 'reveal_00001' }, a.token)).body.data;
    assert.equal((await f.request('GET', `/trips/${revealed.trip.public_receipt_id}/proof`)).status, 404);
    assert.equal((await f.request('GET', `/trips/jr_${'A'.repeat(22)}/proof`)).status, 404);
    const checkpoint = await f.request('POST', `/trips/${trip.id}/checkpoint-intent`, {}, a.token);
    assert.equal(checkpoint.status, 401); // wallet session is required before any receipt can be prepared
  } finally { await f.close(); }
});

test('canonical JSON rejects ambiguous values and story rendering never changes evidence', () => {
  assert.equal(canonicalJson(['a', 1, ['b', '18446744073709551615']]), '["a",1,["b","18446744073709551615"]]');
  assert.throws(() => canonicalJson([1.5] as never)); assert.throws(() => canonicalJson([{ a: 1 }] as never)); assert.throws(() => canonicalJson([true] as never));
  assert.throws(() => assertCanonical('["a", 1]'));
  assert.throws(() => parseEventCode('sunny_market.curious.snack_tin.clue')); assert.throws(() => parseEventCode('mars.curious.snack_tin.common'));
  const code = 'moonlit_lane.curious.tiny_lantern.clue.P011';
  assert.match(renderStory(code, 'en').lines[3], /capybara/); assert.match(renderStory(code, 'zh').lines[3], /水豚/);
  assert.equal(Object.values(collectibles).filter(c => c.rarity === 'special').length, 2);
});
