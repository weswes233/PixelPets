import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, createReadStream, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredTables = ['users', 'sessions', 'pets', 'events', 'journal', 'wallets', 'challenges', 'chain_intents', 'chain_leases'];
export type DatabaseVerification = { integrity: 'ok'; foreignKeys: 'ok'; schemaVersion: number; tables: Record<string, number> };

function sourceFile(path: string): string {
  const result = realpathSync(resolve(path));
  if (!statSync(result).isFile()) throw new Error('Source must be an existing SQLite file');
  return result;
}
function assertAbsent(path: string): void {
  try { lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('Destination already exists; backup and restore never overwrite files');
}

/** Read-only integrity/schema checks; counts only, never prints session tokens or chain transaction data. */
export function verifyDatabase(path: string): DatabaseVerification {
  const db = new DatabaseSync(sourceFile(path), { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed');
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
    if (requiredTables.some(table => !tables.includes(table))) throw new Error('Database is missing required PixelPets tables');
    const counts: Record<string, number> = {};
    for (const name of tables) counts[name] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get()!.count);
    return { integrity: 'ok', foreignKeys: 'ok', schemaVersion: Number(db.prepare('PRAGMA user_version').get()!.user_version), tables: counts };
  } finally { db.close(); }
}

export async function backupDatabase(options: { source: string; destination?: string }): Promise<{
  destination: string; pages: number; bytes: number; sha256: string; verification: DatabaseVerification;
}> {
  const source = sourceFile(options.source);
  const destination = resolve(options.destination ?? join(projectRoot, 'runtime/backups', `pets-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`));
  assertAbsent(destination);
  // The sidecars may belong to an existing/live database even when its main file was moved.
  for (const suffix of ['-wal', '-shm', '-journal']) assertAbsent(`${destination}${suffix}`);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporaryDirectory = mkdtempSync(join(dirname(destination), '.pixelpets-backup-'));
  const temporaryFile = join(temporaryDirectory, 'snapshot.sqlite');
  let sourceDb: DatabaseSync | undefined;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    // sqlite.backup takes a consistent snapshot including committed WAL pages. A raw main-file copy cannot.
    const pages = await backup(sourceDb, temporaryFile);
    sourceDb.close(); sourceDb = undefined;
    // Use a self-contained DELETE-journal database before publishing this single-file artifact.
    const snapshot = new DatabaseSync(temporaryFile);
    try { snapshot.exec('PRAGMA journal_mode=DELETE;'); } finally { snapshot.close(); }
    chmodSync(temporaryFile, 0o600);
    const verification = verifyDatabase(temporaryFile);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(temporaryFile)) digest.update(chunk);
    const fd = openSync(temporaryFile, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    // A same-filesystem hard link publishes atomically and fails if any existing file/symlink won the race.
    // No rename that could overwrite an existing destination, and no partial final file on failed copies.
    for (const suffix of ['-wal', '-shm', '-journal']) assertAbsent(`${destination}${suffix}`);
    linkSync(temporaryFile, destination);
    return { destination, pages, bytes: statSync(destination).size, sha256: digest.digest('hex'), verification };
  } finally {
    sourceDb?.close();
    // Delete only the fixed paths in the unique directory created by this invocation. Never recurse.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(`${temporaryFile}${suffix}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    rmdirSync(temporaryDirectory);
  }
}

function argumentsFor(argv: string[]): { operation: string; source: string; destination?: string } {
  const operation = argv[0];
  if (!['backup', 'verify', 'restore'].includes(operation)) throw new Error('Usage: node tools/backup.ts backup|verify|restore --source FILE [--destination NEW_FILE]');
  const values: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!['--source', '--destination'].includes(key) || !value || value.startsWith('--') || values[key]) throw new Error('Invalid or duplicate argument');
    values[key] = value;
  }
  if (operation !== 'backup' && !values['--source']) throw new Error('An explicit --source file is required');
  if (operation === 'restore' && !values['--destination']) throw new Error('Restore requires a new --destination file; existing databases are never replaced');
  if (operation === 'verify' && values['--destination']) throw new Error('Verify is read-only and has no destination');
  return { operation, source: values['--source'] ?? process.env.PIXELPETS_DB ?? join(projectRoot, 'runtime/pets.sqlite'), destination: values['--destination'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    const result = options.operation === 'verify' ? verifyDatabase(options.source) : await backupDatabase(options);
    console.log(JSON.stringify({ operation: options.operation, ...result }, null, 2));
  } catch (error) {
    console.error(`Database operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exitCode = 1;
  }
}
