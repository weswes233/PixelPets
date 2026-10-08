import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { WalletController, BridgeError, isSolanaWallet } from '../src/controller.ts';

function fixture(options: { reject?: boolean; invalidMessage?: boolean; serverReject?: boolean; noSign?: boolean } = {}) {
  const keys = generateKeyPairSync('ed25519');
  const account: WalletAccount = { address: 'test-wallet-address', publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: ['solana:signMessage'] };
  let listener: ((change: { accounts: WalletAccount[] }) => void) | undefined;
  const calls: string[] = [];
  const message = 'PixelPets login\nNonce: non-reusable-test-nonce';
  const wallet = {
    version: '1.0.0', name: 'Local test wallet', icon: 'data:image/png;base64,', chains: ['solana:devnet'], accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { if (options.reject) throw new Error('User rejected'); return { accounts: [account] }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'standard:events': { version: '1.0.0', on: (_event: string, callback: typeof listener) => { listener = callback; return () => { listener = undefined; }; } },
      ...(options.noSign ? {} : { 'solana:signMessage': { version: '1.0.0', signMessage: async ({ message: bytes }: { message: Uint8Array }) => [{ signedMessage: options.invalidMessage ? new Uint8Array([1]) : bytes, signature: new Uint8Array(sign(null, bytes, keys.privateKey)) }] } }),
    },
  } as unknown as Wallet;
  const api = async (path: string, method: string, token?: string, body?: any) => {
    calls.push(`${method} ${path}`);
    if (path === '/chain/config') return { network: 'devnet', enabled: false };
    if (path === '/wallet/challenge') { assert.equal(token, 'guest-token-for-test'); return { challenge_id: 'challenge-1', message }; }
    if (path === '/wallet/verify') {
      if (options.serverReject) throw new BridgeError('SIGNATURE_INVALID', 'Server rejected signature');
      assert.equal(body.challenge_id, 'challenge-1');
      assert.ok(verify(null, Buffer.from(message), keys.publicKey, Buffer.from(body.signature, 'base64')));
      return { wallet_address: account.address, token: 'wallet-session-for-test' };
    }
    if (path === '/wallet/session') { assert.equal(token, 'wallet-session-for-test'); return { wallet_address: account.address }; }
    throw new Error(`Unexpected API ${path}`);
  };
  const controller = new WalletController(api);
  controller.setSession('guest-token-for-test');
  return { controller, wallet, calls, account, changeAccounts: (accounts: WalletAccount[]) => listener?.({ accounts }) };
}

test('real Ed25519 message signing and verification precedes authenticated state', async () => {
  const { controller, wallet, calls } = fixture();
  assert.equal(controller.state().authenticated, false);
  const state = await controller.connect(wallet);
  assert.equal(state.authenticated, true);
  assert.equal(state.connected, true);
  assert.equal(state.network, 'solana:devnet');
  assert.equal(state.chain_enabled, false);
  assert.deepEqual(calls, ['GET /chain/config', 'POST /wallet/challenge', 'POST /wallet/verify']);
});

test('wallet rejection and server rejection never produce an authenticated connection', async () => {
  for (const options of [{ reject: true }, { serverReject: true }]) {
    const { controller, wallet } = fixture(options);
    await assert.rejects(controller.connect(wallet));
    assert.equal(controller.state().connected, false);
    assert.equal(controller.state().authenticated, false);
  }
});

test('modified signed message is rejected before reaching server verify', async () => {
  const { controller, wallet, calls } = fixture({ invalidMessage: true });
  await assert.rejects(controller.connect(wallet), { code: 'SIGNATURE_INVALID' });
  assert.equal(calls.includes('POST /wallet/verify'), false);
});

test('wallet address exposure without a signing feature is insufficient for authentication', async () => {
  const { controller, wallet } = fixture({ noSign: true });
  await assert.rejects(controller.connect(wallet), { code: 'SIGN_MESSAGE_UNSUPPORTED' });
  assert.equal(controller.state().authenticated, false);
});

test('account change clears authentication and notifies subscribers', async () => {
  const { controller, wallet, changeAccounts } = fixture();
  await controller.connect(wallet);
  changeAccounts([]);
  assert.equal(controller.state().authenticated, false);
  assert.equal(controller.state().address, '');
});

test('changing the game session clears the prior wallet connection', async () => {
  const { controller, wallet } = fixture();
  await controller.connect(wallet);
  controller.setSession('different-guest-session');
  assert.equal(controller.state().authenticated, false);
});

test('disabled chain never claims registration or marketplace success', async () => {
  const { controller, wallet, calls } = fixture();
  await controller.connect(wallet);
  await assert.rejects(controller.register('pet-one'), { code: 'CHAIN_NOT_DEPLOYED' });
  await assert.rejects(controller.offers(), { code: 'CHAIN_NOT_DEPLOYED' });
  assert.equal(calls.some(item => /claim|offers|transactions/.test(item)), false);
});

test('disconnect clears local credentials and invalidates wallet session', async () => {
  const { controller, wallet, calls } = fixture();
  await controller.connect(wallet);
  await controller.disconnect();
  assert.equal(controller.state().authenticated, false);
  assert.ok(calls.includes('DELETE /wallet/session'));
});

test('only wallets with Solana support and connect are eligible', () => {
  const { wallet } = fixture();
  assert.equal(isSolanaWallet(wallet), true);
  assert.equal(isSolanaWallet({ ...wallet, chains: ['eip155:1'] }), false);
  assert.equal(isSolanaWallet({ ...wallet, features: {} }), false);
});
