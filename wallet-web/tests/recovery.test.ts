import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { Repository, start } from '../../server/src/public.ts';
import { BridgeError, WalletController } from '../src/controller.ts';
import type { ApiCall } from '../src/controller.ts';

function signingWallet(beforeSign: () => void = () => {}) {
  const keys = generateKeyPairSync('ed25519');
  const bytes = new Uint8Array(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const account: WalletAccount = { address: new PublicKey(bytes).toBase58(), publicKey: bytes,
    chains: ['solana:devnet'], features: ['solana:signMessage'] };
  let changed: ((event: { accounts: WalletAccount[] }) => void) | undefined;
  const wallet = { version: '1.0.0', name: 'Recovery HTTP test signer', icon: 'data:image/png;base64,',
    chains: ['solana:devnet'], accounts: [account], features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: (_event: string, callback: typeof changed) => { changed = callback; return () => { changed = undefined; }; } },
      'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }: { message: Uint8Array }) => {
        beforeSign(); return [{ signedMessage: message, signature: new Uint8Array(sign(null, message, keys.privateKey)) }];
      } },
    } } as unknown as Wallet;
  return { wallet, account, change: () => changed?.({ accounts: [] }) };
}

async function fixture() {
  const repository = new Repository(':memory:');
  const server = await start({ repository, port: 0 });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const calls: { path: string; token?: string }[] = [];
  const api: ApiCall = async (path, method, token, body) => {
    calls.push({ path, token });
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json() as any;
    if (!response.ok || !payload.ok) throw new BridgeError(payload.error.code, payload.error.message);
    return payload.data;
  };
  const original = await api('/guests', 'POST', undefined, {});
  const pet = (await api('/pets', 'POST', original.token, { species_id: 'moss', nickname: '原来的苔苔', event_id: 'restore_original' })).pet;
  const signer = signingWallet();
  const controller = new WalletController(api); controller.setSession(original.token); await controller.connect(signer.wallet);
  return { repository, api, calls, original, pet, signer, close: async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); repository.close();
  } };
}

test('browser controller recovers original profile through real HTTP without merging a new guest', async () => {
  const f = await fixture();
  try {
    const visitor = await f.api('/guests', 'POST', undefined, {});
    const other = (await f.api('/pets', 'POST', visitor.token, { species_id: 'wisp', nickname: '新设备伙伴', event_id: 'restore_other_pet' })).pet;
    const controller = new WalletController(f.api); controller.setSession(visitor.token);
    const recovered = await controller.recover(f.signer.wallet);
    assert.equal(recovered.user_id, f.original.user_id); assert.equal(recovered.recovered, true);
    assert.equal(recovered.authenticated, true); assert.equal(recovered.address, f.signer.account.address);
    assert.deepEqual((await f.api('/pets', 'GET', recovered.game_token)).pets.map((p: any) => p.id), [f.pet.id]);
    assert.deepEqual((await f.api('/pets', 'GET', visitor.token)).pets.map((p: any) => p.id), [other.id]);
    assert.equal((await f.api('/journal', 'GET', recovered.game_token)).entries.length, 1);
    assert.equal(f.calls.find(c => c.path === '/wallet/recovery/challenge')?.token, undefined);
    assert.equal(f.calls.find(c => c.path === '/wallet/recovery/verify')?.token, undefined);
    controller.setSession(recovered.game_token); assert.equal(controller.state().authenticated, true);
    await controller.disconnect();
    assert.equal((await f.api('/pets', 'GET', recovered.game_token)).pets[0].id, f.pet.id);
    assert.equal(controller.state().authenticated, false);
  } finally { await f.close(); }
});

test('wallet restoration does not require or invent a prior local guest session', async () => {
  const f = await fixture();
  try {
    const controller = new WalletController(f.api);
    const count = f.repository.db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n;
    const result = await controller.recover(f.signer.wallet);
    assert.equal(result.user_id, f.original.user_id);
    assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, count);
  } finally { await f.close(); }
});

test('account change during recovery signing never installs the returned profile', async () => {
  const f = await fixture();
  try {
    const controller = new WalletController(f.api);
    const changing = signingWallet(() => changing.change());
    await assert.rejects(controller.recover(changing.wallet), { code: 'ACCOUNT_CHANGED' });
    assert.equal(controller.state().authenticated, false);
    assert.equal(f.calls.filter(c => c.path === '/wallet/recovery/verify').length, 0);
  } finally { await f.close(); }
});

test('incomplete or wrong-network recovery responses preserve the existing game session', async () => {
  for (const change of [(data: any) => { delete data.game_token; }, (data: any) => { data.network = 'mainnet-beta'; }]) {
    const f = await fixture();
    try {
      const visitor = await f.api('/guests', 'POST', undefined, {});
      const api: ApiCall = async (...args) => { const data = await f.api(...args); if (args[0] === '/wallet/recovery/verify') change(data); return data; };
      const controller = new WalletController(api); controller.setSession(visitor.token);
      await assert.rejects(controller.recover(f.signer.wallet), { code: 'RECOVERY_INVALID' });
      assert.equal(controller.state().authenticated, false);
      const fresh = signingWallet(); await controller.connect(fresh.wallet);
      assert.equal(f.repository.walletSession(visitor.user_id).wallet_address, fresh.account.address);
    } finally { await f.close(); }
  }
});
