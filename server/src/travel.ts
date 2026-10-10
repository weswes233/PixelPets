import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { ApiError, eventId, iso, objectBody, requestHash } from './domain.ts';
import type { Pet } from './domain.ts';
import type { Repository } from './repository.ts';
import { canonicalJson, sha256Hex } from './canonical.ts';
import type { Canonical } from './canonical.ts';
import { CONTENT_VERSION, LOOT_TABLE_HASH, RULES_VERSION, clues, collectibles, departureNote, eventCode, packings, renderPostcard, routes,
  temperamentOf, tiers } from './travel-content.ts';
import type { PackingId, Postcard, RouteId, Temperament, Tier } from './travel-content.ts';

export const DAILY_SUPPLIES = 3;
type Row = Record<string, string | number | null>;
export type TripState = 'travelling' | 'revealed' | 'cancelled';
export type TripResult = { event_code: string; tier: Tier; items: [string, number][]; clue: string | null; postcard?: Postcard };
export type TripCheckpointSource = { trip_id: string; pet_id: string; public_receipt_id: string; result_hash: string };
const ensure = (condition: unknown, status: number, code: string, message: string, details?: Record<string, unknown>): void => {
  if (!condition) throw new ApiError(status, code, message, details);
};
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
const nextUtcMidnight = (now: number): number => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

/** Canonical trip result R (plan 02 §6.2). Integers above 2^53 never occur; u64 timestamps are decimal strings. */
export function tripResultArray(trip: { public_receipt_id: string; route_id: string; packing_id: string; rules_version: number;
  loot_table_hash: string; content_version: number; temperament_snapshot: string; started_at_ms: number; ready_at_ms: number;
  settled_at_ms: number }, result: TripResult): Canonical {
  const items = [...result.items].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, quantity]) => [id, quantity]);
  return ['pixel-pets:trip-result:v1', trip.public_receipt_id, trip.route_id, trip.packing_id, trip.rules_version, trip.loot_table_hash,
    trip.content_version, trip.temperament_snapshot, String(trip.started_at_ms), String(trip.ready_at_ms), String(trip.settled_at_ms),
    result.event_code, items];
}

/**
 * Server-authoritative short trips. Every state change is one SQLite transaction guarded by
 * unique constraints: one supply debit per start event, one active trip per pet, one settlement per trip.
 */
