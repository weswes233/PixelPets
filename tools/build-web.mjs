import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'web');
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
  html = html.replace(/<img id="status-splash"[^>]*>/, '<div id="pet-loading"><div class="pet-loading-mark">✦</div><h1>PixelPets</h1><p>一点照顾，一段小小的旅程。<br>A little care. A world of memories.</p></div>');
  if (!html.includes('id="pet-loading-style"')) html = html.replace('</head>', `<style id="pet-loading-style">
body,#status{background:#f8f4e8;color:#344a48;font-family:system-ui,sans-serif}
#pet-loading{text-align:center;max-width:85%;line-height:1.8}
#pet-loading h1{font-size:36px;letter-spacing:2px;margin:12px 0}
#pet-loading p{color:#626f65;font-size:14px}
.pet-loading-mark{font-size:64px;color:#84a88a}
#status-progress{accent-color:#84a88a;width:min(300px,70%);height:10px;bottom:20%}
#canvas{touch-action:pinch-zoom}
</style>\n</head>`);
  html = html.replace('<canvas id="canvas">', '<canvas id="canvas" aria-label="PixelPets game · 掌心伙伴游戏">');
  await writeFile(htmlFile, html, 'utf8');
  for (const file of ['index.wasm', 'index.pck', 'index.js', 'bridge.js']) {
    const bytes = await readFile(path.join(output, file));
    await writeFile(path.join(output, file + '.gz'), gzipSync(bytes, { level: 9 }));
  }
  console.log('Wallet bridge built and attached to Godot export.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Wallet bridge built. Export Godot Web first, then run again to attach it.');
}
