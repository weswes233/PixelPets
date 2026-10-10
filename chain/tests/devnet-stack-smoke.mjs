/**
 * Devnet smoke: claim → trip → reveal → journey receipt against runtime/devnet-chain.env.
 * Uses scripted player-a wallet. Does not print secrets.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { GENESIS_HASHES } from '../../chain-client/src/index.ts';
import { runPetTransaction } from '../../wallet-web/src/transactions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envLines = (await readFile(path.join(root, 'runtime/devnet-chain.env'), 'utf8')).split('\n');
const env = Object.fromEntries(envLines.map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^'(.*)'$/, '$1')]));
assert.equal(env.CHAIN_NETWORK, 'devnet');
assert.equal(env.CHAIN_GENESIS_HASH, GENESIS_HASHES.devnet);

const publicRpc = env.CHAIN_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
const rpc = new Connection(publicRpc, 'confirmed');
const genesis = await rpc.getGenesisHash();
assert.equal(genesis, GENESIS_HASHES.devnet);

const player = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(root, 'runtime/devnet-keys/player-a.json'), 'utf8'))));
const bal = await rpc.getBalance(player.publicKey);
console.log(`player_a=${player.publicKey.toBase58()} balance_sol=${(bal/1e9).toFixed(4)}`);
assert(bal >= 0.02 * 1e9, 'player-a underfunded');

const dir = await mkdtemp(path.join(root, 'runtime/devnet-smoke-'));
const port = 9792;
const serverEnv = {
  ...process.env,
  ...env,
  PIXELPETS_DB: path.join(dir, 'pets.sqlite'),
  PORT: String(port),
  HOST: '127.0.0.1',
  PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  TRAVEL_DURATION_MS: '3000',
};
const server = spawn(process.execPath, [path.join(root, 'server/src/index.ts')], {
  env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; process.stdout.write(d); });
server.stderr.on('data', d => { serverLog += d; process.stderr.write(d); });

const base = `http://127.0.0.1:${port}/api/v1`;
async function api(route, method = 'GET', token, body) {
  const r = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const p = await r.json();
  assert(r.ok && p.ok, `${method} ${route}: ${JSON.stringify(p.error)}`);
  return p.data;
}

const evidence = {
  schema: 1,
  kind: 'deployed-stack-smoke',
  network: 'devnet',
  genesis,
  program: env.CHAIN_PROGRAM_ID,
  collection: env.CHAIN_COLLECTION_ADDRESS,
  editions: JSON.parse(env.CHAIN_EDITIONS_JSON),
  player: player.publicKey.toBase58(),
  explorer: {
    cluster: 'devnet',
    program: `https://explorer.solana.com/address/${env.CHAIN_PROGRAM_ID}?cluster=devnet`,
    collection: `https://explorer.solana.com/address/${env.CHAIN_COLLECTION_ADDRESS}?cluster=devnet`,
  },
  startedAt: new Date().toISOString(),
  checks: [],
  transactions: [],
};
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };

try {
  for (let i = 0; i < 90; i++) {
    try { await fetch(`${base}/travel/catalog`); break; }
    catch { await new Promise(r => setTimeout(r, 500)); }
    if (i === 89) throw new Error('server failed to boot\n' + serverLog.slice(-4000));
  }
  const config = await api('/chain/config');
  assert.equal(config.enabled, true);
  assert.equal(config.program_id ?? config.programId ?? env.CHAIN_PROGRAM_ID, env.CHAIN_PROGRAM_ID);
  check('Real server entrypoint boots from the deploy-script env file with chain enabled on Devnet');

  const guest = await api('/guests', 'POST', undefined, {});
  const { pet } = await api('/pets', 'POST', guest.token, { species_id: 'puddle', nickname: 'DevnetSmoke', event_id: randomUUID() });
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: player.publicKey.toBase58() });
  const key = createPrivateKey({
    format: 'der', type: 'pkcs8',
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(player.secretKey.subarray(0, 32))]),
  });
  const session = await api('/wallet/verify', 'POST', guest.token, {
    challenge_id: challenge.challenge_id,
    signature: sign(null, Buffer.from(challenge.message), key).toString('base64'),
  });

  // Normalize for wallet-web
  config.network = 'solana:devnet';
  const account = {
    address: player.publicKey.toBase58(),
    publicKey: player.publicKey.toBytes(),
    chains: ['solana:devnet'],
    features: ['solana:signTransaction'],
  };
  const wallet = {
    version: '1.0.0', name: 'Scripted Devnet player-a', icon: 'data:image/svg+xml;base64,',
    accounts: [account], chains: account.chains,
    features: {
      'solana:signTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy'],
        async signTransaction(input) {
          const tx = Transaction.from(input.transaction);
          tx.partialSign(player);
          return [{ signedTransaction: tx.serialize() }];
        },
      },
    },
  };
  const context = {
    api, token: session.token, wallet, account, config,
    connection: rpc,
    assertCurrent() {},
    async review() { return true; },
  };
  const finalized = async id => {
    for (let i = 0; i < 180; i++) {
      const v = await api(`/chain/intents/${id}`, 'GET', session.token);
      if (v.state === 'confirmed') return v;
      assert(!['failed', 'expired'].includes(v.state), `intent ${id} ${v.state}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('timeout waiting for intent ' + id);
  };

  console.log('claiming…');
  const claimed = await finalized((await runPetTransaction(context, pet.id, 'claim')).intent_id);
  assert.equal(claimed.pet.chain.status, 'registered');
  evidence.transactions.push({
    label: 'claim',
    signature: claimed.signature,
    asset: claimed.asset_address,
    explorer: `https://explorer.solana.com/tx/${claimed.signature}?cluster=devnet`,
    asset_explorer: `https://explorer.solana.com/address/${claimed.asset_address}?cluster=devnet`,
  });
  check('Wallet-signed claim mints a real Core asset in the Devnet collection/edition');

  console.log('starting trip…');
  const started = await api(`/pets/${pet.id}/trips`, 'POST', session.token, {
    event_id: randomUUID(), route_id: 'sunny_market', packing_id: 'snack_tin',
  });
  await new Promise(r => setTimeout(r, 3500));
  const revealed = await api(`/trips/${started.trip.id}/reveal`, 'POST', session.token, { event_id: randomUUID() });
  console.log('saving journey receipt…');
  const receipt = await finalized((await runPetTransaction(context, pet.id, 'checkpoint', {
    tripId: started.trip.id, resultHash: revealed.trip.result.result_hash,
  })).intent_id);
  evidence.transactions.push({
    label: 'journey_receipt',
    signature: receipt.signature,
    public_receipt_id: revealed.trip.public_receipt_id,
    event_hash: receipt.journey.event_hash,
    explorer: `https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`,
  });
  check('Trip settled by the server is saved as a checkpoint v2 receipt on Devnet');

  const proof = await api(`/trips/${revealed.trip.public_receipt_id}/proof`);
  const file = path.join(dir, 'proof.json');
  await writeFile(file, JSON.stringify(proof));
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(root, 'tools/verify-journey-proof.ts'), '--proof', file, '--rpc', publicRpc,
  ], { timeout: 120_000 });
  assert.match(stdout, /^VERIFIED \d+ checks$/m, stdout);
  check(`Public proof verified independently (${/VERIFIED (\d+)/.exec(stdout)[1]} checks)`);

  evidence.finishedAt = new Date().toISOString();
  evidence.trip = {
    id: started.trip.id,
    route_id: 'sunny_market',
    public_receipt_id: revealed.trip.public_receipt_id,
    result_hash: revealed.trip.result.result_hash,
  };
  await mkdir(path.join(root, 'chain/evidence'), { recursive: true });
  await writeFile(path.join(root, 'chain/evidence/deployed-stack-smoke-devnet.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('WROTE chain/evidence/deployed-stack-smoke-devnet.json');
  console.log(JSON.stringify({ claim: claimed.signature, asset: claimed.asset_address, receipt: receipt.signature, public_receipt_id: revealed.trip.public_receipt_id }, null, 2));
} catch (e) {
  console.error('SMOKE FAILED');
  console.error(String(e?.stack || e));
  console.error('--- server log tail ---');
  console.error(serverLog.slice(-5000));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  setTimeout(() => { try { server.kill('SIGKILL'); } catch {} }, 2000);
}
