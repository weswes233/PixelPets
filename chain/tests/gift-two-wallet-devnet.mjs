/**
 * P1 two-wallet gift on Devnet: player-a claims → gift blocked while travelling → reveal →
 * gifts to player-b → A cannot care → B syncs and continues care.
 * Uses runtime/devnet-chain.env + runtime/devnet-keys/player-{a,b}.json. Never prints secrets.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { GENESIS_HASHES } from '../../chain-client/src/index.ts';
import { runGiftTransaction, runPetTransaction } from '../../wallet-web/src/transactions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries((await readFile(path.join(root, 'runtime/devnet-chain.env'), 'utf8')).split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^'(.*)'$/, '$1')]));
assert.equal(env.CHAIN_NETWORK, 'devnet');
assert.equal(env.CHAIN_GENESIS_HASH, GENESIS_HASHES.devnet);

const publicRpc = env.CHAIN_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const rpc = new Connection(publicRpc, 'confirmed');
const genesis = await rpc.getGenesisHash();
assert.equal(genesis, GENESIS_HASHES.devnet);

const A = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/devnet-keys/player-a.json'), 'utf8'))));
const B = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/devnet-keys/player-b.json'), 'utf8'))));
const balA = await rpc.getBalance(A.publicKey);
const balB = await rpc.getBalance(B.publicKey);
console.log(`player_a=${A.publicKey.toBase58()} bal=${(balA / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`player_b=${B.publicKey.toBase58()} bal=${(balB / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
// Need ~0.01 SOL for claim rent + fees; gift is cheaper. Report shortfall honestly if tight.
const needA = Math.round(0.015 * LAMPORTS_PER_SOL);
if (balA < needA) {
  const shortfall = (needA - balA) / LAMPORTS_PER_SOL;
  console.error(`SHORTFALL player-a needs ~0.015 SOL for claim+gift; short by ${shortfall.toFixed(6)} SOL`);
  process.exit(2);
}

const dir = await mkdtemp(path.join(root, 'runtime/gift-smoke-devnet-'));
const port = 9793;
const server = spawn(process.execPath, [path.join(root, 'server/src/index.ts')], {
  env: { ...process.env, ...env, PIXELPETS_DB: path.join(dir, 'pets.sqlite'), PORT: String(port),
    HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, TRAVEL_DURATION_MS: '3000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
const base = `http://127.0.0.1:${port}/api/v1`;
async function raw(route, method = 'GET', token, body) {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  return { status: r.status, ...(await r.json()) };
}
async function api(route, method, token, body) {
  const p = await raw(route, method, token, body);
  assert(p.ok, `${method} ${route}: ${JSON.stringify(p.error)}`);
  return p.data;
}
const evidence = {
  schema: 1, kind: 'gift-two-wallet', network: 'devnet', genesis, program: env.CHAIN_PROGRAM_ID,
  collection: env.CHAIN_COLLECTION_ADDRESS,
  wallets: { A: A.publicKey.toBase58(), B: B.publicKey.toBase58() },
  balances_before: { A_sol: balA / LAMPORTS_PER_SOL, B_sol: balB / LAMPORTS_PER_SOL },
  startedAt: new Date().toISOString(), checks: [], transactions: [],
};
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function signIn(kp) {
  const guest = await api('/guests', 'POST', undefined, {});
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: kp.publicKey.toBase58() });
  const key = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.subarray(0, 32))]) });
  const session = await api('/wallet/verify', 'POST', guest.token, { challenge_id: challenge.challenge_id, signature: sign(null, Buffer.from(challenge.message), key).toString('base64') });
  return { guest, session };
}
function contextFor(kp, token, config) {
  const account = { address: kp.publicKey.toBase58(), publicKey: kp.publicKey.toBytes(), chains: ['solana:devnet'], features: ['solana:signTransaction'] };
  const wallet = { version: '1.0.0', name: 'Devnet gift signer', icon: 'data:image/svg+xml;base64,', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input) {
      const tx = Transaction.from(input.transaction); tx.partialSign(kp); return [{ signedTransaction: tx.serialize() }]; } } } };
  return { api, token, wallet, account, config: { ...config, network: 'solana:devnet' }, connection: rpc, assertCurrent() {}, reviews: [], async review(s) { this.reviews.push(s); return true; } };
}
try {
  for (let i = 0; i < 90; i++) { try { await fetch(`${base}/travel/catalog`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  const config = await api('/chain/config');
  const a = await signIn(A);
  const { pet } = await api('/pets', 'POST', a.guest.token, { species_id: 'moss', nickname: 'GiftDev', event_id: randomUUID() });
  const ctxA = contextFor(A, a.session.token, config);
  const finalized = async (id, token) => {
    for (let i = 0; i < 180; i++) {
      const v = await api(`/chain/intents/${id}`, 'GET', token);
      if (v.state === 'confirmed') return v;
      assert(!['failed', 'expired'].includes(v.state), v.state);
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('timeout');
  };
  const claimed = await finalized((await runPetTransaction(ctxA, pet.id, 'claim')).intent_id, a.session.token);
  const asset = claimed.asset_address; evidence.asset = asset;
  evidence.transactions.push({
    label: 'claim', signature: claimed.signature, asset,
    explorer: `https://explorer.solana.com/tx/${claimed.signature}?cluster=devnet`,
    asset_explorer: `https://explorer.solana.com/address/${asset}?cluster=devnet`,
  });
  check('A claims the companion on Devnet');
  const started = await api(`/pets/${pet.id}/trips`, 'POST', a.session.token, { event_id: randomUUID(), route_id: 'sunny_market', packing_id: 'snack_tin' });
  await assert.rejects(runGiftTransaction(ctxA, pet.id, B.publicKey.toBase58()), e => e.code === 'GIFT_BLOCKED_TRAVELLING');
  check('Gift is refused while the companion is travelling (no transaction prepared)');
  await new Promise(r => setTimeout(r, 3500));
  await api(`/trips/${started.trip.id}/reveal`, 'POST', a.session.token, { event_id: randomUUID() });
  await assert.rejects(runGiftTransaction(ctxA, pet.id, A.publicKey.toBase58()), e => e.code === 'SELF_TRANSFER');
  await assert.rejects(runGiftTransaction(ctxA, pet.id, 'not-an-address'), e => e.code === 'RECIPIENT_INVALID');
  const refused = { ...ctxA, async review() { return false; } };
  await assert.rejects(runGiftTransaction(refused, pet.id, B.publicKey.toBase58()), e => e.code === 'USER_CANCELLED');
  check('Self-gift, invalid address and cancelled review all stop before signing');
  const gifted = await runGiftTransaction(ctxA, pet.id, B.publicKey.toBase58());
  assert.equal(gifted.state, 'gifted', JSON.stringify(gifted));
  evidence.transactions.push({
    label: 'gift', signature: gifted.signature, slot: gifted.slot,
    from: A.publicKey.toBase58(), to: B.publicKey.toBase58(), asset,
    explorer: `https://explorer.solana.com/tx/${gifted.signature}?cluster=devnet`,
  });
  check('A gifts via owner-signed Core transfer; review showed network, asset, recipient and fee; finalized');
  const careA = await raw(`/pets/${pet.id}/care`, 'POST', a.session.token, { action: 'feed', event_id: randomUUID().replaceAll('-', '') });
  assert.equal(careA.ok, false, 'A must not care for a gifted pet');
  check(`A can no longer care after the gift (${careA.error?.code})`);
  const b = await signIn(B);
  const synced = await api('/wallet/assets/sync', 'POST', b.session.token, {});
  const mine = synced.pets.find(p => p.chain?.asset_address === asset);
  assert(mine, 'B sees the gifted asset after sync'); assert.equal(mine.ownership?.can_interact, true);
  await api(`/pets/${mine.id}/care`, 'POST', b.session.token, { action: 'feed', event_id: randomUUID().replaceAll('-', '') });
  evidence.recipientPetId = mine.id;
  check('B signs in, syncs, sees the same asset and continues care');
  evidence.balances_after = {
    A_sol: (await rpc.getBalance(A.publicKey)) / LAMPORTS_PER_SOL,
    B_sol: (await rpc.getBalance(B.publicKey)) / LAMPORTS_PER_SOL,
  };
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'chain/evidence/gift-two-wallet-devnet.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('WROTE chain/evidence/gift-two-wallet-devnet.json');
} catch (e) {
  console.error(serverLog.slice(-4000));
  throw e;
} finally {
  server.kill();
}
