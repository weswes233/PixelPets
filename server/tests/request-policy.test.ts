import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_IP_HEADER, createRequestPolicy, normalizeIp, parseTrustedProxies, RequestPolicyError } from '../src/request-policy.ts';
import type { RequestIdentityInput } from '../src/request-policy.ts';

function request(peer: string, forwarded?: string): RequestIdentityInput {
  return { socket: { remoteAddress: peer }, headers: forwarded === undefined ? {} : { [CLIENT_IP_HEADER]: forwarded },
    rawHeaders: forwarded === undefined ? [] : ['X-PixelPets-Client-IP', forwarded] };
}

test('default policy uses only socket peer and ignores forged forwarding conventions', () => {
  const input = request('::ffff:198.51.100.8');
  input.headers['x-forwarded-for'] = '192.0.2.10, 10.0.0.1'; input.headers.forwarded = 'for=192.0.2.11';
  assert.equal(createRequestPolicy()(input), '198.51.100.8');
  assert.throws(() => createRequestPolicy()(request('198.51.100.8', '192.0.2.20')), RequestPolicyError);
});

test('only exact configured peers can supply the one overwritten client IP header', () => {
  const policy = createRequestPolicy({ trustedProxies: ['172.29.11.2', '::1'] });
  assert.equal(policy(request('::ffff:172.29.11.2', '2001:DB8:0:0:0:0:0:1')), '2001:db8::1');
  assert.equal(policy(request('0:0:0:0:0:0:0:1', '192.0.2.7')), '192.0.2.7');
  assert.throws(() => policy(request('172.29.11.3', '192.0.2.7')), RequestPolicyError);
  assert.throws(() => policy(request('172.29.11.2')), RequestPolicyError);
});

test('ambiguous, invalid, duplicate and list identities fail closed', () => {
  const policy = createRequestPolicy({ trustedProxies: ['127.0.0.1'] });
  for (const value of ['', ' 192.0.2.1', '192.0.2.1 ', '192.0.2.1, 192.0.2.2', 'unknown', '127.1', '192.0.2.1:80', '[::1]', 'fe80::1%eth0', '192.0.2.256', '010.0.0.1']) {
    assert.throws(() => policy(request('127.0.0.1', value)), RequestPolicyError, value);
  }
  const duplicate = request('127.0.0.1', '192.0.2.1');
  duplicate.rawHeaders.push('x-pixelpets-client-ip', '192.0.2.1');
  assert.throws(() => policy(duplicate), RequestPolicyError);
  const array = request('127.0.0.1', '192.0.2.1'); array.headers[CLIENT_IP_HEADER] = ['192.0.2.1'];
  assert.throws(() => policy(array), RequestPolicyError);
  assert.throws(() => policy({ socket: {}, headers: {}, rawHeaders: [] }), RequestPolicyError);
});

test('thirteen users through one proxy produce thirteen rate-limit identities', () => {
  const policy = createRequestPolicy({ trustedProxies: ['172.29.11.2'] });
  const ids = Array.from({ length: 13 }, (_, index) => policy(request('172.29.11.2', `192.0.2.${index + 1}`)));
  assert.equal(new Set(ids).size, 13);
  assert.equal(policy(request('172.29.11.2', '::ffff:192.0.2.1')), ids[0]);
});

test('proxy configuration rejects broad trust and canonicalizes exact address aliases', () => {
  assert.deepEqual(parseTrustedProxies(), []); assert.deepEqual(parseTrustedProxies(''), []);
  assert.deepEqual(parseTrustedProxies('127.0.0.1, ::ffff:127.0.0.1,0:0:0:0:0:0:0:1'), ['127.0.0.1', '::1']);
  for (const value of ['*', 'localhost', '10.0.0.0/8', '::/0', '127.0.0.1,', '127.0.0.1:80', ' ']) assert.throws(() => parseTrustedProxies(value));
  assert.equal(normalizeIp('::ffff:c000:201'), '192.0.2.1');
});
