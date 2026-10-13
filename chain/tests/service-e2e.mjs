/** HTTP + SQLite + Wallet Standard flow + actual local SBF/Core execution.
 * Only the first outbound submission is deliberately interrupted to test recovery.
 * Every RPC read, signature, account and later broadcast is real. No public network.
 */
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { PixelPetsClient, PROGRAM_ID, GENESIS_HASHES, createGiftInstruction } from '../../chain-client/src/index.ts';
import { Repository, ChainService, start } from '../../server/src/public.ts';
import { runPetTransaction } from '../../wallet-web/src/transactions.ts';
import { WalletController } from '../../wallet-web/src/controller.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rpcUrl = process.env.PIXELPETS_TEST_RPC ?? 'http://127.0.0.1:8899';
assert(['http://127.0.0.1:8899', 'http://127.0.0.1:8999'].includes(rpcUrl), 'Only the dedicated loopback validator is allowed');
const genesis = process.env.PIXELPETS_EXPECTED_GENESIS;
assert(genesis && !Object.values(GENESIS_HASHES).includes(genesis), 'Explicit non-public genesis is required');
assert(process.env.PIXELPETS_TEST_ADMIN, 'An explicit disposable admin file is required');
const runtime = await realpath(path.join(root, 'runtime'));
const adminPath = await realpath(process.env.PIXELPETS_TEST_ADMIN);
const relative = path.relative(runtime, adminPath);
assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Test admin must be inside project runtime');
const rpc = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
assert.equal(await rpc.getGenesisHash(), genesis);
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(adminPath, 'utf8'))));
const client = new PixelPetsClient({ rpc, network: 'localnet', expectedGenesisHash: genesis });
await client.assertDeployment();
const collectionSigner = Keypair.generate();
const hasConfig = Boolean(await rpc.getAccountInfo(client.pdas.config()[0], 'finalized'));
const oldConfig = hasConfig ? await client.fetchConfig('finalized') : { admin: admin.publicKey, collection: collectionSigner.publicKey };
assert(oldConfig.admin.equals(admin.publicKey), 'Local test admin must own this Config');
const runId = randomUUID(), directory = path.join(runtime, `service-e2e-${runId}`);
await mkdir(directory, { recursive: false });
const scenario = process.env.PIXELPETS_SERVICE_SCENARIO ?? 'checkpoint';
assert(['checkpoint', 'ownership', 'journey'].includes(scenario), 'Unknown local service scenario');
const evidenceFile = path.join(root, `chain/evidence/${scenario === 'ownership' ? 'ownership-service-e2e' : scenario === 'journey' ? 'journey-service-e2e' : 'service-e2e'}.json`);
const evidence = { schema: 1, runId, startedAt: new Date().toISOString(), rpc: rpcUrl, genesis,
  scenario,
  program: PROGRAM_ID.toBase58(), actualSbf: true, actualHttp: true, simulatedBrowserWallet: true,
  localFundsHaveNoValue: true, checks: [], transactions: [], reviewEstimates: [] };
