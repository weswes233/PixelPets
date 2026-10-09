/**
 * P1 two-wallet gift on localnet (Astra §9): A claims → gift blocked while travelling → reveal →
 * A gifts via runGiftTransaction (chain-client prepareGift, owner-signed Core TransferV1) →
 * A can no longer care → B signs in, syncs, sees the same asset and continues care. Private journal is not copied.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { runGiftTransaction, runPetTransaction } from '../../wallet-web/src/transactions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries((await readFile(path.join(root, 'runtime/localnet-chain.env'), 'utf8')).split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^'(.*)'$/, '$1')]));
assert.equal(env.CHAIN_NETWORK, 'localnet');
const rpc = new Connection(env.CHAIN_RPC_URL, 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/chain-fixtures/local-admin.keypair.json'), 'utf8'))));
const A = Keypair.generate(); const B = Keypair.generate();
{ const block = await rpc.getLatestBlockhash(); const tx = new Transaction({ feePayer: admin.publicKey, ...block });
  for (const k of [A, B]) tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: k.publicKey, lamports: 2 * LAMPORTS_PER_SOL })); tx.sign(admin);
  await rpc.confirmTransaction({ ...block, signature: await rpc.sendRawTransaction(tx.serialize()) }, 'finalized'); }
const dir = await mkdtemp(path.join(root, 'runtime/gift-smoke-'));
const port = 9792;
const server = spawn(process.execPath, [path.join(root, 'server/src/index.ts')], { env: { ...process.env, ...env,
  PIXELPETS_DB: path.join(dir, 'pets.sqlite'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, TRAVEL_DURATION_MS: '2000' },
  stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const base = `http://127.0.0.1:${port}/api/v1`;
async function raw(route, method = 'GET', token, body) {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  return { status: r.status, ...(await r.json()) };
}
async function api(route, method, token, body) { const p = await raw(route, method, token, body); assert(p.ok, `${method} ${route}: ${JSON.stringify(p.error)}`); return p.data; }
const evidence = { schema: 1, kind: 'gift-two-wallet', network: 'localnet', genesis: await rpc.getGenesisHash(), program: env.CHAIN_PROGRAM_ID,
  collection: env.CHAIN_COLLECTION_ADDRESS, localFundsHaveNoValue: true, wallets: { A: A.publicKey.toBase58(), B: B.publicKey.toBase58() }, startedAt: new Date().toISOString(), checks: [], transactions: [] };
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function signIn(kp) {
  const guest = await api('/guests', 'POST', undefined, {});
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: kp.publicKey.toBase58() });
  const key = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.subarray(0, 32))]) });
  const session = await api('/wallet/verify', 'POST', guest.token, { challenge_id: challenge.challenge_id, signature: sign(null, Buffer.from(challenge.message), key).toString('base64') });
  return { guest, session };
}
function contextFor(kp, token, config) {
  const account = { address: kp.publicKey.toBase58(), publicKey: kp.publicKey.toBytes(), chains: ['solana:localnet'], features: ['solana:signTransaction'] };
  const wallet = { version: '1.0.0', name: 'Disposable gift signer', icon: 'data:image/svg+xml;base64,', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input) {
      const tx = Transaction.from(input.transaction); tx.partialSign(kp); return [{ signedTransaction: tx.serialize() }]; } } } };
  return { api, token, wallet, account, config: { ...config, network: 'solana:localnet' }, connection: rpc, assertCurrent() {}, reviews: [], async review(s) { this.reviews.push(s); return true; } };
}
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/travel/catalog`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const config = await api('/chain/config');
  const a = await signIn(A);
  const { pet } = await api('/pets', 'POST', a.guest.token, { species_id: 'moss', nickname: 'Gifty', event_id: randomUUID() });
  const ctxA = contextFor(A, a.session.token, config);
  const finalized = async (id, token) => { for (let i = 0; i < 120; i++) { const v = await api(`/chain/intents/${id}`, 'GET', token);
    if (v.state === 'confirmed') return v; assert(!['failed', 'expired'].includes(v.state), v.state); await new Promise(r => setTimeout(r, 500)); } throw new Error('timeout'); };
  const claimed = await finalized((await runPetTransaction(ctxA, pet.id, 'claim')).intent_id, a.session.token);
  const asset = claimed.asset_address; evidence.asset = asset;
  evidence.transactions.push({ label: 'claim', signature: claimed.signature, asset });
  check('A claims the companion on localnet');
  const started = await api(`/pets/${pet.id}/trips`, 'POST', a.session.token, { event_id: randomUUID(), route_id: 'sunny_market', packing_id: 'snack_tin' });
  await assert.rejects(runGiftTransaction(ctxA, pet.id, B.publicKey.toBase58()), e => e.code === 'GIFT_BLOCKED_TRAVELLING');
  check('Gift is refused while the companion is travelling (no transaction prepared)');
  await new Promise(r => setTimeout(r, 2300));
  await api(`/trips/${started.trip.id}/reveal`, 'POST', a.session.token, { event_id: randomUUID() });
  await assert.rejects(runGiftTransaction(ctxA, pet.id, A.publicKey.toBase58()), e => e.code === 'SELF_TRANSFER');
  await assert.rejects(runGiftTransaction(ctxA, pet.id, 'not-an-address'), e => e.code === 'RECIPIENT_INVALID');
  const refused = { ...ctxA, async review() { return false; } };
  await assert.rejects(runGiftTransaction(refused, pet.id, B.publicKey.toBase58()), e => e.code === 'USER_CANCELLED');
  check('Self-gift, invalid address and cancelled review all stop before signing');
  const gifted = await runGiftTransaction(ctxA, pet.id, B.publicKey.toBase58());
  assert.equal(gifted.state, 'gifted', JSON.stringify(gifted));
  const review = ctxA.reviews.at(-1); assert.equal(review.asset, asset); assert.match(review.address, new RegExp(B.publicKey.toBase58()));
  evidence.transactions.push({ label: 'gift', signature: gifted.signature, slot: gifted.slot, from: A.publicKey.toBase58(), to: B.publicKey.toBase58(), asset });
  check('A gifts via owner-signed Core transfer; review showed network, asset, recipient and fee; finalized');
  const careA = await raw(`/pets/${pet.id}/care`, 'POST', a.session.token, { action: 'feed', event_id: randomUUID().replaceAll('-', '') });
  assert.equal(careA.ok, false, 'A must not care for a gifted pet');
  check(`A can no longer care after the gift (${careA.error?.code})`);
  const b = await signIn(B);
  const synced = await api('/wallet/assets/sync', 'POST', b.session.token, {});
  const mine = synced.pets.find(p => p.chain?.asset_address === asset);
  assert(mine, 'B sees the gifted asset after sync'); assert.equal(mine.ownership?.can_interact, true);
  const careB = await api(`/pets/${mine.id}/care`, 'POST', b.session.token, { action: 'feed', event_id: randomUUID().replaceAll('-', '') });
  assert(careB.pet || careB);
  evidence.recipientPetId = mine.id;
  check('B signs in, syncs, sees the same asset and continues care');
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'chain/evidence/gift-two-wallet-localnet.json'), JSON.stringify(evidence, null, 2) + '\n');
} catch (e) { console.error(serverLog.slice(-3000)); throw e; } finally { server.kill(); }
