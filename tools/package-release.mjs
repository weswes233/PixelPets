// Build an offline, self-contained Windows package from already verified Godot exports.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = path.resolve(process.argv[2] ?? path.join(root, 'dist/release/PixelPets'));
try {
  if ((await readdir(release)).length) throw new Error('Choose a new, empty output directory. Existing games and saves are never overwritten.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const copy = async (from, to = from) => {
  await mkdir(path.dirname(path.join(release, to)), { recursive: true });
  await cp(path.join(root, from), path.join(release, to), { recursive: true });
};
for (const file of ['dist/web/index.html', 'dist/web/index.pck', 'dist/web/index.wasm']) await access(path.join(root, file));
await mkdir(release, { recursive: true });
await copy('dist/web');
try { await access(path.join(root, 'dist/windows/PixelPets.exe')); await copy('dist/windows'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const file of ['tools/start.ps1', 'tools/stop.ps1', '开始游玩.cmd', '停止游戏.cmd']) await copy(file);
for (const entry of ['server/src/index.ts', 'tools/serve.ts']) {
  const outfile = path.join(release, entry.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true,
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof' });
}
await mkdir(path.join(release, 'runtime/node'), { recursive: true });
await cp(process.execPath, path.join(release, 'runtime/node/node.exe'));
await writeFile(path.join(release, 'package.json'), '{"name":"pixelpets-play","version":"1.0.0","private":true,"type":"module"}\n');
await copy('docs/PLAY.md', '先读我.md');
await mkdir(path.join(release, 'licenses'), { recursive: true });
// Retain licenses for the runtime and every installed package included in the bundle.
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const name of Object.keys(lock.packages).filter(name => name.startsWith('node_modules/'))) {
  const directory = path.join(root, name);
  let files;
  try { files = await readdir(directory); } catch { continue; }
  for (const file of files.filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file))) {
    await cp(path.join(directory, file), path.join(release, 'licenses', name.slice(13).replaceAll('/', '_') + '-' + file));
  }
}
await copy('game/assets/fonts/OFL.txt', 'licenses/NotoSansSC-OFL.txt');
await copy('runtime/node-LICENSE.txt', 'licenses/Node-LICENSE.txt');
await copy('runtime/Godot-LICENSE.txt', 'licenses/Godot-LICENSE.txt');
console.log('Portable game prepared: ' + release);
