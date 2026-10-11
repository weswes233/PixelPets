// Exercise the shipped, bundled services with the shipped runtime. No node_modules at runtime.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = path.resolve(process.argv[2] ?? path.join(root, 'dist/release/PixelPets'));
await mkdir(path.join(root, 'runtime'), { recursive: true });
const scratch = await mkdtemp(path.join(root, 'runtime/release-test-'));
const node = path.join(release, 'runtime/node/node.exe');
const children = new Set();
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function launch(script, overrides, pattern) {
  const child = spawn(node, [path.join(release, script)], { cwd: release, windowsHide: true, env: { ...process.env, ...overrides } });
  children.add(child);
  let stdout = '', stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Service startup timed out: ' + stderr)), 20000);
    child.stdout.on('data', bytes => {
      stdout += bytes;
      const match = stdout.match(pattern);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Service exited ${code}: ${stderr}`)); });
  });
  return { child, port: Number(result) };
}
async function stop(child) { if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } children.delete(child); }
let api, web;
try {
  const environment = { PIXELPETS_DB: path.join(scratch, 'test.sqlite'), TRAVEL_DURATION_MS: '1000', PORT: '0' };
  api = await launch('server/src/index.mjs', environment, /API ready on port (\d+)/);
  web = await launch('tools/serve.mjs', { WEB_PORT: '0', API_PORT: String(api.port) }, /web: http:\/\/127\.0\.0\.1:(\d+)/);
  const origin = `http://127.0.0.1:${web.port}`;
  let token;
  async function request(method, route, body) {
    const response = await fetch(origin + '/api/v1' + route, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...(await response.json()) };
  }
  check((await request('GET', '/health')).data.service, 'pixel-pets', 'Proxy reaches packaged API');
  for (const asset of ['/', '/index.wasm', '/index.pck', '/bridge.js']) {
    const response = await fetch(origin + asset);
    check(response.status, 200, asset + ' ships in package');
    if (asset !== '/') check(response.headers.get('content-encoding'), 'gzip', asset + ' serves a compressed export');
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 100); checks++;
  }
  check((await fetch(origin + '/.env')).status, 403, 'Private paths stay blocked');
  token = (await request('POST', '/guests', {})).data.token;
  const pet = (await request('POST', '/pets', { species_id: 'wisp', nickname: 'Release test', event_id: 'release_adopt_1' })).data.pet;
  check(pet.form, 'seed', 'New companion starts in its seed form');
  const care = (await request('POST', `/pets/${pet.id}/care`, { action: 'explore', choice: 'moon', event_id: 'release_care_1' })).data;
  check(care.pet.bond, 1, 'Server saves care');
  check(Date.parse(care.event.next_allowed_at) - Date.parse(care.event.server_time), 12000, 'Cooldown is authoritative');
  check((await request('PATCH', `/pets/${pet.id}`, { nickname: 'Luna' })).data.pet.nickname, 'Luna', 'Rename persists');
  const trip = (await request('POST', `/pets/${pet.id}/trips`, { route_id: 'moonlit_lane', packing_id: 'tiny_lantern', event_id: 'release_start_1' })).data.trip;
  check((await request('POST', `/trips/${trip.id}/reveal`, { event_id: 'release_early_1' })).status, 409, 'Early reveal cannot bypass server time');
  await delay(1100);
  const revealed = await request('POST', `/trips/${trip.id}/reveal`, { event_id: 'release_reveal_1' });
  check(revealed.data.trip.state, 'revealed', 'Completed trip reveals a postcard');
  assert.ok(revealed.data.trip.result.story.en.title && revealed.data.trip.result.story.zh.title); checks++;
  check((await request('POST', `/trips/${trip.id}/reveal`, { event_id: 'release_reveal_1' })).data.trip.result.result_hash,
    revealed.data.trip.result.result_hash, 'Retry cannot redraw rewards');
  check((await request('GET', '/trips')).data.trips.length, 1, 'Postcard appears in archive');
  check((await request('GET', '/collections')).data.collectibles.length, 8, 'Collection includes all eight keepsakes');
  const journal = (await request('GET', '/journal')).data.entries;
  check(journal.length, 4, 'Adoption, care, departure and return are recorded');
  assert.ok(journal.every(entry => entry.message && entry.message_en)); checks++;
  await stop(api.child);
  api = await launch('server/src/index.mjs', { ...environment, PORT: String(api.port) }, /API ready on port (\d+)/);
  check((await request('GET', '/pets')).data.pets[0].nickname, 'Luna', 'Server restart preserves nickname and credential');
  check((await request('GET', '/trips')).data.trips[0].result.result_hash, revealed.data.trip.result.result_hash, 'Restart preserves settled reward');
  check((await request('GET', '/supplies')).data.balance, 2, 'Restart does not duplicate free supplies');
  console.log(`PixelPets portable release: ${checks} checks, 0 failures`);
} finally {
  for (const child of [...children]) await stop(child);
}
