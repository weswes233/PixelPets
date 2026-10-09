import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { BridgeError, WalletController } from '../src/controller.ts';
import type { ApiCall, WalletState } from '../src/controller.ts';

const PET_ID = '12345678-1234-1234-1234-123456789012';
const CARE = { action: 'feed', event_id: 'a'.repeat(32) };
type Call = { path: string; method: string; token?: string; body?: any };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function signer() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = new Uint8Array(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const account: WalletAccount = { address: new PublicKey(publicKey).toBase58(), publicKey,
    chains: ['solana:devnet'], features: ['solana:signMessage'] };
  let listener: ((event: { accounts: WalletAccount[] }) => void) | undefined;
  let signatures = 0;
  const wallet = { version: '1.0.0', name: 'Isolated identity test signer', icon: 'data:image/png;base64,',
    accounts: [account], chains: ['solana:devnet'], features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'standard:events': { version: '1.0.0', on: (_event: string, callback: typeof listener) => {
        listener = callback; return () => { listener = undefined; };
      } },
      'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }: { message: Uint8Array }) => {
        signatures += 1;
        return [{ signedMessage: message, signature: new Uint8Array(sign(null, message, keys.privateKey)) }];
      } },
    } } as unknown as Wallet;
  return { wallet, account, keys, signatures: () => signatures, change: () => listener?.({ accounts: [] }) };
}

function fixture() {
  const a = signer(); const b = signer();
  const identities = new Map([[a.account.address, a], [b.account.address, b]]);
  const challenges = new Map<string, { address: string; message: string }>();
  const calls: Call[] = []; const notifications: WalletState[] = [];
  const sessionToken = (address: string) => `wallet-session:${address}`;
  let intercept: ((call: Call) => unknown | Promise<unknown>) | undefined;
  const api: ApiCall = async (path, method, token, body) => {
    const call = { path, method, token, body }; calls.push(call);
    if (intercept) { const result = await intercept(call); if (result !== undefined) return result; }
    if (path === '/chain/config') return { network: 'devnet', enabled: false, market_enabled: false };
    if (path.endsWith('/challenge')) {
      const address = (body as any).address;
      const challenge_id = randomUUID(); const message = `PixelPets isolated test\n${address}\n${challenge_id}`;
      challenges.set(challenge_id, { address, message }); return { challenge_id, message };
    }
    if (path.endsWith('/verify')) {
      const value = body as any; const challenge = challenges.get(value.challenge_id)!;
      const identity = identities.get(challenge.address)!;
      assert.ok(verify(null, Buffer.from(challenge.message), identity.keys.publicKey, Buffer.from(value.signature, 'base64')));
      return { wallet_address: identity.account.address, token: sessionToken(identity.account.address),
        game_token: 'r'.repeat(43), user_id: '11111111-1111-1111-1111-111111111111', network: 'devnet',
        game_expires_at: new Date(Date.now() + 86400000).toISOString() };
    }
    if (path === '/wallet/session') return {};
    if (path === '/wallet/assets/sync') return { pets: [], ownership: { scanned: 0, synchronized: 0, unavailable: 0 } };
    if (path === `/pets/${PET_ID}/care`) return { pet: { id: PET_ID, bond: 7 }, event: { applied: true } };
    if (path === `/pets/${PET_ID}`) return { pet: { id: PET_ID, nickname: (body as any).nickname } };
    throw new Error(`Unexpected isolated API route ${method} ${path}`);
  };
  const controller = new WalletController(api, state => notifications.push(state));
  controller.setSession('g'.repeat(43));
  return { controller, a, b, calls, notifications, sessionToken,
    intercept: (handler?: typeof intercept) => { intercept = handler; } };
}

const operations = [
  { name: 'care', path: `/pets/${PET_ID}/care`, run: (controller: WalletController) => controller.care(PET_ID, CARE) },
  { name: 'rename', path: `/pets/${PET_ID}`, run: (controller: WalletController) => controller.rename(PET_ID, '  新名字  ') },
  { name: 'sync', path: '/wallet/assets/sync', run: (controller: WalletController) => controller.syncAssets() },
];