export class TravelService {
  readonly repository: Repository; readonly durationMs: number;
  constructor(repository: Repository, options: { durationMs?: number } = {}) {
    this.repository = repository;
    this.durationMs = options.durationMs ?? 45000;
    ensure(Number.isSafeInteger(this.durationMs) && this.durationMs >= 1000 && this.durationMs <= 86400000, 500, 'INVALID_TRIP_DURATION', 'Invalid trip duration.');
    repository.db.exec(`CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY, public_receipt_id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
        pet_id TEXT NOT NULL REFERENCES pets(id), starting_wallet TEXT, starting_asset TEXT, starting_ownership_version INTEGER,
        route_id TEXT NOT NULL, packing_id TEXT NOT NULL, supplies_cost INTEGER NOT NULL,
        rules_version INTEGER NOT NULL, loot_table_hash TEXT NOT NULL, content_version INTEGER NOT NULL, temperament_snapshot TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL, ready_at_ms INTEGER NOT NULL, settled_at_ms INTEGER,
        state TEXT NOT NULL CHECK (state IN ('travelling','revealed','cancelled')),
        result_json TEXT, canonical_result_bytes TEXT, result_hash TEXT,
        start_event_id TEXT NOT NULL, start_request_hash TEXT NOT NULL, reveal_event_id TEXT, cancel_reason TEXT,
        UNIQUE(user_id, start_event_id));
      CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active_per_pet ON trips(pet_id) WHERE state='travelling';
      CREATE INDEX IF NOT EXISTS trips_user ON trips(user_id, started_at_ms);
      CREATE TABLE IF NOT EXISTS collection_discoveries (
        user_id TEXT NOT NULL REFERENCES users(id), collectible_id TEXT NOT NULL, discovered_at TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0), source_trip_id TEXT NOT NULL REFERENCES trips(id),
        UNIQUE(user_id, source_trip_id, collectible_id));
      CREATE TABLE IF NOT EXISTS supplies_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL,
        delta INTEGER NOT NULL, reason TEXT NOT NULL, trip_id TEXT, utc_day TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(user_id, event_id));
      CREATE TABLE IF NOT EXISTS trip_checkpoint_receipts (
        trip_id TEXT NOT NULL REFERENCES trips(id), chain_intent_id TEXT UNIQUE NOT NULL, schema_version TEXT NOT NULL,
        canonical_checkpoint_bytes TEXT NOT NULL, checkpoint_hash TEXT NOT NULL, network_genesis TEXT NOT NULL,
        program_id TEXT NOT NULL, asset_address TEXT NOT NULL, expected_checkpoint TEXT NOT NULL,
        signature TEXT, finalized_slot INTEGER, status TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS trip_receipts_trip ON trip_checkpoint_receipts(trip_id);`);
    const version = repository.db.prepare('PRAGMA user_version').get() as Row;
    if (Number(version.user_version) < 3) repository.db.exec('PRAGMA user_version=3');
  }
  private inTransaction<T>(work: () => T): T {
    return this.repository.db.isTransaction ? work() : this.repository.transaction(work);
  }
  // ---- supplies -------------------------------------------------------------------------
  private balance(userId: string): number {
    return Number((this.repository.db.prepare('SELECT COALESCE(SUM(delta),0) AS total FROM supplies_ledger WHERE user_id=?').get(userId) as Row).total);
  }
  /** Daily top-up to the cap; a marker row per UTC day means crossing midnight twice never grants twice. */
  private topUp(userId: string, now: number): void {
    const day = utcDay(now);
    if (this.repository.db.prepare('SELECT 1 FROM supplies_ledger WHERE user_id=? AND event_id=?').get(userId, `daily:${day}`)) return;
    const delta = Math.max(0, DAILY_SUPPLIES - this.balance(userId));
    this.repository.db.prepare('INSERT OR IGNORE INTO supplies_ledger(user_id,event_id,delta,reason,trip_id,utc_day,created_at) VALUES (?,?,?,?,NULL,?,?)')
      .run(userId, `daily:${day}`, delta, 'daily_refill', day, iso(now));
  }
  supplies(userId: string) {
    return this.inTransaction(() => {
      const now = this.repository.clock(); this.topUp(userId, now);
      return { balance: this.balance(userId), daily_cap: DAILY_SUPPLIES, next_refill_at: iso(nextUtcMidnight(now)), server_time: iso(now) };
    });
  }
  // ---- views ----------------------------------------------------------------------------
  private tripRow(where: string, ...values: string[]): Row | undefined {
    return this.repository.db.prepare(`SELECT * FROM trips WHERE ${where}`).get(...values) as Row | undefined;
  }
  private receipt(tripId: string): Row | undefined {
    return this.repository.db.prepare(`SELECT * FROM trip_checkpoint_receipts WHERE trip_id=?
      ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1`).get(tripId) as Row | undefined;
  }
  view(row: Row) {
    const now = this.repository.clock();
    const result = row.result_json ? JSON.parse(String(row.result_json)) as TripResult : null;
    const postcard = result ? result.postcard ?? renderPostcard(result.event_code) : null;
    const receipt = this.receipt(String(row.id));
    return {
      id: String(row.id), public_receipt_id: String(row.public_receipt_id), pet_id: String(row.pet_id),
      route_id: String(row.route_id), packing_id: String(row.packing_id), state: String(row.state) as TripState,
      temperament: String(row.temperament_snapshot), demo: true, duration_ms: Number(row.ready_at_ms) - Number(row.started_at_ms),
      departure_note: departureNote(row.route_id as RouteId, row.temperament_snapshot as Temperament, row.packing_id as PackingId),
      started_at: iso(Number(row.started_at_ms)), ready_at: iso(Number(row.ready_at_ms)),
      settled_at: row.settled_at_ms === null ? null : iso(Number(row.settled_at_ms)),
      ready: String(row.state) === 'travelling' && now >= Number(row.ready_at_ms), server_time: iso(now),
      rules_version: Number(row.rules_version), content_version: Number(row.content_version), loot_table_hash: String(row.loot_table_hash),
      cancel_reason: row.cancel_reason === null ? null : String(row.cancel_reason),
      result: result && {
        event_code: result.event_code, tier: result.tier, clue: result.clue,
        items: result.items.map(([id, quantity]) => ({ id, quantity, name: collectibles[id].name, rarity: collectibles[id].rarity })),
        story: postcard!.story, message: postcard!.message, postcard_version: postcard!.version,
        result_hash: String(row.result_hash), canonical_result: String(row.canonical_result_bytes),
      },
      receipt: receipt ? { status: String(receipt.status), chain_intent_id: String(receipt.chain_intent_id),
        signature: receipt.signature === null ? null : String(receipt.signature),
        finalized_slot: receipt.finalized_slot === null ? null : Number(receipt.finalized_slot), event_hash: String(receipt.checkpoint_hash) } : null,
    };
  }
  current(userId: string, petId: string) {
    this.petFor(userId, petId);
    const active = this.tripRow('pet_id=? AND user_id=? AND state=?', petId, userId, 'travelling');
    const latest = active ?? this.tripRow('pet_id=? AND user_id=? ORDER BY started_at_ms DESC, rowid DESC LIMIT 1', petId, userId);
    return { trip: latest ? this.view(latest) : null, supplies: this.supplies(userId) };
  }
  list(userId: string) {
    const rows = this.repository.db.prepare('SELECT * FROM trips WHERE user_id=? ORDER BY started_at_ms DESC, rowid DESC LIMIT 50').all(userId) as Row[];
    return { trips: rows.map(row => this.view(row)), supplies: this.supplies(userId) };
  }
  trip(userId: string, tripId: string) {
    const row = this.tripRow('id=? AND user_id=?', tripId, userId);
    ensure(row, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    return { trip: this.view(row!) };
  }
  tripPetId(userId: string, tripId: string): string {
    const row = this.tripRow('id=? AND user_id=?', tripId, userId);
    ensure(row, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    return String(row!.pet_id);
  }
  collections(userId: string) {
    const rows = this.repository.db.prepare(`SELECT collectible_id, SUM(quantity) AS quantity, MIN(discovered_at) AS first_found
      FROM collection_discoveries WHERE user_id=? GROUP BY collectible_id`).all(userId) as Row[];
    const owned = new Map(rows.map(row => [String(row.collectible_id), row]));
    return { collectibles: Object.entries(collectibles).map(([id, item]) => ({ id, route: item.route, rarity: item.rarity, name: item.name,
      description: item.description, discovered: owned.has(id), quantity: Number(owned.get(id)?.quantity ?? 0),
      first_found_at: owned.get(id)?.first_found ?? null })),
      discovered: owned.size, total: Object.keys(collectibles).length,
      disclosure: 'Keepsakes are in-game collection records, not tokens or NFTs, and have no cash value.' };
  }
  private petFor(userId: string, petId: string): Pet {
    const row = this.repository.db.prepare('SELECT data FROM pets WHERE id=? AND user_id=?').get(petId, userId) as Row | undefined;
    ensure(row, 404, 'PET_NOT_FOUND', 'Companion not found.');
    return JSON.parse(String(row!.data)) as Pet;
  }
  // ---- cancellation ---------------------------------------------------------------------
  /** Terminal and once-only: a cancelled trip refunds exactly one valueless supply to the starter. */
  private cancel(row: Row, reason: string, now: number): void {
    const changed = this.repository.db.prepare("UPDATE trips SET state='cancelled', cancel_reason=?, settled_at_ms=? WHERE id=? AND state='travelling'")
      .run(reason, now, String(row.id));
    if (changed.changes !== 1) return;
    this.repository.db.prepare('INSERT OR IGNORE INTO supplies_ledger(user_id,event_id,delta,reason,trip_id,utc_day,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(String(row.user_id), `refund:${row.id}`, Number(row.supplies_cost), 'trip_cancelled_refund', String(row.id), utcDay(now), iso(now));
    this.repository.db.prepare('INSERT INTO journal VALUES (?,?,?,?,?)').run(randomUUID(), String(row.user_id), String(row.pet_id),
      'The trip was cancelled because this companion changed hands. One free supply was returned.', iso(now));
  }
  /** Ownership moved away (transfer or escrow) while travelling: cancel the starter's trip. Returns true if cancelled. */
  cancelIfOwnershipChanged(tripUserId: string, tripId: string): boolean {
    return this.inTransaction(() => {
      const row = this.tripRow('id=? AND user_id=?', tripId, tripUserId);
      if (!row) return false;
      if (row.state === 'cancelled') return ['pet_transferred', 'pet_escrowed'].includes(String(row.cancel_reason));
      if (row.state !== 'travelling') return false;
      const pet = this.repository.db.prepare('SELECT user_id FROM pets WHERE id=?').get(String(row.pet_id)) as Row | undefined;
      const escrowed = this.repository.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ownership_assets'").get()
        && this.repository.db.prepare("SELECT 1 FROM ownership_assets WHERE pet_id=? AND state='escrow'").get(String(row.pet_id));
      if (pet && pet.user_id === tripUserId && !escrowed) return false;
      this.cancel(row, escrowed ? 'pet_escrowed' : 'pet_transferred', this.repository.clock()); return true;
    });
  }
  // ---- start ----------------------------------------------------------------------------
  start(userId: string, petId: string, input: unknown, fence?: () => void, ownership?: { wallet?: string; asset?: string; version?: number }) {
    const body = objectBody(input, ['event_id', 'route_id', 'packing_id']);
    const id = eventId(body.event_id);
    ensure(typeof body.route_id === 'string' && body.route_id in routes, 400, 'INVALID_ROUTE', 'Choose an open destination.');
    ensure(typeof body.packing_id === 'string' && body.packing_id in packings, 400, 'INVALID_PACKING', 'Choose something to pack.');
    const digest = requestHash({ operation: 'trip_start', pet_id: petId, route_id: body.route_id, packing_id: body.packing_id });
    return this.inTransaction(() => {
      fence?.();
      const previous = this.tripRow('user_id=? AND start_event_id=?', userId, id);
      if (previous) {
        ensure(previous.start_request_hash === digest, 409, 'EVENT_CONFLICT', 'This request ID was already used for a different trip.');
        return { trip: this.view(previous), supplies: this.supplies(userId), replayed: true };
      }
      const pet = this.petFor(userId, petId);
      const now = this.repository.clock();
      // A trip left behind by a previous owner never blocks the new owner; it is cancelled and refunded to its starter.
      const active = this.tripRow("pet_id=? AND state='travelling'", petId);
      if (active && active.user_id !== userId) this.cancel(active, 'pet_transferred', now);
      else ensure(!active, 409, 'TRIP_ACTIVE', 'This companion is already travelling.', { trip_id: active ? String(active.id) : null });
      this.topUp(userId, now);
      ensure(this.balance(userId) >= 1, 409, 'NO_SUPPLIES', 'No free supplies left today. They refill at 00:00 UTC.', { next_refill_at: iso(nextUtcMidnight(now)) });
      const tripId = randomUUID(); const receiptId = `jr_${randomBytes(16).toString('base64url')}`;
      this.repository.db.prepare('INSERT INTO supplies_ledger(user_id,event_id,delta,reason,trip_id,utc_day,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(userId, `trip:${id}`, -1, 'trip_start', tripId, utcDay(now), iso(now));
      this.repository.db.prepare(`INSERT INTO trips(id,public_receipt_id,user_id,pet_id,starting_wallet,starting_asset,starting_ownership_version,
          route_id,packing_id,supplies_cost,rules_version,loot_table_hash,content_version,temperament_snapshot,started_at_ms,ready_at_ms,
          state,start_event_id,start_request_hash) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,'travelling',?,?)`)
        .run(tripId, receiptId, userId, petId, ownership?.wallet ?? null, ownership?.asset ?? null, ownership?.version ?? null,
          String(body.route_id), String(body.packing_id), RULES_VERSION, LOOT_TABLE_HASH, CONTENT_VERSION, temperamentOf(pet),
          now, now + this.durationMs, id, digest);
      this.repository.db.prepare('INSERT INTO journal VALUES (?,?,?,?,?)').run(randomUUID(), userId, petId,
        `${pet.nickname} set off for ${routes[body.route_id as RouteId].name.en}.`, iso(now));
      return { trip: this.view(this.tripRow('id=?', tripId)!), supplies: this.supplies(userId), replayed: false };
    });
  }
  // ---- reveal ---------------------------------------------------------------------------
  private draw(userId: string, route: RouteId): TripResult & { tierDraw: number } {
    const roll = randomInt(0, 100); // CSPRNG, unbiased integer API
    let cumulative = 0; let tier: Tier = 'common';
    for (const [name, weight] of tiers) { cumulative += weight; if (roll < cumulative) { tier = name; break; } }
    const commons = routes[route].commons;
    if (tier === 'repeat') {
      const owned = (this.repository.db.prepare(`SELECT DISTINCT collectible_id FROM collection_discoveries WHERE user_id=?`).all(userId) as Row[])
        .map(row => String(row.collectible_id)).filter(id => commons.includes(id)).sort();
      if (owned.length) return { tier, items: [[owned[randomInt(0, owned.length)], 1]], event_code: '', clue: null, tierDraw: roll };
      tier = 'common'; // versioned fallback: no owned common from this route yet
    }
    if (tier === 'common') return { tier, items: [[commons[randomInt(0, commons.length)], 1]], event_code: '', clue: null, tierDraw: roll };
    if (tier === 'special') return { tier, items: [[routes[route].special, 1]], event_code: '', clue: null, tierDraw: roll };
    const ids = Object.keys(clues).sort();
    return { tier, items: [], event_code: '', clue: ids[randomInt(0, ids.length)], tierDraw: roll };
  }
  reveal(userId: string, tripId: string, input: unknown, fence?: () => void) {
    const body = objectBody(input, ['event_id']); const id = eventId(body.event_id);
    return this.inTransaction(() => {
      fence?.();
      const row = this.tripRow('id=? AND user_id=?', tripId, userId);
      ensure(row, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
      // Terminal states are final: repeated or concurrent reveals return the stored result.
      if (row!.state !== 'travelling') return { trip: this.view(row!), pet: this.maybePet(userId, String(row!.pet_id)), replayed: true };
      const now = this.repository.clock();
      ensure(now >= Number(row!.ready_at_ms), 409, 'TRIP_NOT_READY', 'Your companion is still on the way.',
        { ready_at: iso(Number(row!.ready_at_ms)), server_time: iso(now) });
      const petRow = this.repository.db.prepare('SELECT data FROM pets WHERE id=? AND user_id=?').get(String(row!.pet_id), userId) as Row | undefined;
      if (!petRow) { this.cancel(row!, 'pet_transferred', now); return { trip: this.view(this.tripRow('id=?', tripId)!), pet: null, replayed: false }; }
      const pet = JSON.parse(String(petRow.data)) as Pet;
      const route = String(row!.route_id) as RouteId; const packing = String(row!.packing_id) as PackingId;
      const drawn = this.draw(userId, route);
      const result: TripResult = { tier: drawn.tier, items: drawn.items, clue: drawn.clue,
        event_code: eventCode(route, row!.temperament_snapshot as never, packing, drawn.tier, drawn.clue ?? undefined) };
      result.postcard = renderPostcard(result.event_code);
      const canonical = canonicalJson(tripResultArray({ public_receipt_id: String(row!.public_receipt_id), route_id: route, packing_id: packing,
        rules_version: Number(row!.rules_version), loot_table_hash: String(row!.loot_table_hash), content_version: Number(row!.content_version),
        temperament_snapshot: String(row!.temperament_snapshot), started_at_ms: Number(row!.started_at_ms), ready_at_ms: Number(row!.ready_at_ms),
        settled_at_ms: now }, result));
      const updated = this.repository.db.prepare(`UPDATE trips SET state='revealed', settled_at_ms=?, result_json=?, canonical_result_bytes=?,
        result_hash=?, reveal_event_id=? WHERE id=? AND state='travelling'`)
        .run(now, JSON.stringify(result), canonical, sha256Hex(canonical), id, tripId);
      ensure(updated.changes === 1, 409, 'TRIP_ALREADY_SETTLED', 'This trip was already settled.');
      for (const [collectible, quantity] of result.items) {
        this.repository.db.prepare('INSERT INTO collection_discoveries VALUES (?,?,?,?,?)').run(userId, collectible, iso(now), quantity, tripId);
      }
      // Base progress always: the trip itself is the record; extra keepsakes may be zero.
      const trait = routes[route].trait;
      pet.traits[trait] += 1; pet.bond = Math.min(100, pet.bond + 1); pet.revision += 1;
      pet.energy = Math.max(0, pet.energy - 5); pet.mood = Math.min(100, pet.mood + 6); pet.updated_at = iso(now);
      let grew = false;
      if (pet.form === 'seed' && pet.bond >= 6) {
        pet.form = pet.traits.sun === pet.traits.moon ? pet.favorite : pet.traits.sun > pet.traits.moon ? 'sun' : 'moon'; grew = true;
      }
      if (pet.temperament === undefined) pet.temperament = temperamentOf(pet);
      this.repository.db.prepare('UPDATE pets SET data=? WHERE id=? AND user_id=?').run(JSON.stringify(pet), pet.id, userId);
      const found = result.items.map(([item]) => collectibles[item].name.en).join(', ');
      this.repository.db.prepare('INSERT INTO journal VALUES (?,?,?,?,?)').run(randomUUID(), userId, pet.id,
        `${pet.nickname} came back from ${routes[route].name.en}${found ? ` with ${found}` : ''}.${grew ? ` It grew into its ${pet.form} form!` : ''}`, iso(now));
      return { trip: this.view(this.tripRow('id=?', tripId)!), pet, replayed: false };
    });
  }
  private maybePet(userId: string, petId: string): Pet | null {
    const row = this.repository.db.prepare('SELECT data FROM pets WHERE id=? AND user_id=?').get(petId, userId) as Row | undefined;
    return row ? JSON.parse(String(row.data)) as Pet : null;
  }
  // ---- chain receipts -------------------------------------------------------------------
  checkpointSource(userId: string, tripId: string): TripCheckpointSource {
    const row = this.tripRow('id=? AND user_id=?', tripId, userId);
    ensure(row, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    ensure(row!.state === 'revealed' && row!.result_hash, 409, 'TRIP_NOT_REVEALED', 'Open the postcard before saving a journey receipt.');
    return { trip_id: String(row!.id), pet_id: String(row!.pet_id), public_receipt_id: String(row!.public_receipt_id), result_hash: String(row!.result_hash) };
  }
  /** Called by ChainService inside its leased write. Long-lived evidence: never deleted when a newer checkpoint lands. */
  recordReceipt(receipt: { trip_id: string; chain_intent_id: string; canonical_checkpoint: string; event_hash: string; network_genesis: string;
    program_id: string; asset_address: string; expected_checkpoint: string; signature: string | null; finalized_slot: number | null; status: string }): void {
    this.repository.db.prepare(`INSERT INTO trip_checkpoint_receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chain_intent_id) DO UPDATE SET signature=excluded.signature, finalized_slot=excluded.finalized_slot,
        status=excluded.status, updated_at=excluded.updated_at`)
      .run(receipt.trip_id, receipt.chain_intent_id, 'pixel-pets:checkpoint:v2', receipt.canonical_checkpoint, receipt.event_hash,
        receipt.network_genesis, receipt.program_id, receipt.asset_address, receipt.expected_checkpoint, receipt.signature,
        receipt.finalized_slot, receipt.status, iso(this.repository.clock()));
  }
  /** Public proof only after the holder saved a confirmed receipt. No nickname, account or private journal data. */
  proof(publicReceiptId: string) {
    ensure(/^jr_[A-Za-z0-9_-]{22}$/.test(publicReceiptId), 404, 'PROOF_NOT_FOUND', 'Journey receipt not found.');
    const row = this.tripRow('public_receipt_id=?', publicReceiptId);
    const receipts = row ? this.repository.db.prepare("SELECT * FROM trip_checkpoint_receipts WHERE trip_id=? AND status='confirmed' ORDER BY finalized_slot")
      .all(String(row.id)) as Row[] : [];
    ensure(row && row.state === 'revealed' && receipts.length, 404, 'PROOF_NOT_FOUND', 'Journey receipt not found.');
    const result = JSON.parse(String(row!.result_json)) as TripResult;
    return {
      schema: 'pixel-pets:journey-proof:v1', public_receipt_id: publicReceiptId,
      statement: 'Rewards are drawn by the server. The result is recorded on Solana.',
      trip_result: { canonical: String(row!.canonical_result_bytes), sha256: String(row!.result_hash) },
      story: (result.postcard ?? renderPostcard(result.event_code)).story,
      items: result.items.map(([id, quantity]) => ({ id, quantity, name: collectibles[id].name.en })),
      checkpoints: receipts.map(receipt => ({ canonical: String(receipt.canonical_checkpoint_bytes), sha256: String(receipt.checkpoint_hash),
        network_genesis: String(receipt.network_genesis), program_id: String(receipt.program_id), asset_address: String(receipt.asset_address),
        expected_checkpoint: String(receipt.expected_checkpoint), signature: String(receipt.signature), finalized_slot: Number(receipt.finalized_slot) })),
      note: 'PetRecord keeps only the latest event_hash; later checkpoints overwrite it. Verify each receipt against its own transaction.',
      story_note: 'Postcard prose is display content. The canonical trip result commits the event code and items, not the prose.',
    };
  }
}
