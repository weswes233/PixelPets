import { createServer, request as proxyRequest } from 'node:http';
import { isIP } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/web');
const port = Number(process.env.WEB_PORT || 9783);
const apiPort = Number(process.env.API_PORT || 9782);
const configuredRpc = process.env.CHAIN_PUBLIC_RPC_URL ? new URL(process.env.CHAIN_PUBLIC_RPC_URL) : null;
if (configuredRpc && (configuredRpc.username || configuredRpc.password || configuredRpc.search || configuredRpc.hash || !['https:', 'http:'].includes(configuredRpc.protocol))) throw new Error('Invalid public RPC URL');
const rpcSource = configuredRpc ? ` ${configuredRpc.origin}` : '';
// Optional public hostname (e.g. a temporary Cloudflare quick tunnel). Only this exact host is added to the loopback allowlist.
const publicHost = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).hostname : null;
// Behind a local tunnel every request arrives from loopback; forward the tunnel's client address so per-client limits still work.
const forwardClientIp = process.env.SERVE_FORWARD_CLIENT_IP === '1';
if (forwardClientIp && !(process.env.TRUSTED_PROXY_IPS || '').trim()) {
  console.error('SERVE_FORWARD_CLIENT_IP=1 requires TRUSTED_PROXY_IPS (e.g. 127.0.0.1) on the API process.');
  process.exit(1);
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Single-threaded Godot export: COOP same-origin would disrupt some wallet popup flows.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'${rpcSource}; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'`);
  const host = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(host) && host !== publicHost) { res.writeHead(403); res.end('Invalid host'); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url || '/', `http://127.0.0.1:${port}`).pathname); }
  catch { res.writeHead(400); res.end('Invalid URL'); return; }
  if (pathname.startsWith('/api/')) {
    const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
    delete headers['x-pixelpets-client-ip'];
    if (forwardClientIp) {
      const tunnelClient = String(req.headers['cf-connecting-ip'] ?? '');
      headers['x-pixelpets-client-ip'] = isIP(tunnelClient) ? tunnelClient : (req.socket.remoteAddress ?? '127.0.0.1');
    }
    const upstream = proxyRequest({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '养成服务尚未启动，请稍后重试。' } })); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream); return;
  }
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405); res.end(); return; }
  if (pathname.split(/[\\/]/).some(segment => segment.startsWith('.')) || pathname.includes('\0')) { res.writeHead(403); res.end(); return; }
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('游戏文件尚未生成，或该页面不存在。'); return; }
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && existsSync(file + '.gz');
  const served = gzip ? file + '.gz' : file;
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': statSync(served).size, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(served).on('error', () => res.destroy()).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`PixelPets web: http://127.0.0.1:${(server.address() as { port: number }).port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