test('a delayed old-session 401 cannot revoke a newly bound or recovered wallet', async () => {
  for (const mode of ['bind', 'recover'] as const) {
    const f = fixture(); await f.controller.connect(f.a.wallet);
    const old = deferred<unknown>(); const started = deferred<void>();
    f.intercept(call => {
      if (call.path === '/wallet/session' && call.token === f.sessionToken(f.a.account.address)) {
        started.resolve(); return old.promise;
      }
      return undefined;
    });
    const pending = f.controller.refresh(); await started.promise;
    f.controller.setSession('n'.repeat(43));
    if (mode === 'bind') await f.controller.connect(f.b.wallet); else await f.controller.recover(f.b.wallet);
    old.reject(new BridgeError('UNAUTHORIZED', 'The old session expired'));
    const state = await pending;
    assert.equal(state.authenticated, true, mode); assert.equal(state.address, f.b.account.address, mode);
    await f.controller.syncAssets();
    assert.equal(f.calls.at(-1)!.token, f.sessionToken(f.b.account.address), mode);
  }
});

test('a delayed old configuration response cannot overwrite the new profile network or feature state', async () => {
  const f = fixture(); await f.controller.connect(f.a.wallet);
  const old = deferred<unknown>(); const started = deferred<void>(); let delay = true;
  f.intercept(call => {
    if (call.path === '/chain/config' && delay) { delay = false; started.resolve(); return old.promise; }
    return undefined;
  });
  const pending = f.controller.refresh(); await started.promise;
  f.controller.setSession('n'.repeat(43)); await f.controller.recover(f.b.wallet);
  old.resolve({ network: 'mainnet-beta', enabled: true, market_enabled: true });
  const result = await pending;
  assert.equal(result.network, 'solana:devnet'); assert.equal(result.chain_enabled, false);
  assert.equal(result.market_enabled, false); assert.equal(result.address, f.b.account.address);
});

test('care, rename and asset sync use only the in-memory wallet credential without asking for another signature', async () => {
  const f = fixture(); const recovered = await f.controller.recover(f.a.wallet);
  f.controller.setSession(recovered.game_token);
  const before = f.calls.length; const signatures = f.a.signatures();
  for (const operation of operations) await operation.run(f.controller);
  const calls = f.calls.slice(before);
  assert.deepEqual(calls.map(call => call.path), operations.map(operation => operation.path));
  assert.ok(calls.every(call => call.token === f.sessionToken(f.a.account.address)));
  assert.ok(calls.every(call => call.token !== recovered.game_token));
  assert.equal(f.a.signatures(), signatures);
  assert.deepEqual(calls[0].body, CARE); assert.deepEqual(calls[1].body, { nickname: '新名字' });
  assert.deepEqual(calls[2].body, {});
  assert.ok(!JSON.stringify(recovered).includes(f.sessionToken(f.a.account.address)));
  assert.ok(f.notifications.every(state => !JSON.stringify(state).includes(f.sessionToken(f.a.account.address))));
});

test('a game credential alone cannot call the registered-pet wallet operations', async () => {
  const f = fixture();
  for (const operation of operations) await assert.rejects(operation.run(f.controller), { code: 'WALLET_AUTH_REQUIRED' });
  assert.equal(f.calls.length, 0);
  await f.controller.connect(f.a.wallet); await f.controller.disconnect();
  const after = f.calls.length;
  for (const operation of operations) await assert.rejects(operation.run(f.controller), { code: 'WALLET_AUTH_REQUIRED' });
  assert.equal(f.calls.length, after);
});

