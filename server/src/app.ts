import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { ApiError, catalog, objectBody } from './domain.ts';
import { Repository } from './repository.ts';
import { ChainService } from './chain-service.ts';
import { ChainClientError, lamportsToSol } from '../../chain-client/src/index.ts';
import { MarketReader } from './market-reader.ts';
import type { MarketRpc, MarketOfferCard } from './market-reader.ts';

export type AppOptions = {
  repository: Repository;
  chainService?: ChainService;
  marketReader?: MarketReader;
  rateLimit?: { requests: number; guestCreations: number; windowMs: number };
};
type Bucket = { count: number; reset: number };
function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 提交。');
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'ENCODING_UNSUPPORTED', '不支持压缩请求。');
  if (Number(request.headers['content-length'] ?? 0) > 32768) { request.resume(); throw new ApiError(413, 'BODY_TOO_LARGE', '提交的内容太长了。'); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of request) { const chunk = Buffer.from(part); size += chunk.length; if (size > 32768) throw new ApiError(413, 'BODY_TOO_LARGE', '提交的内容太长了。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', '内容不是有效的 JSON。'); }
}

export function createApp(options: AppOptions): Server {
  const repository = options.repository;
  const chain = options.chainService ?? new ChainService(repository);
  const deployment = chain.configuration;
  const marketRpc = deployment?.rpc as MarketRpc | undefined;
  const market = options.marketReader ?? new MarketReader(deployment && typeof marketRpc?.getProgramAccounts === 'function'
    && typeof marketRpc.getMultipleAccountsInfoAndContext === 'function' ? { rpc: marketRpc, network: deployment.network,
      programId: deployment.programId, collectionAddress: deployment.collectionAddress, expectedGenesisHash: deployment.expectedGenesisHash } : undefined);
  const displayOffer = (offer: MarketOfferCard) => ({ ...offer, price_sol: lamportsToSol(offer.price_lamports),
    fee_sol: lamportsToSol(offer.fee_lamports), seller_sol: lamportsToSol(offer.seller_lamports) });
  const limits = options.rateLimit ?? { requests: 180, guestCreations: 12, windowMs: 60000 };
  const buckets = new Map<string, Bucket>();
  function limit(key: string, max: number): void {
    const now = repository.clock();
    if (buckets.size > 10000) { for (const [id, bucket] of buckets) if (bucket.reset <= now) buckets.delete(id); }
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) { bucket = { count: 0, reset: now + limits.windowMs }; buckets.set(key, bucket); }
    if (++bucket.count > max) throw new ApiError(429, 'RATE_LIMITED', '操作有点频繁，请稍后再试。', { retry_after_ms: Math.max(0, bucket.reset - now) });
  }
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const pathname = url.pathname;
      const method = request.method ?? 'GET';
      const ip = request.socket.remoteAddress ?? 'unknown';
      limit(`ip:${ip}`, limits.requests);
      if (request.headers.origin && request.headers.origin !== repository.publicOrigin) throw new ApiError(403, 'ORIGIN_REJECTED', '请从正式游戏页面访问。');
      if (method === 'GET' && pathname === '/api/v1/health') {
        repository.db.prepare('SELECT 1').get();
        const config = await chain.publicConfig();
        return reply(response, 200, { ok: true, data: { service: 'pixel-pets', storage: 'sqlite', chain: { network: config.network, configured: config.enabled, program_id: config.program_id }, ai: { configured: false } } });
      }
      if (method === 'GET' && pathname === '/api/v1/catalog') return reply(response, 200, { ok: true, data: catalog });
      if (method === 'GET' && pathname === '/api/v1/chain/config') {
        const config = await chain.publicConfig();
        return reply(response, 200, { ok: true, data: { ...config,
          market_enabled: Boolean(market.configuration) && (config.enabled || config.reason === 'PROTOCOL_PAUSED') } });
      }
      if (method === 'POST' && pathname === '/api/v1/guests') {
        limit(`guest:${ip}`, limits.guestCreations); objectBody(await body(request), []);
        return reply(response, 201, { ok: true, data: repository.guest() });
      }
      const bearer = request.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]+)$/)?.[1];
      const auth = repository.authenticate(bearer, pathname === '/api/v1/wallet/session' || pathname.startsWith('/api/v1/chain/') || /\/(claim|checkpoint)-intent$/.test(pathname));
      let result: unknown; let status = 200;
      if (method === 'GET' && pathname === '/api/v1/pets') result = repository.listPets(auth.user_id);
      else if (method === 'POST' && pathname === '/api/v1/pets') { result = repository.adopt(auth.user_id, await body(request)); status = 201; }
      else if (method === 'GET' && pathname === '/api/v1/journal') result = repository.journal(auth.user_id);
      else if (method === 'GET' && pathname === '/api/v1/offers') {
        if ([...url.searchParams.keys()].some(key => !['limit', 'cursor'].includes(key))
          || ['limit', 'cursor'].some(key => url.searchParams.getAll(key).length > 1)) throw new ApiError(400, 'INVALID_QUERY', '报价查询参数无效。');
        const page = await market.list({ limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
          cursor: url.searchParams.get('cursor') ?? undefined });
        result = { ...page, offers: page.offers.map(displayOffer) };
      }
      else if (method === 'POST' && pathname === '/api/v1/wallet/challenge') { limit(`wallet:${ip}`, 20); result = repository.challenge(auth.user_id, await body(request)); }
      else if (method === 'POST' && pathname === '/api/v1/wallet/verify') { limit(`wallet:${ip}`, 20); result = repository.verifyWallet(auth.user_id, await body(request)); }
      else if (method === 'GET' && pathname === '/api/v1/wallet/session') result = repository.walletSession(auth.user_id);
      else if (method === 'DELETE' && pathname === '/api/v1/wallet/session') { repository.revokeSession(bearer!); result = { disconnected: true }; }
      else {
        const careMatch = pathname.match(/^\/api\/v1\/pets\/([a-f0-9-]{36})\/care$/);
        const petMatch = pathname.match(/^\/api\/v1\/pets\/([a-f0-9-]{36})$/);
        const prepareMatch = pathname.match(/^\/api\/v1\/pets\/([a-f0-9-]{36})\/(claim|checkpoint)-intent$/);
        const intentMatch = pathname.match(/^\/api\/v1\/chain\/intents\/([a-f0-9-]{36})(\/confirm)?$/);
        const offerMatch = pathname.match(/^\/api\/v1\/offers\/([1-9A-HJ-NP-Za-km-z]{32,44})\/(0|[1-9]\d{0,19})$/);
        if (method === 'GET' && offerMatch) {
          const page = await market.detail(offerMatch[1], offerMatch[2]); result = { ...page, offer: displayOffer(page.offer) };
        }
        else if (method === 'POST' && prepareMatch) result = await chain.prepare(auth, prepareMatch[1], prepareMatch[2] as 'claim' | 'checkpoint', await body(request));
        else if (method === 'POST' && intentMatch?.[2]) result = await chain.confirm(auth, intentMatch[1], await body(request));
        else if (method === 'GET' && intentMatch && !intentMatch[2]) result = await chain.get(auth, intentMatch[1]);
        else if (method === 'POST' && careMatch) result = repository.care(auth.user_id, careMatch[1], await body(request));
        else if (method === 'PATCH' && petMatch) result = repository.rename(auth.user_id, petMatch[1], await body(request));
        else throw new ApiError(404, 'NOT_FOUND', '这个接口还不可用。');
      }
      reply(response, status, { ok: true, data: result });
    } catch (error) {
      if (error instanceof ApiError) reply(response, error.status, { ok: false, error: { code: error.code, message: error.message, ...error.details } });
      else if (error instanceof ChainClientError) reply(response, /INVALID|REPLACED|MISSING_COSIGNATURE/.test(error.code) ? 400 : 409,
        { ok: false, error: { code: error.code, message: error.message } });
      else { console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError'); reply(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时出了点问题，请稍后重试。' } }); }
    }
  });
}

export async function start(options: AppOptions & { port?: number; host?: string }): Promise<Server> {
  const server = createApp(options);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 9782, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return server;
}
