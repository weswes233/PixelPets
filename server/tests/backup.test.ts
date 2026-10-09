import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Repository } from '../src/repository.ts';
import { ChainService } from '../src/chain-service.ts';
import { OwnershipService } from '../src/ownership-service.ts';
import { backupDatabase, verifyDatabase } from '../../tools/backup.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-backup-test-')); const source = join(directory, 'source.sqlite');
  const repo = new Repository(source); new ChainService(repo); new OwnershipService(repo);
  repo.db.exec('PRAGMA wal_autocheckpoint=0');
  const guest = repo.guest();
  const pet = (repo.adopt(guest.user_id, { species_id: 'moss', nickname: '备份苔苔', event_id: 'backup_adopt_0001' }) as { pet: { id: string } }).pet;
  repo.db.prepare('INSERT INTO wallets VALUES (?,?,?)').run('11111111111111111111111111111111', guest.user_id, '2026-10-08T00:00:00.000Z');
  const pending = { state: 'pending', kind: 'claim', attempts: [{ signature: 'fixture-signature', signed_transaction_base64: 'AQID', state: 'pending' }] };
  repo.db.prepare('INSERT INTO chain_intents VALUES (?,?,?,?,?)').run('intent-backup', 'claim-backup', guest.user_id, pet.id, JSON.stringify(pending));
  repo.db.prepare('INSERT INTO chain_leases VALUES (?,?,?)').run('pet-backup', 'fixture-lease', Date.now() + 10000);
  const recovery = repo.recoveryChallenge({ address: '11111111111111111111111111111111' });
  repo.db.prepare('INSERT INTO ownership_assets VALUES (?,?,?,?,?,?,?,?,?,?)').run('backup-scope', pet.id,
    '11111111111111111111111111111111', '11111111111111111111111111111111', '11111111111111111111111111111111',
    10, 'a'.repeat(64), 'owned', '2026-10-08T00:00:00.000Z', null);
  repo.db.prepare('INSERT INTO ownership_leases VALUES (?,?,?)').run('backup-scope', 'ownership-fixture-lease', Date.now() + 10000);
  repo.db.prepare('INSERT INTO ownership_transfers VALUES (?,?,?,?,?,?,?)').run('backup-transfer', pet.id, guest.user_id,
    '11111111111111111111111111111111', 10, JSON.stringify(pet), '2026-10-08T00:00:00.000Z');
  function close() { repo.close(); rmSync(directory, { recursive: true, force: true }); }
  return { directory, source, repo, guest, pet, pending, recovery, close };
}

test('online WAL backup preserves users, pets, idempotent events, wallet and pending chain records', async () => {
  const f = fixture();
  try {
    assert.ok(statSync(`${f.source}-wal`).size > 0);
    const destination = join(f.directory, 'complete.sqlite');
    const report = await backupDatabase({ source: f.source, destination });
    assert.match(report.sha256, /^[a-f0-9]{64}$/); assert.ok(report.pages > 0); assert.ok(report.bytes > 0);
    assert.equal(report.verification.integrity, 'ok'); assert.equal(report.verification.tables.users, 1);
    assert.equal(report.verification.tables.pets, 1); assert.equal(report.verification.tables.events, 1);
    assert.equal(report.verification.tables.wallets, 1); assert.equal(report.verification.tables.chain_intents, 1);
    assert.equal(report.verification.tables.chain_leases, 1);
    assert.equal(report.verification.tables.wallet_recovery_challenges, 1);
    assert.equal(report.verification.tables.ownership_assets, 1);
    assert.equal(report.verification.tables.ownership_leases, 1);
    assert.equal(report.verification.tables.ownership_transfers, 1);
    const restored = new Repository(destination); new ChainService(restored);
    try {
      assert.equal(restored.authenticate(f.guest.token).user_id, f.guest.user_id);
      assert.equal(restored.listPets(f.guest.user_id).pets[0].nickname, '备份苔苔');
      const replay = restored.adopt(f.guest.user_id, { species_id: 'moss', nickname: '备份苔苔', event_id: 'backup_adopt_0001' }) as { pet: { id: string } };
      assert.equal(replay.pet.id, f.pet.id); assert.equal(restored.listPets(f.guest.user_id).pets.length, 1);
      assert.deepEqual(JSON.parse(String(restored.db.prepare('SELECT data FROM chain_intents').get()!.data)), f.pending);
      assert.equal(restored.db.prepare('SELECT address FROM wallets').get()!.address, '11111111111111111111111111111111');
      assert.equal(restored.db.prepare('SELECT id FROM wallet_recovery_challenges').get()!.id, f.recovery.challenge_id);
      assert.equal(restored.db.prepare('SELECT token FROM ownership_leases').get()!.token, 'ownership-fixture-lease');
      assert.equal(restored.db.prepare('SELECT slot FROM ownership_assets').get()!.slot, 10);
      assert.deepEqual(JSON.parse(String(restored.db.prepare('SELECT previous_data FROM ownership_transfers').get()!.previous_data)), f.pet);
    } finally { restored.close(); }
    assert.equal(f.repo.guest().user_id.length, 36, 'source remains writable after online backup');
    assert.equal(verifyDatabase(destination).tables.users, 1, 'later source writes do not mutate snapshot');
    assert.ok(readdirSync(f.directory).every(name => !name.startsWith('.pixelpets-backup-')));
  } finally { f.close(); }
});