const save = () => writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
const check = async (name, details = {}) => { evidence.checks.push({ name, status: 'passed', ...details }); console.log(`PASS ${name}`); await save(); };
const issuer = Keypair.generate(), player = Keypair.generate();
const editionBase = BigInt(Date.now());
const editions = Object.fromEntries(['moss', 'puddle', 'wisp'].map((name, index) => [name, String(editionBase + BigInt(index))]));
// The well-formed CID below is a local fixture; this script never asserts public metadata availability.
const fixtureUri = 'ipfs://bafkreigh2akiscaildc3b5rqfgzozc2fkausk6fkgteh4s6s5uswy4my6a';
const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');
let server, repository, service, baseUrl;
async function submitSetup(label, instructions, extraSigners = []) {
  assert.equal(await rpc.getGenesisHash(), genesis);
  const block = await rpc.getLatestBlockhash();
  const tx = new Transaction({ feePayer: admin.publicKey, ...block }).add(...instructions); tx.sign(admin, ...extraSigners);
  const signature = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const result = await rpc.confirmTransaction({ ...block, signature }, 'finalized'); assert.equal(result.value.err, null);
  evidence.transactions.push({ label, signature }); await save();
}
async function openService() {
  repository = new Repository(path.join(directory, 'pets.sqlite'), { network: 'localnet', publicOrigin: 'http://127.0.0.1:9783' });
  service = new ChainService(repository, { network: 'localnet', rpc, programId: PROGRAM_ID.toBase58(), issuer,
    collectionAddress: oldConfig.collection.toBase58(), editions, publicRpcUrl: rpcUrl, expectedGenesisHash: genesis });
  server = await start({ repository, chainService: service, port: 0, travelDurationMs: 2000 });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
}
async function closeService() {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server = undefined; repository?.close(); repository = undefined;
}
async function api(route, method = 'GET', token, body) {
  const response = await fetch(baseUrl + route, { method, signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  assert(response.ok && payload.ok, `${method} ${route}: ${JSON.stringify(payload.error)}`);
  return payload.data;
}
async function finalizedIntent(id, token) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await api(`/chain/intents/${id}`, 'GET', token);
    if (value.state === 'confirmed') return value;
    assert(!['failed', 'expired'].includes(value.state), `Intent ${value.state}`);
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error('Intent did not finalize before the test deadline');
}

try {
  await submitSetup('configure_disposable_service_issuer_and_fund_test_player', [
    hasConfig
      ? client.instructions.configure({ admin: admin.publicKey, issuer: issuer.publicKey, feeRecipient: admin.publicKey, feeBps: 250, paused: false })
      : client.instructions.initialize({ admin: admin.publicKey, issuer: issuer.publicKey, collection: collectionSigner.publicKey,
        feeRecipient: admin.publicKey, feeBps: 250, name: 'Service E2E', uri: fixtureUri }),
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: player.publicKey, lamports: 2000000000 }),
    ...Object.entries(editions).map(([species, editionId], index) => client.instructions.createEdition({ admin: admin.publicKey,
      editionId, maxSupply: 20, originHash: createHash('sha256').update(`local-service:${runId}:${species}`).digest(),
      rulesVersion: 1, species: index, name: `Local ${species}`, uri: fixtureUri })),
  ], hasConfig ? [] : [collectionSigner]);
  await openService();
  const guest = await api('/guests', 'POST', undefined, {});
  const { pet } = await api('/pets', 'POST', guest.token, { species_id: 'moss', nickname: '链上验收苔苔', event_id: randomUUID() });
  const challenge = await api('/wallet/challenge', 'POST', guest.token, { address: player.publicKey.toBase58() });
  const signingKey = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(player.secretKey.subarray(0, 32))]) });
  const session = await api('/wallet/verify', 'POST', guest.token, { challenge_id: challenge.challenge_id,
    signature: sign(null, Buffer.from(challenge.message), signingKey).toString('base64') });
  const config = await api('/chain/config'); assert.equal(config.enabled, true); config.network = 'solana:localnet';
  await check('HTTP guest adoption and real SIWS authenticate a funded disposable wallet against the deployed local program');
  const account = { address: player.publicKey.toBase58(), publicKey: player.publicKey.toBytes(), chains: ['solana:localnet'], features: ['solana:signTransaction'] };
  let signatures = 0;
  const wallet = { version: '1.0.0', name: 'Disposable integration signer', icon: 'data:image/svg+xml;base64,', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input) {
      assert.equal(input.chain, 'solana:localnet'); assert.equal(await rpc.getGenesisHash(), genesis);
      const tx = Transaction.from(input.transaction); tx.partialSign(player); signatures++; return [{ signedTransaction: tx.serialize() }];
    } } } };
  const context = { api, token: session.token, wallet, account, config, connection: rpc, assertCurrent() {}, async review(summary) {
    evidence.reviewEstimates.push(summary); assert(Number(summary.estimatedDebitSol) > 0); return true;
  } };
  const realSend = rpc.sendRawTransaction.bind(rpc);
  let interruptedWire;
  rpc.sendRawTransaction = async wire => { interruptedWire = Buffer.from(wire); throw new Error('Deliberate pre-broadcast disconnect'); };
  const pending = await runPetTransaction(context, pet.id, 'claim');
  rpc.sendRawTransaction = realSend;
  assert.equal(pending.state, 'pending'); assert.equal(signatures, 1);
  const stored = await api(`/chain/intents/${pending.intent_id}`, 'GET', session.token);
  assert.equal(stored.signed_transaction_base64, interruptedWire.toString('base64'));
  assert.equal(await rpc.getAccountInfo(new PublicKey(stored.asset_address)), null, 'Interruption happened before an asset was minted');
  await closeService(); await openService();
  const resumed = await runPetTransaction(context, pet.id, 'claim');
  assert.equal(signatures, 1, 'Recovery must not ask the wallet to sign again');
  const registered = await finalizedIntent(resumed.intent_id, session.token);
  const finalizedTx = await rpc.getTransaction(registered.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert(finalizedTx?.meta && finalizedTx.meta.err === null);
  assert(Buffer.from(finalizedTx.transaction.message.serialize()).equals(Transaction.from(interruptedWire).serializeMessage()));
  const official = await client.verifyOfficialPet(registered.asset_address, player.publicKey, 'finalized');
  assert.equal(registered.pet.chain.status, 'registered'); assert.equal(official.record.bond, 0);
  evidence.transactions.push({ label: 'claim_after_restart', signature: registered.signature, slot: finalizedTx.slot,
    computeUnitsConsumed: finalizedTx.meta.computeUnitsConsumed, wireSha256: fingerprint(interruptedWire), asset: registered.asset_address });
  await check('Interrupted submission survives HTTP service and SQLite restart, reuses one wallet signature, and finalizes a real Core asset');
  const replay = await api(`/pets/${pet.id}/claim-intent`, 'POST', session.token, {});
  assert.equal(replay.intent_id, registered.intent_id); assert.equal(replay.asset_address, registered.asset_address);
  await check('Repeated claim returns the same confirmed intent and asset');
  const care = await api(`/pets/${pet.id}/care`, 'POST', session.token, { action: 'explore', choice: 'moon', event_id: randomUUID() });
  assert.equal(care.pet.bond, 1);
  if (scenario === 'ownership') {
    const receiver = Keypair.generate();
    const receiverGuest = await api('/guests', 'POST', undefined, {});
    for (let index = 0; index < 3; index++) await api('/pets', 'POST', receiverGuest.token,
      { species_id: 'wisp', nickname: `接收方小屋${index}`, event_id: randomUUID() });
    const receiverKey = createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(receiver.secretKey.subarray(0, 32))]) });
    const receiverChallenge = await api('/wallet/challenge', 'POST', receiverGuest.token, { address: receiver.publicKey.toBase58() });
    await api('/wallet/verify', 'POST', receiverGuest.token, { challenge_id: receiverChallenge.challenge_id,
      signature: sign(null, Buffer.from(receiverChallenge.message), receiverKey).toString('base64') });
    await submitSetup('owner_signed_core_gift_to_another_bound_wallet', [createGiftInstruction({
      asset: registered.asset_address, collection: oldConfig.collection, owner: player.publicKey,
      recipient: receiver.publicKey, payer: admin.publicKey,
    })], [player]);
    const actual = await client.verifyOfficialPet(registered.asset_address, receiver.publicKey, 'finalized');
    assert.equal(actual.record.bond, 0, 'Uncheckpointed relationship growth is not transferable');
    const forbidden = await fetch(`${baseUrl}/pets/${pet.id}/care`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ action: 'feed', event_id: randomUUID() }) });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'PET_OWNER_CHANGED');
    assert.equal((await api('/pets', 'GET', guest.token)).pets.length, 0);
    await check('Real owner-signed Core transfer is finalized; the old owner cannot care even before requesting synchronization');
    const receiverAccount = { address: receiver.publicKey.toBase58(), publicKey: receiver.publicKey.toBytes(),
      chains: ['solana:localnet'], features: ['solana:signMessage'] };
    let recoverySignatures = 0;
    const recoveryWallet = { version: '1.0.0', name: 'Disposable recovery signer', icon: 'data:image/svg+xml;base64,',
      accounts: [receiverAccount], chains: receiverAccount.chains, features: {
        'standard:connect': { version: '1.0.0', async connect() { return { accounts: [receiverAccount] }; } },
        'solana:signMessage': { version: '1.0.0', async signMessage({ message }) { recoverySignatures++;
          return [{ signedMessage: message, signature: new Uint8Array(sign(null, message, receiverKey)) }]; } },
      } };
    const recoveredController = new WalletController(api);
    const recovered = await recoveredController.recover(recoveryWallet);
    assert.equal(recovered.user_id, receiverGuest.user_id);
    const assets = await recoveredController.syncAssets();
    const received = assets.pets.find(item => item.id === pet.id);
    assert.equal(assets.pets.length, 4); assert.equal(received.chain.received, true);
    assert.equal(received.ownership.can_interact, true); assert.equal(received.bond, 0);
    assert.equal(received.nickname, '苔苔');
    const privateHistory = await api('/journal', 'GET', recovered.game_token);
    assert(!privateHistory.entries.some(entry => entry.pet_id === pet.id), 'Old owner diary stays private');
    await check('A fresh wallet controller recovers the receiving profile and synchronizes the real asset beside three free pets without copying the old relationship');
    const nextCare = await recoveredController.care(pet.id, { action: 'feed', event_id: randomUUID().replaceAll('-', '') });
    assert.equal(nextCare.pet.bond, 1); assert.equal(recoverySignatures, 1, 'Daily care needs no additional wallet signature');
    await closeService(); await openService();
    const persisted = (await api('/pets', 'GET', recovered.game_token)).pets.find(item => item.id === pet.id);
    assert.equal(persisted.chain.asset_address, registered.asset_address); assert.equal(persisted.bond, 1);
    assert.equal(persisted.chain.received, true); assert.equal((await recoveredController.syncAssets()).pets.length, 4);
    await check('New owner daily care requires no transaction signature and survives a real HTTP/SQLite restart with recovered credentials');
  } else if (scenario === 'journey') {
    const proofs = [];
    for (const [index, route] of ['moonlit_lane', 'sunny_market'].entries()) {
      const started = await api(`/pets/${pet.id}/trips`, 'POST', session.token, { event_id: randomUUID(), route_id: route, packing_id: 'tiny_lantern' });
      assert.equal(started.trip.state, 'travelling'); assert.equal(started.trip.duration_ms, 2000);
      await new Promise(resolve => setTimeout(resolve, 2300));
      const revealed = await api(`/trips/${started.trip.id}/reveal`, 'POST', session.token, { event_id: randomUUID() });
      assert.equal(revealed.trip.state, 'revealed');
      const before = signatures;
      const saved = await runPetTransaction(context, pet.id, 'checkpoint', { tripId: started.trip.id, resultHash: revealed.trip.result.result_hash });
      const receipt = await finalizedIntent(saved.intent_id, session.token);
      assert.equal(signatures, before + 1); assert.equal(receipt.journey.trip_id, started.trip.id);
      const onChain = await client.verifyOfficialPet(registered.asset_address, player.publicKey, 'finalized');
      assert.equal(Buffer.from(onChain.record.event_hash).toString('hex'), receipt.journey.event_hash);
      assert.equal(onChain.record.checkpoint.toString(), String(index + 1));
      const proof = await api(`/trips/${revealed.trip.public_receipt_id}/proof`);
      assert.equal(proof.checkpoints.length, 1); assert.equal(proof.checkpoints[0].signature, receipt.signature);
      assert(!JSON.stringify(proof).includes('链上验收苔苔'), 'Public proof never includes the nickname');
      const file = path.join(root, `chain/evidence/journey-proof-local-${index + 1}.json`);
      await writeFile(file, JSON.stringify(proof, null, 2) + '\n'); proofs.push(file);
      evidence.transactions.push({ label: `journey_receipt_${index + 1}`, signature: receipt.signature, asset: receipt.asset_address,
        public_receipt_id: revealed.trip.public_receipt_id, result_hash: revealed.trip.result.result_hash, event_hash: receipt.journey.event_hash });
      await check(`Journey ${index + 1}: server-settled trip result is committed by a real finalized checkpoint v2 and exposed as a public proof`);
    }
    await closeService(); await openService();
    for (const file of proofs) {
      const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'tools/verify-journey-proof.ts'), '--proof', file, '--rpc', rpcUrl]);
      assert.match(stdout, /^VERIFIED \d+ checks$/m, stdout);
    }
    await check('After a restart, an independent verifier recomputes R and C for both receipts and matches each finalized transaction; the older receipt still verifies after the PetRecord moved on');
  } else {
  const checkpoint = await runPetTransaction(context, pet.id, 'checkpoint');
  const grown = await finalizedIntent(checkpoint.intent_id, session.token);
  const grownAccount = await client.verifyOfficialPet(registered.asset_address, player.publicKey, 'finalized');
  assert.equal(grownAccount.record.bond, 1); assert.equal(grownAccount.record.checkpoint.toString(), '1');
  assert.equal(grown.pet.chain.checkpoint, '1'); assert.equal(signatures, 2);
  evidence.transactions.push({ label: 'checkpoint_from_actual_care', signature: grown.signature, asset: grown.asset_address });
  await check('Actual HTTP care is co-signed, finalized on chain and reflected in the persisted pet checkpoint');
  await closeService(); await openService();
  const reloaded = (await api('/pets', 'GET', guest.token)).pets.find(item => item.id === pet.id);
  assert.equal(reloaded.chain.asset_address, registered.asset_address); assert.equal(reloaded.chain.checkpoint, '1'); assert.equal(reloaded.bond, 1);
  await check('Guest save retains the correct asset identity, growth and checkpoint after another service restart');
  }
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed'; evidence.error = `${error.name}: ${error.message}`; process.exitCode = 1; console.error(evidence.error);
} finally {
  await closeService(); evidence.completedAt = new Date().toISOString(); await save();
}
