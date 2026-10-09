import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import { speciesTemperament } from './travel-content.ts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiError, addressBytes, catalog, eventId, hash, iso, nickname, objectBody, requestHash, secret, verifyWalletSignature } from './domain.ts';
import type { Action, Pet } from './domain.ts';

export type RepositoryOptions = { clock?: () => number; publicOrigin?: string; network?: 'localnet' | 'devnet' | 'mainnet-beta'; };
export type RecoveredSession = {
  token: string; game_token: string; user_id: string; wallet_address: string; network: string;
  expires_at: string; game_expires_at: string;
};
type Row = Record<string, string | number | null>;
export class Repository {
  db: DatabaseSync; clock: () => number; publicOrigin: string; network: 'localnet' | 'devnet' | 'mainnet-beta';
  constructor(path: string, options: RepositoryOptions = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.clock = options.clock ?? Date.now;
    this.publicOrigin = new URL(options.publicOrigin ?? 'http://127.0.0.1:9783').origin;
    const origin = new URL(this.publicOrigin);
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('PUBLIC_ORIGIN must be HTTPS or loopback HTTP');
    this.network = options.network ?? 'devnet';
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS pets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, last_care_at INTEGER);
      CREATE INDEX IF NOT EXISTS pets_user ON pets(user_id);
      CREATE TABLE IF NOT EXISTS events (user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,event_id));
      CREATE TABLE IF NOT EXISTS journal (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), pet_id TEXT NOT NULL REFERENCES pets(id), message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS journal_user ON journal(user_id,created_at);
      CREATE TABLE IF NOT EXISTS wallets (address TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), address TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS challenge_expiry ON challenges(expires_at);
      CREATE TABLE IF NOT EXISTS wallet_recovery_challenges (
        id TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, origin TEXT NOT NULL,
        network TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS wallet_recovery_expiry ON wallet_recovery_challenges(expires_at);`);
    // Additive migration: old pets and sessions remain intact, and a newer schema version never moves backwards.
    const version = this.db.prepare('PRAGMA user_version').get() as Row;
    if (Number(version.user_version) < 2) this.db.exec('PRAGMA user_version=2');
  }
  close(): void { this.db.close(); }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  guest(): { token: string; user_id: string } {
    return this.transaction(() => {
      const user_id = randomUUID(); const token = secret(); const now = this.clock();
      this.db.prepare('INSERT INTO users VALUES (?,?)').run(user_id, iso(now));
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL)').run(hash(token), user_id, 'guest', now);
      return { token, user_id };
    });
  }
  authenticate(token: string | undefined, walletOnly = false): { user_id: string; kind: string } {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHORIZED', '请重新连接你的会话。');
    const row = this.db.prepare('SELECT user_id,kind,expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as Row | undefined;
    if (!row || (row.expires_at !== null && Number(row.expires_at) <= this.clock()) || (walletOnly && row.kind !== 'wallet')) throw new ApiError(401, 'UNAUTHORIZED', '会话已过期，请重新连接。');
    return { user_id: String(row.user_id), kind: String(row.kind) };
  }
  listPets(userId: string): { pets: Pet[] } {
    const rows = this.db.prepare('SELECT data FROM pets WHERE user_id=? ORDER BY rowid').all(userId) as Row[];
    return { pets: rows.map(row => JSON.parse(String(row.data)) as Pet) };
  }
  private petRow(userId: string, id: string): Row {
    const row = this.db.prepare('SELECT data,last_care_at FROM pets WHERE id=? AND user_id=?').get(id, userId) as Row | undefined;
    if (!row) throw new ApiError(404, 'PET_NOT_FOUND', '找不到这位伙伴。');
    return row;
  }
  private previous(userId: string, id: string, digest: string): unknown | undefined {
    const row = this.db.prepare('SELECT request_hash,response FROM events WHERE user_id=? AND event_id=?').get(userId, id) as Row | undefined;
    if (!row) return undefined;
    if (row.request_hash !== digest) throw new ApiError(409, 'EVENT_CONFLICT', '这个事件标识已用于另一个操作，请重新尝试。');
    return JSON.parse(String(row.response));
  }
  private remember(userId: string, id: string, digest: string, response: unknown): void {
    this.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(userId, id, digest, JSON.stringify(response));
  }
  private entry(userId: string, petId: string, message: string, now: number): void {
    this.db.prepare('INSERT INTO journal VALUES (?,?,?,?,?)').run(randomUUID(), userId, petId, message, iso(now));
  }
  adopt(userId: string, input: unknown): unknown {
    const body = objectBody(input, ['species_id', 'nickname', 'event_id']);
    const species = catalog.species.find(item => item.id === body.species_id);
    if (!species) throw new ApiError(400, 'INVALID_SPECIES', '请选择卡册里的伙伴。');
    const name = nickname(body.nickname); const id = eventId(body.event_id);
    const digest = requestHash({ operation: 'adopt', ...body });
    return this.transaction(() => {
      const previous = this.previous(userId, id, digest) as { pet: Pet } | undefined;
      if (previous !== undefined) { this.petRow(userId, previous.pet.id); return previous; }
      const hasOwnership = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ownership_assets'").get();
      const count = (hasOwnership
        ? this.db.prepare(`SELECT COUNT(*) AS total FROM pets p WHERE COALESCE(json_extract(p.data,'$.chain.received'),0)<>1
          AND (p.user_id=? OR EXISTS (SELECT 1 FROM ownership_assets o JOIN wallets w ON w.address=o.beneficiary_address
            WHERE o.pet_id=p.id AND o.state='escrow' AND w.user_id=?))`).get(userId, userId)
        : this.db.prepare("SELECT COUNT(*) AS total FROM pets WHERE user_id=? AND COALESCE(json_extract(data,'$.chain.received'),0)<>1").get(userId)) as Row;
      if (Number(count.total) >= 3) throw new ApiError(409, 'PET_LIMIT', '目前最多免费领养 3 位伙伴；收到的链上伙伴不占用领养名额。');
      const now = this.clock();
      const pet: Pet = { id: randomUUID(), species_id: species.id, nickname: name, form: 'seed', bond: 0, energy: 80, mood: 70, care_count: 0, created_at: iso(now), updated_at: iso(now), revision: 1, traits: { sun: 0, moon: 0 }, chain: { status: 'unregistered' }, favorite: species.id === 'moss' ? 'sun' : 'moon',
        // Individual temperament: species base is twice as likely as each other template (CSPRNG).
        temperament: (() => { const base = speciesTemperament[species.id]; const pool = [base, base, ...(['cautious', 'curious', 'greedy'] as const).filter(t => t !== base)]; return pool[randomInt(0, pool.length)]; })() };
      this.db.prepare('INSERT INTO pets VALUES (?,?,?,NULL)').run(pet.id, userId, JSON.stringify(pet));
      this.entry(userId, pet.id, `${name} 来到了你身边。你们的故事从今天开始。`, now);
      const response = { pet }; this.remember(userId, id, digest, response); return response;
    });
  }
  care(userId: string, petId: string, input: unknown, ownershipFence?: () => void): unknown {
    const body = objectBody(input, ['action', 'event_id'], ['choice']);
    if (!['feed', 'play', 'rest', 'explore'].includes(String(body.action)) || typeof body.action !== 'string') throw new ApiError(400, 'INVALID_ACTION', '这个动作暂时不可用。');
    if (body.choice !== undefined && body.choice !== 'sun' && body.choice !== 'moon') throw new ApiError(400, 'INVALID_CHOICE', '请选择阳光或月亮。');
    const id = eventId(body.event_id); const digest = requestHash({ operation: 'care', pet_id: petId, ...body });
    return this.transaction(() => {
      ownershipFence?.();
      const row = this.petRow(userId, petId);
      const previous = this.previous(userId, id, digest); if (previous !== undefined) return previous;
      const pet = JSON.parse(String(row.data)) as Pet;
      const now = this.clock(); const next = Number(row.last_care_at) + 12000;
      if (row.last_care_at !== null && now < next) {
        const response = { pet, event: { id, message: '伙伴正在回味刚才的陪伴，稍等一小会儿。', message_en: 'Your companion is still savouring that moment. Try again in a few seconds.', applied: false, next_allowed_at: iso(next) } };
        this.remember(userId, id, digest, response); return response;
      }
      const action = body.action as Action;
      const choice = body.choice as 'sun' | 'moon' | undefined;
      const preference = choice ?? (action === 'rest' ? 'moon' : action === 'play' || action === 'feed' ? 'sun' : pet.favorite);
      pet.traits[preference] += 1; pet.bond = Math.min(100, pet.bond + 1); pet.care_count += 1; pet.revision += 1;
      pet.energy = Math.max(0, Math.min(100, pet.energy + ({ feed: 5, play: -8, rest: 15, explore: -5 }[action])));
      pet.mood = Math.min(100, pet.mood + ({ feed: 4, play: 8, rest: 3, explore: 6 }[action]));
      pet.updated_at = iso(now);
      let message = ({ feed: `${pet.nickname} 开心地吃光了点心，还悄悄蹭了蹭你。`, play: `${pet.nickname} 和你追逐了一小束光，玩得很开心。`, rest: `${pet.nickname} 在你身旁安心地打了个盹。`, explore: preference === 'sun' ? `${pet.nickname} 和你发现了一处暖洋洋的角落。` : `${pet.nickname} 和你收藏了一点安静的月光。` }[action]);
      let messageEn = ({ feed: `${pet.nickname} finished the snack and gave you a little nuzzle.`, play: `${pet.nickname} chased a tiny beam of light with you.`, rest: `${pet.nickname} took a calm nap beside you.`, explore: preference === 'sun' ? `${pet.nickname} found a warm, sunny corner with you.` : `${pet.nickname} gathered a little quiet moonlight with you.` }[action]);
      if (pet.form === 'seed' && pet.bond >= 6) {
        pet.form = pet.traits.sun === pet.traits.moon ? pet.favorite : pet.traits.sun > pet.traits.moon ? 'sun' : 'moon';
        message += ` 你们的陪伴让它成长为${pet.form === 'sun' ? '阳光' : '月色'}形态！`;
        messageEn += ` Your time together helped it grow into its ${pet.form === 'sun' ? 'sunny' : 'moonlit'} form!`;
      }
      this.db.prepare('UPDATE pets SET data=?,last_care_at=? WHERE id=? AND user_id=?').run(JSON.stringify(pet), now, petId, userId);
      this.entry(userId, petId, message, now);
      const response = { pet, event: { id, message, message_en: messageEn, applied: true, next_allowed_at: iso(now + 12000) } };
      this.remember(userId, id, digest, response); return response;
    });
  }
  rename(userId: string, petId: string, input: unknown, ownershipFence?: () => void): { pet: Pet } {
    const body = objectBody(input, ['nickname']); const name = nickname(body.nickname);
    return this.transaction(() => {
      ownershipFence?.();
      const pet = JSON.parse(String(this.petRow(userId, petId).data)) as Pet;
      pet.nickname = name; pet.revision += 1; pet.updated_at = iso(this.clock());
      this.db.prepare('UPDATE pets SET data=? WHERE id=? AND user_id=?').run(JSON.stringify(pet), petId, userId);
      return { pet };
    });
  }
  journal(userId: string): { entries: Row[] } {
    return { entries: this.db.prepare('SELECT id,pet_id,message,created_at FROM journal WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(userId) as Row[] };
  }
  challenge(userId: string, input: unknown): { challenge_id: string; message: string; expires_at: string } {
    const body = objectBody(input, ['address']); addressBytes(body.address);
    const address = body.address as string; const id = randomUUID(); const now = this.clock(); const expires = now + 300000;
    const domain = new URL(this.publicOrigin).host;
    const message = `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to PixelPets. This does not submit a transaction or grant asset transfer permission.\n\nURI: ${this.publicOrigin}\nVersion: 1\nChain ID: solana:${this.network === 'mainnet-beta' ? 'mainnet' : this.network}\nNonce: ${secret().replace(/[-_]/g, '0')}\nIssued At: ${iso(now)}\nExpiration Time: ${iso(expires)}\nRequest ID: ${id}`;
    this.transaction(() => {
      this.db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now - 86400000);
      this.db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?,0)').run(id, userId, address, message, expires);
    });
    return { challenge_id: id, message, expires_at: iso(expires) };
  }
  verifyWallet(userId: string, input: unknown): { token: string; user_id: string; wallet_address: string; expires_at: string; network: string } {
    const body = objectBody(input, ['challenge_id', 'signature']);
    if (typeof body.challenge_id !== 'string' || body.challenge_id.length > 64) throw new ApiError(400, 'INVALID_CHALLENGE', '登录请求无效。');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM challenges WHERE id=? AND user_id=?').get(body.challenge_id as string, userId) as Row | undefined;
      const now = this.clock();
      if (!row || row.used !== 0 || Number(row.expires_at) <= now) throw new ApiError(401, 'CHALLENGE_EXPIRED', '登录请求已失效，请重新连接钱包。');
      if (!verifyWalletSignature(String(row.address), String(row.message), body.signature)) throw new ApiError(401, 'INVALID_SIGNATURE', '钱包签名未通过验证。');
      const binding = this.db.prepare('SELECT address,user_id FROM wallets WHERE address=? OR user_id=?').all(String(row.address), userId) as Row[];
      if (binding.some(item => item.user_id !== userId || item.address !== row.address)) throw new ApiError(409, 'WALLET_ALREADY_LINKED', '钱包或档案已绑定另一个账户；请使用找回档案入口，不会合并游客档案。');
      this.db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(String(row.id));
      this.db.prepare('INSERT OR IGNORE INTO wallets VALUES (?,?,?)').run(String(row.address), userId, iso(now));
      const token = secret(); const expires = now + 86400000;
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(hash(token), userId, 'wallet', now, expires);
      return { token, user_id: userId, wallet_address: String(row.address), expires_at: iso(expires), network: this.network };
    });
  }
  recoveryChallenge(input: unknown): { challenge_id: string; message: string; expires_at: string } {
    const body = objectBody(input, ['address']); addressBytes(body.address);
    const address = body.address as string; const id = randomUUID(); const now = this.clock(); const expires = now + 300000;
    const domain = new URL(this.publicOrigin).host;
    const message = `${domain} wants you to sign in with your Solana account:\n${address}\n\nRecover your existing PixelPets account on this device. This does not merge guest profiles, submit a transaction, or grant asset transfer permission.\n\nURI: ${this.publicOrigin}\nVersion: 1\nChain ID: solana:${this.network === 'mainnet-beta' ? 'mainnet' : this.network}\nNonce: ${secret().replace(/[-_]/g, '0')}\nIssued At: ${iso(now)}\nExpiration Time: ${iso(expires)}\nRequest ID: ${id}\nResources:\n- urn:pixelpets:account-recovery`;
    // The challenge deliberately does not look up wallets: an unsigned request cannot enumerate accounts.
    this.transaction(() => {
      this.db.prepare('DELETE FROM wallet_recovery_challenges WHERE expires_at < ?').run(now - 86400000);
      this.db.prepare('INSERT INTO wallet_recovery_challenges VALUES (?,?,?,?,?,?,?,0)')
        .run(id, address, message, this.publicOrigin, this.network, 'account-recovery', expires);
    });
    return { challenge_id: id, message, expires_at: iso(expires) };
  }
  recoverWallet(input: unknown): RecoveredSession {
    const body = objectBody(input, ['challenge_id', 'signature']);
    if (typeof body.challenge_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.challenge_id)) {
      throw new ApiError(400, 'INVALID_CHALLENGE', '找回请求无效。');
    }
    const result = this.transaction((): RecoveredSession | null => {
      const row = this.db.prepare('SELECT * FROM wallet_recovery_challenges WHERE id=?').get(body.challenge_id as string) as Row | undefined;
      const now = this.clock();
      if (!row || row.used !== 0 || Number(row.expires_at) <= now || row.origin !== this.publicOrigin
        || row.network !== this.network || row.purpose !== 'account-recovery') {
        throw new ApiError(401, 'CHALLENGE_EXPIRED', '找回请求已失效，请重新使用钱包找回档案。');
      }
      if (!verifyWalletSignature(String(row.address), String(row.message), body.signature)) {
        throw new ApiError(401, 'INVALID_SIGNATURE', '钱包签名未通过验证。');
      }
      this.db.prepare('UPDATE wallet_recovery_challenges SET used=1 WHERE id=?').run(String(row.id));
      const binding = this.db.prepare('SELECT user_id FROM wallets WHERE address=?').get(String(row.address)) as Row | undefined;
      // Commit consumption even when the wallet is not linked; a valid proof is single-use in either case.
      if (!binding) return null;
      const userId = String(binding.user_id); const token = secret(); const gameToken = secret();
      const expires = now + 86400000; const gameExpires = now + 30 * 86400000;
      const insert = this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)');
      insert.run(hash(token), userId, 'wallet', now, expires);
      insert.run(hash(gameToken), userId, 'player', now, gameExpires);
      return { token, game_token: gameToken, user_id: userId, wallet_address: String(row.address), network: this.network,
        expires_at: iso(expires), game_expires_at: iso(gameExpires) };
    });
    if (!result) throw new ApiError(404, 'WALLET_NOT_LINKED', '这个钱包还没有绑定 PixelPets 档案，请先免费领养并绑定钱包。');
    return result;
  }
  walletSession(userId: string): { user_id: string; wallet_address: string; network: string } {
    const row = this.db.prepare('SELECT address FROM wallets WHERE user_id=?').get(userId) as Row | undefined;
    if (!row) throw new ApiError(401, 'WALLET_NOT_LINKED', '尚未连接钱包。');
    return { user_id: userId, wallet_address: String(row.address), network: this.network };
  }
  revokeSession(token: string): void { this.db.prepare('DELETE FROM sessions WHERE token_hash=? AND kind=?').run(hash(token), 'wallet'); }
}
