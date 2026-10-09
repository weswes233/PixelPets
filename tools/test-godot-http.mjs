/** Isolated Godot HTTP regression: ephemeral loopback server and in-memory database. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Repository, start } from '../server/src/public.ts';

const repository = new Repository(':memory:');
const server = await start({ repository, port: 0 });
const godot = process.env.PIXELPETS_GODOT_PATH ?? 'Godot_v4.5.2-stable_win64_console.exe';
try {
  const result = await promisify(execFile)(godot, ['--headless', '--path', fileURLToPath(new URL('../game', import.meta.url)),
    '--script', 'res://tests/api_test.gd'], {
    windowsHide: true, timeout: 60000, maxBuffer: 1048576,
    env: { ...process.env, PIXELPETS_API_URL: `http://127.0.0.1:${server.address().port}` },
  });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.match(result.stdout, /PixelPets HTTP client: 11 checks, 0 failures/);
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  repository.close();
}