test('a transient wallet operation failure releases the busy state and preserves the retry event identity', async () => {
  const f = fixture(); await f.controller.connect(f.a.wallet); let fail = true;
  f.intercept(call => {
    if (call.path === operations[0].path && fail) { fail = false; throw new BridgeError('SERVICE_UNAVAILABLE', 'Try again'); }
    return undefined;
  });
  await assert.rejects(f.controller.care(PET_ID, CARE), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.controller.state().authenticated, true);
  assert.deepEqual(await f.controller.care(PET_ID, CARE), { pet: { id: PET_ID, bond: 7 }, event: { applied: true } });
  const attempts = f.calls.filter(call => call.path === operations[0].path);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.ok(attempts.every(call => call.token === f.sessionToken(f.a.account.address)));
  await f.controller.syncAssets();
});

test('an expired wallet operation revokes local authentication and allows an explicit reconnect', async () => {
  const f = fixture(); await f.controller.connect(f.a.wallet); let fail = true;
  f.intercept(call => {
    if (call.path === operations[2].path && fail) { fail = false; throw new BridgeError('SESSION_EXPIRED', 'Expired'); }
    return undefined;
  });
  await assert.rejects(f.controller.syncAssets(), { code: 'SESSION_EXPIRED' });
  assert.equal(f.controller.state().authenticated, false); assert.equal(f.notifications.at(-1)!.authenticated, false);
  const before = f.calls.length;
  await assert.rejects(f.controller.care(PET_ID, CARE), { code: 'WALLET_AUTH_REQUIRED' });
  assert.equal(f.calls.length, before);
  await f.controller.connect(f.a.wallet); await f.controller.syncAssets();
  assert.equal(f.controller.state().authenticated, true);
});

test('account changes discard delayed care, rename and sync results before they reach the game', async () => {
  for (const operation of operations) {
    const f = fixture(); await f.controller.connect(f.a.wallet);
    const old = deferred<unknown>(); const started = deferred<void>();
    f.intercept(call => {
      if (call.path === operation.path) { started.resolve(); return old.promise; }
      return undefined;
    });
    const pending = operation.run(f.controller); await started.promise;
    f.a.change(); old.resolve({ pet: { id: PET_ID, nickname: 'Old private profile' } });
    await assert.rejects(pending, { code: 'ACCOUNT_CHANGED' }, operation.name);
    assert.equal(f.controller.state().authenticated, false, operation.name);
    f.intercept(); f.controller.setSession('n'.repeat(43)); await f.controller.connect(f.b.wallet);
    await operation.run(f.controller);
    assert.equal(f.calls.at(-1)!.token, f.sessionToken(f.b.account.address), operation.name);
  }
});

test('one pending wallet mutation prevents a second mutation and the gate is released after completion', async () => {
  const f = fixture(); await f.controller.connect(f.a.wallet);
  const pendingResult = deferred<unknown>(); const started = deferred<void>();
  f.intercept(call => {
    if (call.path === operations[0].path) { started.resolve(); return pendingResult.promise; }
    return undefined;
  });
  const first = f.controller.care(PET_ID, CARE); await started.promise;
  const before = f.calls.length;
  await assert.rejects(f.controller.rename(PET_ID, '新名字'), { code: 'WALLET_BUSY' });
  assert.equal(f.calls.length, before);
  pendingResult.resolve({ pet: { id: PET_ID } }); await first;
  await f.controller.rename(PET_ID, '新名字');
});

test('profile changes during preflight stop registration and quote requests before any action call', async () => {
  for (const operation of [
    (controller: WalletController) => controller.register(PET_ID),
    (controller: WalletController) => controller.offers(),
  ]) {
    const f = fixture(); await f.controller.connect(f.a.wallet);
    const preflight = deferred<unknown>(); const started = deferred<void>(); const before = f.calls.length;
    f.intercept(call => {
      if (call.path === '/chain/config') { started.resolve(); return preflight.promise; }
      return undefined;
    });
    const pending = operation(f.controller); await started.promise;
    f.controller.setSession('n'.repeat(43));
    preflight.resolve({ network: 'devnet', enabled: true, market_enabled: true });
    await assert.rejects(pending, { code: 'ACCOUNT_CHANGED' });
    assert.deepEqual(f.calls.slice(before).map(call => call.path), ['/chain/config']);
  }
});
