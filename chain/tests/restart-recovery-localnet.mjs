/**
 * P0 restart drill (localnet): claim → start trip → kill server mid-trip → restart on the same SQLite →
 * trip still travelling with the same server end time → reveal after restart → prepare journey receipt →
 * restart again → the same pending receipt intent survives → sign & confirm it.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { runPetTransaction } from '../../wallet-web/src/transactions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries((await readFile(path.join(root, 'runtime/localnet-chain.env'), 'utf8')).split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^'(.*)'$/, '$1')]));
assert.equal(env.CHAIN_NETWORK, 'localnet');
const rpc = new Connection(env.CHAIN_RPC_URL, 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/chain-fixtures/local-admin.keypair.json'), 'utf8'))));
const player = Keypair.generate();
{ const block = await rpc.getLatestBlockhash(); const tx = new Transaction({ feePayer: admin.publicKey, ...block })
    .add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: player.publicKey, lamports: 2 * LAMPORTS_PER_SOL })); tx.sign(admin);
  await rpc.confirmTransaction({ ...block, signature: await rpc.sendRawTransaction(tx.serialize()) }, 'finalized'); }
const dir = await mkdtemp(path.join(root, 'runtime/restart-drill-'));
const port = 9793; const db = path.join(dir, 'pets.sqlite');
let server; let serverLog = '';
const base = `http://127.0.0.1:${port}/api/v1`;
async function start() {
  server = spawn(process.execPath, [path.join(root, 'server/src/index.ts')], { env: { ...process.env, ...env, PIXELPETS_DB: db, PORT: String(port), HOST: '127.0.0.1',
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, TRAVEL_DURATION_MS: '6000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/travel/catalog`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function restart() { const exited = new Promise(r => server.once('exit', r)); server.kill('SIGKILL'); await exited; await start(); }
async function api(route, method = 'GET', token, body) {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const p = await r.json(); assert(r.ok && p.ok, `${method} ${route}: ${JSON.stringify(p.error)}`); return p.data;
}
const evidence = { schema: 1, kind: 'restart-recovery-drill', network: 'localnet', program: env.CHAIN_PROGRAM_ID, localFundsHaveNoValue: true, startedAt: new Date().toISOString(), checks: [], transactions: [] };
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
try {
  await start();
  const config = await api('/chain/config');
  const guest = await api('/guests', 'POST', undefined, {});
  const { pet } = await api('/pets', 'POST', guest.token, { species_id: 'wisp', nickname: 'Restart', event_id: randomUUID() });
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: player.publicKey.toBase58() });
  const key = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(player.secretKey.subarray(0, 32))]) });
  const session = await api('/wallet/verify', 'POST', guest.token, { challenge_id: challenge.challenge_id, signature: sign(null, Buffer.from(challenge.message), key).toString('base64') });
  const account = { address: player.publicKey.toBase58(), publicKey: player.publicKey.toBytes(), chains: ['solana:localnet'], features: ['solana:signTransaction'] };
  const wallet = { version: '1.0.0', name: 'Disposable restart signer', icon: 'data:image/svg+xml;base64,', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input) {
      const tx = Transaction.from(input.transaction); tx.partialSign(player); return [{ signedTransaction: tx.serialize() }]; } } } };
  const context = { api, token: session.token, wallet, account, config: { ...config, network: 'solana:localnet' }, connection: rpc, assertCurrent() {}, async review() { return true; } };
  const finalized = async id => { for (let i = 0; i < 120; i++) { const v = await api(`/chain/intents/${id}`, 'GET', session.token);
    if (v.state === 'confirmed') return v; assert(!['failed', 'expired'].includes(v.state), v.state); await new Promise(r => setTimeout(r, 500)); } throw new Error('timeout'); };
  const claimed = await finalized((await runPetTransaction(context, pet.id, 'claim')).intent_id);
  evidence.asset = claimed.asset_address; evidence.transactions.push({ label: 'claim', signature: claimed.signature });
  const started = await api(`/pets/${pet.id}/trips`, 'POST', session.token, { event_id: randomUUID(), route_id: 'moonlit_lane', packing_id: 'tiny_lantern' });
  const before = (await api(`/pets/${pet.id}/trips/current`, 'GET', session.token)).trip;
  assert.equal(before.state, 'travelling');
  await restart();
  const after = (await api(`/pets/${pet.id}/trips/current`, 'GET', session.token)).trip;
  assert.equal(after.id, started.trip.id); assert.equal(after.state, 'travelling');
  assert.ok(before.ready_at); assert.equal(after.ready_at, before.ready_at);
  check('Server killed mid-trip (SIGKILL); after restart the same trip is still travelling with the same server return time');
  for (let i = 0; i < 40; i++) { const t = (await api(`/pets/${pet.id}/trips/current`, 'GET', session.token)).trip; if (t.state !== 'travelling') break; await new Promise(r => setTimeout(r, 500)); }
  const revealed = await api(`/trips/${started.trip.id}/reveal`, 'POST', session.token, { event_id: randomUUID() });
  assert.match(revealed.trip.result.result_hash, /^[a-f0-9]{64}$/);
  evidence.public_receipt_id = revealed.trip.public_receipt_id; evidence.result_hash = revealed.trip.result.result_hash;
  check('Reveal succeeds after restart; server settles the result once');
  const intent = await api(`/trips/${started.trip.id}/checkpoint-intent`, 'POST', session.token, {});
  assert.equal(intent.state, 'prepared');
  await restart();
  const survived = await api(`/chain/intents/${intent.intent_id}`, 'GET', session.token);
  assert.equal(survived.intent_id, intent.intent_id); assert.notEqual(survived.state, 'confirmed');
  const again = await api(`/trips/${started.trip.id}/checkpoint-intent`, 'POST', session.token, {});
  assert.equal(again.intent_id, intent.intent_id, 'restart must not mint a second receipt intent');
  check('Pending (unsigned) journey receipt survives a second restart; re-requesting returns the same intent');
  const receipt = await finalized((await runPetTransaction(context, pet.id, 'checkpoint', { tripId: started.trip.id, resultHash: revealed.trip.result.result_hash })).intent_id);
  assert.equal(receipt.intent_id, intent.intent_id);
  evidence.transactions.push({ label: 'journey_receipt', signature: receipt.signature, intent_id: receipt.intent_id });
  check('The surviving intent is signed and confirmed after restart');
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'chain/evidence/restart-recovery-localnet.json'), JSON.stringify(evidence, null, 2) + '\n');
} catch (e) { console.error(serverLog.slice(-3000)); throw e; } finally { server?.kill(); }