test('backup refuses source, existing destination and existing destination sidecars without modifying them', async () => {
  const f = fixture();
  try {
    await assert.rejects(backupDatabase({ source: f.source, destination: f.source }), /already exists/);
    const existing = join(f.directory, 'existing.sqlite'); writeFileSync(existing, 'keep-this-file');
    await assert.rejects(backupDatabase({ source: f.source, destination: existing }), /already exists/);
    assert.equal(readFileSync(existing, 'utf8'), 'keep-this-file');
    const busyTarget = join(f.directory, 'busy.sqlite'); writeFileSync(`${busyTarget}-wal`, 'keep-this-wal');
    await assert.rejects(backupDatabase({ source: f.source, destination: busyTarget }), /already exists/);
    assert.equal(readFileSync(`${busyTarget}-wal`, 'utf8'), 'keep-this-wal');
    assert.equal(f.repo.listPets(f.guest.user_id).pets.length, 1);
  } finally { f.close(); }
});

test('concurrent backups to one destination publish exactly one complete snapshot', async () => {
  const f = fixture();
  try {
    const destination = join(f.directory, 'one.sqlite');
    const results = await Promise.allSettled([backupDatabase({ source: f.source, destination }), backupDatabase({ source: f.source, destination })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(verifyDatabase(destination).tables.chain_intents, 1);
    assert.ok(readdirSync(f.directory).every(name => !name.startsWith('.pixelpets-backup-')));
  } finally { f.close(); }
});

test('failed schema/integrity checks clean only newly created temporary backup files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pixelpets-backup-failure-'));
  try {
    const wrong = join(directory, 'unrelated.sqlite'); const db = new DatabaseSync(wrong);
    db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY); INSERT INTO unrelated VALUES(1)'); db.close();
    const keep = join(directory, '.pixelpets-backup-do-not-delete'); writeFileSync(keep, 'unrelated');
    await assert.rejects(backupDatabase({ source: wrong, destination: join(directory, 'output.sqlite') }), /missing required/);
    assert.deepEqual(readdirSync(directory).sort(), ['.pixelpets-backup-do-not-delete', 'unrelated.sqlite']);
    assert.equal(readFileSync(keep, 'utf8'), 'unrelated');
    const corrupt = join(directory, 'corrupt.sqlite'); writeFileSync(corrupt, 'not a database');
    await assert.rejects(backupDatabase({ source: corrupt, destination: join(directory, 'corrupt-output.sqlite') }));
    assert.equal(readFileSync(corrupt, 'utf8'), 'not a database');
    assert.ok(!readdirSync(directory).includes('corrupt-output.sqlite'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('restore CLI requires a new destination and produces a separately verifiable database', async () => {
  const f = fixture();
  try {
    const snapshot = join(f.directory, 'snapshot.sqlite'); await backupDatabase({ source: f.source, destination: snapshot });
    const tool = resolve(import.meta.dirname, '../../tools/backup.ts');
    const missingTarget = spawnSync(process.execPath, [tool, 'restore', '--source', snapshot], { encoding: 'utf8' });
    assert.notEqual(missingTarget.status, 0); assert.match(missingTarget.stderr, /requires a new/);
    const restoredPath = join(f.directory, 'restored.sqlite');
    const restored = spawnSync(process.execPath, [tool, 'restore', '--source', snapshot, '--destination', restoredPath], { encoding: 'utf8' });
    assert.equal(restored.status, 0, restored.stderr); assert.equal(JSON.parse(restored.stdout).verification.tables.pets, 1);
    const verified = spawnSync(process.execPath, [tool, 'verify', '--source', restoredPath], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr); assert.equal(JSON.parse(verified.stdout).tables.chain_intents, 1);
    const overwrite = spawnSync(process.execPath, [tool, 'restore', '--source', snapshot, '--destination', f.source], { encoding: 'utf8' });
    assert.notEqual(overwrite.status, 0); assert.equal(f.repo.listPets(f.guest.user_id).pets.length, 1);
  } finally { f.close(); }
});
