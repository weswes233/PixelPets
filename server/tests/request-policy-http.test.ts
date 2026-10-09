import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Repository, start } from '../src/public.ts';
import { ChainService } from '../src/chain-service.ts';

async function fixture(trustedProxies: string[] = []) {
  const repository = new Repository(':memory:');
  const chain = new ChainService(repository);
  let chainChecks = 0;
  chain.publicConfig = async () => { chainChecks++; throw new Error('RPC unavailable'); };
  const server = await start({ repository, chainService: chain, port: 0, trustedProxies,
    rateLimit: { requests: 100, guestCreations: 1, windowMs: 60000 } });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  return { chainChecks: () => chainChecks,
    async guest(headers: Record<string, string> = {}) { return fetch(`${base}/guests`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' }); },
    async live(headers: Record<string, string> = {}) { return fetch(`${base}/live`, { headers }); },
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repository.close(); } };
}

test('HTTP proxy policy gives separate visitors independent guest limits and canonicalizes aliases', async () => {
  const f = await fixture(['127.0.0.1']);
  try {
    for (let index = 1; index <= 13; index++) assert.equal((await f.guest({ 'X-PixelPets-Client-IP': `192.0.2.${index}` })).status, 201);
    assert.equal((await f.guest({ 'X-PixelPets-Client-IP': '::ffff:192.0.2.1' })).status, 429);
    for (const header of [undefined, 'unknown', '192.0.2.80, 192.0.2.81']) {
      const result = await f.guest(header ? { 'X-PixelPets-Client-IP': header } : {});
      assert.equal(result.status, 400);
      assert.equal((await result.json() as any).error.code, 'INVALID_CLIENT_IP');
    }
  } finally { await f.close(); }
});

test('HTTP direct peers cannot forge identity to bypass limits, and live check is independent of RPC', async () => {
  const f = await fixture();
  try {
    const live = await f.live();
    assert.equal(live.status, 200); assert.equal((await live.json() as any).data.live, true);
    assert.equal(f.chainChecks(), 0);
    assert.equal((await f.guest({ 'X-PixelPets-Client-IP': '192.0.2.1' })).status, 400);
    assert.equal((await f.guest({ 'X-Forwarded-For': '192.0.2.1' })).status, 201);
    assert.equal((await f.guest({ 'X-Forwarded-For': '192.0.2.2', Forwarded: 'for=192.0.2.2' })).status, 429);
  } finally { await f.close(); }
});
