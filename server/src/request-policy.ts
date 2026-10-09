import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/** The edge must replace this header, never append to a client-provided value. */
export const CLIENT_IP_HEADER = 'x-pixelpets-client-ip';
export type RequestIdentityInput = {
  socket: { remoteAddress?: string };
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
};
export class RequestPolicyError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_CLIENT_IP';
  constructor() { super('请求来源无效，请从正式游戏页面访问。'); this.name = 'RequestPolicyError'; }
}

/** Exact IP literals only: no ports, subnets, DNS, zone IDs or list syntax. */
export function normalizeIp(value: string): string {
  if (!value || value.length > 45 || value !== value.trim() || value.includes('%')) throw new RequestPolicyError();
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) throw new RequestPolicyError();
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16); const low = Number.parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

export function parseTrustedProxies(value?: string): string[] {
  if (value === undefined || value === '') return [];
  const entries = value.split(',').map(entry => entry.trim());
  if (entries.length > 32 || entries.some(entry => !entry)) throw new Error('TRUSTED_PROXY_IPS requires at most 32 explicit IP addresses');
  try { return [...new Set(entries.map(normalizeIp))]; }
  catch { throw new Error('TRUSTED_PROXY_IPS must contain exact IPv4/IPv6 addresses, not CIDRs, ports or names'); }
}

/** Default: use the socket peer. X-Forwarded-For and Forwarded are never consulted. */
export function createRequestPolicy(options: { trustedProxies?: readonly string[] } = {}): (request: RequestIdentityInput) => string {
  const trusted = new Set((options.trustedProxies ?? []).map(normalizeIp));
  return request => {
    const peer = normalizeIp(request.socket.remoteAddress ?? '');
    const header = request.headers[CLIENT_IP_HEADER];
    let occurrences = 0;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === CLIENT_IP_HEADER) occurrences++;
    }
    if (!trusted.has(peer)) {
      if (header !== undefined || occurrences > 0) throw new RequestPolicyError();
      return peer;
    }
    // Missing identity on a trusted hop is a broken deployment, not a shared IP bucket.
    if (typeof header !== 'string' || occurrences !== 1) throw new RequestPolicyError();
    return normalizeIp(header);
  };
}
