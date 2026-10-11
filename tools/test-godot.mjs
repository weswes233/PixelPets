// Portable Godot regression runner. Every suite uses fixtures or an isolated in-memory API.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const game = fileURLToPath(new URL('../game', import.meta.url));
const godot = process.env.PIXELPETS_GODOT_PATH ?? (process.platform === 'win32' ? 'Godot_v4.5.2-stable_win64_console.exe' : 'godot');
const options = { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000 };
execFileSync(process.execPath, ['tools/build-codex.mjs'], options);
execFileSync(godot, ['--headless', '--path', game, '--editor', '--import'], options);
for (const suite of ['client_test', 'travel_test', 'travel_recovery_test', 'ui_polish_test']) {
  execFileSync(godot, ['--headless', '--path', game, '--script', `tests/${suite}.gd`, '--', '--client-test'], options);
}
execFileSync(godot, ['--headless', '--path', game, '--script', 'tests/session_storage_test.gd', '--', '--session-storage-test'], options);
execFileSync(process.execPath, ['tools/test-godot-http.mjs'], { ...options, env: { ...process.env, PIXELPETS_GODOT_PATH: godot } });
