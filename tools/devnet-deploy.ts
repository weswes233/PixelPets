/**
 * Scripted, idempotent PixelPets deployment: program -> Config + Core collection -> 3 editions -> env + evidence.
 *
 *   node tools/devnet-deploy.ts --network devnet            # plan only (read-only): genesis, balances, cost, next steps
 *   node tools/devnet-deploy.ts --network devnet --execute  # actually deploy (needs ~4.3 SOL on the deployer)
 *   node tools/devnet-deploy.ts --network localnet --rpc http://127.0.0.1:8999 --execute   # rehearsal on a bare isolated validator
 *
 * Keys come from runtime/devnet-keys/ (gitignored). Only public keys are printed or recorded.
 * The RPC URL may carry an API key: it is never printed or written to evidence (only to the 0600 runtime env file).
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL, type TransactionInstruction } from '@solana/web3.js';
import { PixelPetsClient, PROGRAM_ID, GENESIS_HASHES, UPGRADEABLE_LOADER_ID, CORE_PROGRAM_ID } from '../chain-client/src/index.ts';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const network = (opt('--network') ?? 'devnet') as 'devnet' | 'localnet';
if (!['devnet', 'localnet'].includes(network)) throw new Error('--network must be devnet or localnet (mainnet is intentionally unsupported)');
const execute = flag('--execute');
const keysDir = path.resolve(opt('--keys') ?? path.join(ROOT, 'runtime/devnet-keys'));
const SPECIES = ['moss', 'puddle', 'wisp'] as const;
const EDITION_IDS: Record<typeof SPECIES[number], string> = { moss: '1001', puddle: '1002', wisp: '1003' };
const MAX_SUPPLY = Number(opt('--max-supply') ?? 20);
const FEE_BPS = 250;
const PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';

async function loadEnvFile(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of (await readFile(file, 'utf8')).split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2]; }
  return out;
}
const helius = await loadEnvFile(path.join(ROOT, 'runtime/helius.local.env'));
const rpcUrl = opt('--rpc') ?? process.env.DEPLOY_RPC_URL ?? (network === 'devnet' ? (helius.CHAIN_RPC_URL || PUBLIC_DEVNET_RPC) : 'http://127.0.0.1:8999');
const redacted = (() => { try { const u = new URL(rpcUrl); return `${u.protocol}//${u.host}${u.search ? '/?<redacted>' : ''}`; } catch { return '<invalid>'; } })();
if (network === 'localnet') { const u = new URL(rpcUrl); if (u.hostname !== '127.0.0.1' || u.port !== '8999') throw new Error('localnet rehearsal only targets the isolated 127.0.0.1:8999 validator'); }

const readKey = async (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path.join(keysDir, name), 'utf8'))));
const deployer = await readKey('deployer.json');
const issuer = await readKey('issuer.json');
const programKey = await readKey('program-pixel_pets.json');
if (!programKey.publicKey.equals(PROGRAM_ID)) throw new Error(`Program keypair ${programKey.publicKey.toBase58()} != IDL address ${PROGRAM_ID.toBase58()}`);
const collectionFile = path.join(keysDir, `collection-${network}.json`);

const soPath = path.join(ROOT, 'chain/target/deploy/pixel_pets.so');
const so = await readFile(soPath);
const soSha = createHash('sha256').update(so).digest('hex');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'deploy/metadata/manifest.json'), 'utf8')) as { files: { path: string; sha256: string; uri: string }[] };
const fileEntry = (p: string) => { const f = manifest.files.find(x => x.path === p); if (!f) throw new Error(`manifest missing ${p}`); return f; };
const collectionUri = fileEntry('json/collection.json').uri;

const connection = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: false });
const genesis = await connection.getGenesisHash();
if (network === 'devnet' && genesis !== GENESIS_HASHES.devnet) throw new Error(`RPC is not Solana Devnet (genesis ${genesis})`);
if (network === 'localnet' && Object.values(GENESIS_HASHES).includes(genesis)) throw new Error('localnet rehearsal refuses a public genesis');
const client = new PixelPetsClient({ rpc: connection, network, expectedGenesisHash: network === 'localnet' ? genesis : undefined });
const evidence: Record<string, unknown> & { steps: unknown[] } = { schema: 'pixel-pets:deploy-evidence:v1', network, genesis, rpc: redacted,
  program: PROGRAM_ID.toBase58(), soSha256: soSha, soBytes: so.length, deployer: deployer.publicKey.toBase58(), issuer: issuer.publicKey.toBase58(),
  core: CORE_PROGRAM_ID.toBase58(), startedAt: new Date().toISOString(), executed: execute, steps: [] };
const log = (msg: string) => console.log(msg);
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

async function send(label: string, ixs: TransactionInstruction[], extra: Keypair[] = []): Promise<string> {
  // A freshly deployed program becomes invocable one slot later ("Program is not deployed"); retry only that case.
  for (let attempt = 0; ; attempt++) {
    try { return await sendOnce(label, ixs, extra); }
    catch (error) { if (attempt < 30 && /Program is not deployed/.test(String((error as { transactionLogs?: string[] }).transactionLogs ?? error))) { await new Promise(r => setTimeout(r, 1000)); continue; } throw error; }
  }
}
async function sendOnce(label: string, ixs: TransactionInstruction[], extra: Keypair[] = []) {
  const block = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: deployer.publicKey, ...block }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  tx.sign(deployer, ...extra);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  const res = await connection.confirmTransaction({ ...block, signature }, 'confirmed');
  if (res.value.err) throw new Error(`${label} failed: ${JSON.stringify(res.value.err)} sig=${signature}`);
  evidence.steps.push({ label, signature }); log(`  ok ${label} ${signature}`);
  return signature;
}

// ---- 1. status ----
const programData = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], UPGRADEABLE_LOADER_ID)[0];
const [programInfo, coreInfo, balance] = await Promise.all([connection.getAccountInfo(PROGRAM_ID), connection.getAccountInfo(CORE_PROGRAM_ID), connection.getBalance(deployer.publicKey)]);
if (!coreInfo?.executable) throw new Error('Metaplex Core program is not deployed on this cluster');
const maxLen = so.length;
const programDataRent = await connection.getMinimumBalanceForRentExemption(45 + maxLen);
const programRent = await connection.getMinimumBalanceForRentExemption(36);
const setupBudget = Math.round(0.08 * LAMPORTS_PER_SOL); // config + collection + 3 editions + fees, generous
const deployFees = Math.round(0.02 * LAMPORTS_PER_SOL);  // ~ (so/1000) write txs at 5000 lamports each
const needed = (programInfo ? 0 : programDataRent + programRent + deployFees) + setupBudget;
log(`network=${network} rpc=${redacted} genesis=${genesis}`);
log(`program=${PROGRAM_ID.toBase58()} deployed=${Boolean(programInfo)} so=${so.length}B sha256=${soSha}`);
log(`deployer=${deployer.publicKey.toBase58()} balance=${sol(balance)} SOL; needed≈${sol(needed)} SOL (programdata rent ${sol(programDataRent)})`);
Object.assign(evidence, { deployerBalanceBefore: balance, estimatedLamports: needed, programDataRent });
if (!execute) { log(balance >= needed ? 'PLAN: funded; rerun with --execute' : `PLAN: underfunded by ${sol(needed - balance)} SOL; fund ${deployer.publicKey.toBase58()} then rerun with --execute`); process.exit(0); }
if (balance < needed) throw new Error(`Deployer underfunded: ${sol(balance)} < ${sol(needed)} SOL. Fund ${deployer.publicKey.toBase58()} first.`);

// ---- 2. program ----
if (!programInfo) {
  log('deploying program (solana program deploy --use-rpc)…');
  const keyArgs = ['program', 'deploy', soPath, '--url', rpcUrl, '--keypair', path.join(keysDir, 'deployer.json'),
    '--program-id', path.join(keysDir, 'program-pixel_pets.json'), '--upgrade-authority', path.join(keysDir, 'deployer.json'),
    '--max-len', String(maxLen), '--use-rpc', '--output', 'json'];
  try {
    const { stdout } = await run('solana', keyArgs, { maxBuffer: 1 << 24, timeout: 30 * 60_000 });
    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{')));
    evidence.steps.push({ label: 'program_deploy', signature: parsed.signature ?? null, programId: parsed.programId });
    log(`  ok program_deploy ${parsed.signature ?? ''}`);
  } catch (error) {
    const msg = String((error as { stderr?: string }).stderr ?? error).split(rpcUrl).join(redacted);
    throw new Error(`solana program deploy failed (a leftover buffer can be recovered with 'solana program show --buffers'): ${msg.slice(0, 2000)}`);
  }
}
const deployment = await client.assertDeployment();
if (!deployment.upgradeAuthority?.equals(deployer.publicKey)) throw new Error('Upgrade authority is not the deployer key');
const pdInfo = await connection.getAccountInfo(programData);
const onchainSha = createHash('sha256').update(pdInfo!.data.subarray(45, 45 + so.length)).digest('hex');
if (onchainSha !== soSha) throw new Error(`On-chain program bytes differ from local build (${onchainSha})`);
evidence.programVerified = { executable: true, upgradeAuthority: deployer.publicKey.toBase58(), programData: programData.toBase58(), bytesSha256: onchainSha };
log('  ok program verified (executable, authority, bytes)');

// ---- 3. Config + Core collection ----
const configPda = client.pdas.config()[0];
let collection: PublicKey;
if (!(await connection.getAccountInfo(configPda))) {
  let collectionKey: Keypair;
  if (existsSync(collectionFile)) collectionKey = await readKey(path.basename(collectionFile));
  else { collectionKey = Keypair.generate(); await writeFile(collectionFile, JSON.stringify([...collectionKey.secretKey]), { mode: 0o600 }); }
  await send('initialize_config_and_collection', [client.instructions.initialize({ admin: deployer.publicKey, issuer: issuer.publicKey,
    collection: collectionKey.publicKey, feeRecipient: deployer.publicKey, feeBps: FEE_BPS, name: 'PixelPets Devnet', uri: collectionUri })], [collectionKey]);
  collection = collectionKey.publicKey;
}
const config = await client.fetchConfig('confirmed');
if (!config.admin.equals(deployer.publicKey) || !config.issuer.equals(issuer.publicKey)) throw new Error('Existing Config admin/issuer do not match the deploy keys');
collection = config.collection;
log(`  ok config admin=${config.admin.toBase58()} issuer=${config.issuer.toBase58()} collection=${collection.toBase58()}`);

// ---- 4. editions ----
const editions: Record<string, string> = {};
for (const [index, species] of SPECIES.entries()) {
  const id = EDITION_IDS[species]; const meta = fileEntry(`json/${species}.json`);
  const originHash = createHash('sha256').update(`pixel-pets:origin:v1:${species}:${meta.sha256}`).digest();
  const pda = client.pdas.edition(id)[0];
  if (!(await connection.getAccountInfo(pda))) {
    await send(`create_edition_${species}`, [client.instructions.createEdition({ admin: deployer.publicKey, editionId: id, maxSupply: MAX_SUPPLY,
      originHash, rulesVersion: 1, species: index, name: `PixelPets ${species[0].toUpperCase()}${species.slice(1)}`, uri: meta.uri })]);
  }
  const ed = await client.fetchEdition(id, 'confirmed');
  if (ed.species !== index || ed.uri !== meta.uri) throw new Error(`Edition ${id} exists with different species/uri`);
  editions[species] = id;
}
log(`  ok editions ${JSON.stringify(editions)}`);

// ---- 5. outputs ----
const balanceAfter = await connection.getBalance(deployer.publicKey);
Object.assign(evidence, { collection: collection.toBase58(), collectionUri, editions, maxSupply: MAX_SUPPLY, feeBps: FEE_BPS, deployerBalanceAfter: balanceAfter, finishedAt: new Date().toISOString() });
const envFile = path.join(ROOT, `runtime/${network}-chain.env`);
await mkdir(path.dirname(envFile), { recursive: true });
await writeFile(envFile, [
  `# Generated by tools/devnet-deploy.ts ${new Date().toISOString()} — contains a private RPC URL; do not commit.`,
  'CHAIN_ENABLED=true', `CHAIN_NETWORK=${network}`, `CHAIN_PROGRAM_ID=${PROGRAM_ID.toBase58()}`, `CHAIN_COLLECTION_ADDRESS=${collection.toBase58()}`,
  `CHAIN_RPC_URL='${rpcUrl}'`, `CHAIN_PUBLIC_RPC_URL=${network === 'devnet' ? PUBLIC_DEVNET_RPC : rpcUrl}`,
  `CHAIN_ISSUER_KEYPAIR_PATH=${path.join(keysDir, 'issuer.json')}`, `CHAIN_EDITIONS_JSON='${JSON.stringify(editions)}'`, `CHAIN_GENESIS_HASH=${genesis}`, ''].join('\n'), { mode: 0o600 });
await chmod(envFile, 0o600);
const evidenceFile = network === 'devnet'
  ? path.join(ROOT, `docs/evidence/devnet-deploy-${new Date().toISOString().slice(0, 10)}.json`)
  : path.join(ROOT, 'chain/evidence/devnet-deploy-rehearsal-localnet.json');
await mkdir(path.dirname(evidenceFile), { recursive: true });
if (evidence.steps.length > 0 || !existsSync(evidenceFile)) await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
else log('no new transactions; existing evidence kept');
log(`DEPLOYED network=${network} collection=${collection.toBase58()} spent=${sol(balance - balanceAfter)} SOL`);
log(`env -> ${path.relative(ROOT, envFile)} (0600), evidence -> ${path.relative(ROOT, evidenceFile)}`);
