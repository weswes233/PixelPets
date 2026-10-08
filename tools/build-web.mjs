import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'web');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'wallet-web/src/bridge.ts')], outfile: path.join(output, 'bridge.js'), bundle: true, format: 'iife', platform: 'browser', target: ['es2022'], sourcemap: false, minify: true });
await copyFile(path.join(root, 'wallet-web/wallet.css'), path.join(output, 'wallet.css'));
const htmlFile = path.join(output, 'index.html');
try {
  let html = await readFile(htmlFile, 'utf8');
  if (!html.includes('src="/bridge.js"')) html = html.replace('</head>', '<script src="/bridge.js"></script>\n</head>');
  html = html.replace('<title>PixelPets</title>', '<title>像素伴伴 · PixelPets</title>');
  await writeFile(htmlFile, html, 'utf8');
  console.log('Wallet bridge built and attached to Godot export.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Wallet bridge built. Export Godot Web first, then run again to attach it.');
}
