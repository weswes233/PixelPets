import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'web');
if (process.argv.includes('--require-export')) {
  for (const name of ['index.html', 'index.js', 'index.wasm', 'index.pck']) {
    const asset = await stat(path.join(output, name)).catch(() => null);
    if (!asset?.isFile() || asset.size === 0) {
      throw new Error(`Godot Web export is incomplete: missing ${name}. Run the Godot Web export before building the wallet bridge.`);
    }
  }
}
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'wallet-web/src/bridge.ts')], outfile: path.join(output, 'bridge.js'), bundle: true, format: 'iife', platform: 'browser', target: ['es2022'], sourcemap: false, minify: true });
await copyFile(path.join(root, 'wallet-web/wallet.css'), path.join(output, 'wallet.css'));
const htmlFile = path.join(output, 'index.html');
try {
  let html = await readFile(htmlFile, 'utf8');
  if (!html.includes('src="/bridge.js"')) html = html.replace('</head>', '<script src="/bridge.js"></script>\n</head>');
  html = html.replace(/<html\b([^>]*)>/i, (_tag, attributes) =>
    `<html${attributes.replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')} lang="zh-CN">`);
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes, viewport-fit=cover">';
  const viewportTag = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
  html = viewportTag.test(html) ? html.replace(viewportTag, viewport) : html.replace('</head>', `${viewport}\n</head>`);
  // Godot's shell disables browser gestures by default. Keep canvas input, but permit pinch zoom.
  html = html.replace(/touch-action:\s*none\s*;/g, 'touch-action: pinch-zoom;');
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>PixelPets · 掌心伙伴</title>');
  await writeFile(htmlFile, html, 'utf8');
  console.log('Wallet bridge built and attached to Godot export.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Wallet bridge built. Export Godot Web first, then run again to attach it.');
}
