/**
 * Smoke test of the *deployed* stack produced by tools/devnet-deploy.ts --network localnet:
 * spawns the real server entrypoint (server/src/index.ts) with runtime/localnet-chain.env, then
 * guest adopt -> SIWS -> claim (wallet-signed) -> trip -> reveal -> checkpoint v2 -> public proof -> independent verifier.
 * Localnet only (127.0.0.1:8999, non-public genesis). The test player is disposable and funded from the local admin.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { GENESIS_HASHES } from '../../chain-client/src/index.ts';
import { runPetTransaction } from '../../wallet-web/src/transactions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries((await readFile(path.join(root, 'runtime/localnet-chain.env'), 'utf8')).split('\n')
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^'(.*)'$/, '$1')]));
assert.equal(env.CHAIN_NETWORK, 'localnet'); assert.equal(env.CHAIN_RPC_URL, 'http://127.0.0.1:8999');
const rpc = new Connection(env.CHAIN_RPC_URL, 'confirmed');
const genesis = await rpc.getGenesisHash();
assert.equal(genesis, env.CHAIN_GENESIS_HASH); assert(!Object.values(GENESIS_HASHES).includes(genesis));
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/chain-fixtures/local-admin.keypair.json'), 'utf8'))));
const player = Keypair.generate();
{ const block = await rpc.getLatestBlockhash(); const tx = new Transaction({ feePayer: admin.publicKey, ...block })
    .add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: player.publicKey, lamports: 2 * LAMPORTS_PER_SOL })); tx.sign(admin);
  await rpc.confirmTransaction({ ...block, signature: await rpc.sendRawTransaction(tx.serialize()) }, 'finalized'); }

const dir = await mkdtemp(path.join(root, 'runtime/deployed-smoke-'));
const port = 9791;
const server = spawn(process.execPath, [path.join(root, 'server/src/index.ts')], { env: { ...process.env, ...env,
  PIXELPETS_DB: path.join(dir, 'pets.sqlite'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, TRAVEL_DURATION_MS: '2000' },
  stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const base = `http://127.0.0.1:${port}/api/v1`;
async function api(route, method = 'GET', token, body) {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const p = await r.json(); assert(r.ok && p.ok, `${method} ${route}: ${JSON.stringify(p.error)}`); return p.data;
}
const evidence = { schema: 1, kind: 'deployed-stack-smoke', network: 'localnet', genesis, program: env.CHAIN_PROGRAM_ID, collection: env.CHAIN_COLLECTION_ADDRESS,
  editions: JSON.parse(env.CHAIN_EDITIONS_JSON), localFundsHaveNoValue: true, startedAt: new Date().toISOString(), checks: [], transactions: [] };
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/travel/catalog`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const config = await api('/chain/config'); assert.equal(config.enabled, true); assert.equal(config.program_id ?? config.programId ?? env.CHAIN_PROGRAM_ID, env.CHAIN_PROGRAM_ID);
  check('Real server entrypoint boots from the deploy-script env file with chain enabled');
  const guest = await api('/guests', 'POST', undefined, {});
  const { pet } = await api('/pets', 'POST', guest.token, { species_id: 'puddle', nickname: 'Smoke', event_id: randomUUID() });
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: player.publicKey.toBase58() });
  const key = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(player.secretKey.subarray(0, 32))]) });
  const session = await api('/wallet/verify', 'POST', guest.token, { challenge_id: challenge.challenge_id, signature: sign(null, Buffer.from(challenge.message), key).toString('base64') });
  config.network = 'solana:localnet';
  const account = { address: player.publicKey.toBase58(), publicKey: player.publicKey.toBytes(), chains: ['solana:localnet'], features: ['solana:signTransaction'] };
  const wallet = { version: '1.0.0', name: 'Disposable smoke signer', icon: 'data:image/svg+xml;base64,', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input) {
      const tx = Transaction.from(input.transaction); tx.partialSign(player); return [{ signedTransaction: tx.serialize() }]; } } } };
  const context = { api, token: session.token, wallet, account, config, connection: rpc, assertCurrent() {}, async review() { return true; } };
  const finalized = async id => { for (let i = 0; i < 120; i++) { const v = await api(`/chain/intents/${id}`, 'GET', session.token);
    if (v.state === 'confirmed') return v; assert(!['failed', 'expired'].includes(v.state), v.state); await new Promise(r => setTimeout(r, 500)); } throw new Error('timeout'); };
  const claimed = await finalized((await runPetTransaction(context, pet.id, 'claim')).intent_id);
  assert.equal(claimed.pet.chain.status, 'registered');
  evidence.transactions.push({ label: 'claim', signature: claimed.signature, asset: claimed.asset_address });
  check('Wallet-signed claim mints a real Core asset in the deploy-script collection/edition');
  const started = await api(`/pets/${pet.id}/trips`, 'POST', session.token, { event_id: randomUUID(), route_id: 'sunny_market', packing_id: 'snack_tin' });
  await new Promise(r => setTimeout(r, 2300));
  const revealed = await api(`/trips/${started.trip.id}/reveal`, 'POST', session.token, { event_id: randomUUID() });
  const receipt = await finalized((await runPetTransaction(context, pet.id, 'checkpoint', { tripId: started.trip.id, resultHash: revealed.trip.result.result_hash })).intent_id);
  evidence.transactions.push({ label: 'journey_receipt', signature: receipt.signature, public_receipt_id: revealed.trip.public_receipt_id, event_hash: receipt.journey.event_hash });
  check('Trip settled by the server is saved as a checkpoint v2 receipt');
  const proof = await api(`/trips/${revealed.trip.public_receipt_id}/proof`);
  const file = path.join(dir, 'proof.json'); await writeFile(file, JSON.stringify(proof));
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'tools/verify-journey-proof.ts'), '--proof', file, '--rpc', env.CHAIN_RPC_URL]);
  assert.match(stdout, /^VERIFIED \d+ checks$/m, stdout);
  check(`Public proof verified independently (${/VERIFIED (\d+)/.exec(stdout)[1]} checks)`);
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'chain/evidence/deployed-stack-smoke-localnet.json'), JSON.stringify(evidence, null, 2) + '\n');
} catch (e) { console.error(serverLog.slice(-3000)); throw e; } finally { server.kill(); }
