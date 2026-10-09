/** Actual SBF + Metaplex Core integration tests. No mocks and no public RPC. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { deserializeAssetV1, deserializeCollectionV1, deserializePluginRegistryV1, PluginType } from '@metaplex-foundation/mpl-core';
import { MarketReader } from '../../server/src/market-reader.ts';

const { AnchorProvider, Program, Wallet, BN } = anchor;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = process.env.PIXELPETS_TEST_RPC ?? 'http://127.0.0.1:8899';
const endpoint = new URL(RPC);
assert.equal(endpoint.protocol, 'http:', 'Only local HTTP is accepted');
assert.equal(endpoint.hostname, '127.0.0.1', 'Only the explicit loopback validator is accepted');
assert(['8899', '8999'].includes(endpoint.port), 'Only the dedicated test-validator ports (8899 Windows helper, 8999 Linux helper) are accepted');
assert.equal(endpoint.pathname, '/');
assert(!endpoint.search && !endpoint.username && !endpoint.password);
const expectedGenesis = process.env.PIXELPETS_EXPECTED_GENESIS;
assert(expectedGenesis, 'Set PIXELPETS_EXPECTED_GENESIS to the freshly created local validator genesis');
const publicGeneses = new Set(['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY']);
assert(!publicGeneses.has(expectedGenesis), 'Public network genesis is forbidden');
assert(process.env.PIXELPETS_TEST_ADMIN, 'Explicit disposable test admin path is required; default wallets are never read');
const runtimeRoot = await realpath(path.join(ROOT, 'runtime'));
const adminFile = await realpath(path.resolve(process.env.PIXELPETS_TEST_ADMIN));
const adminRelative = path.relative(runtimeRoot, adminFile);
assert(adminRelative && !adminRelative.startsWith('..') && !path.isAbsolute(adminRelative), 'Test admin must live under this project runtime directory');
const connection = new Connection(RPC, 'confirmed');
assert.equal(await connection.getGenesisHash(), expectedGenesis, 'Validator genesis mismatch: refusing to sign');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(adminFile, 'utf8'))));
const idl = JSON.parse(await readFile(path.join(ROOT, 'chain/idl/pixel_pets.json'), 'utf8'));
const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' });
const program = new Program(idl, provider);
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const ZERO = PublicKey.default;
const bn = value => new BN(String(value));
const hash = value => [...createHash('sha256').update(value).digest()];
const le = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s), program.programId)[0];
const config = pda('config');
const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], LOADER)[0];
const petPda = asset => pda('pet', asset.toBuffer());
const claimPda = id => pda('claim', Buffer.from(id));
const offerPda = (asset, nonce) => pda('offer', asset.toBuffer(), le(nonce));
const evidenceDir = path.join(ROOT, 'chain/evidence');
await mkdir(evidenceDir, { recursive: true });
const evidence = { schema: 1, startedAt: new Date().toISOString(), rpc: RPC, genesis: expectedGenesis, program: program.programId.toBase58(), core: CORE.toBase58(), actualSbf: true, localFundsHaveNoValue: true, checks: [], transactions: [], snapshots: {} };
const evidenceFile = path.join(evidenceDir, 'local-validator-e2e.json');
const save = () => writeFile(evidenceFile, JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
const check = (name, details = {}) => { evidence.checks.push({ name, status: 'passed', ...details }); console.log(`PASS ${name}`); };
const pub = key => key.publicKey ?? key;
const common = { config, coreProgram: CORE, systemProgram: SystemProgram.programId };

async function now() { const slot = await connection.getSlot(); return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000); }
async function tx(label, instructions, signers = [], expectedFailure = null) {
  assert.equal(await connection.getGenesisHash(), expectedGenesis, 'Genesis changed: refusing transaction');
  const block = await connection.getLatestBlockhash();
  const transaction = new Transaction({ ...block, feePayer: admin.publicKey });
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 700_000 }), ...[instructions].flat());
  const unique = [...new Map([admin, ...signers].map(k => [k.publicKey.toBase58(), k])).values()];
  transaction.sign(...unique);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
  const confirmation = await connection.confirmTransaction({ ...block, signature }, 'confirmed');
  let result;
  for (let i = 0; i < 30; i++) { result = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); if (result) break; await new Promise(r => setTimeout(r, 150)); }
  assert(result?.meta, `Transaction metadata unavailable: ${signature}`);
  const entry = { label, signature, slot: result.slot, error: result.meta.err, feeLamports: result.meta.fee, computeUnitsConsumed: result.meta.computeUnitsConsumed, logs: result.meta.logMessages, innerInstructions: result.meta.innerInstructions };
  evidence.transactions.push(entry);
  await save();
  if (expectedFailure) {
    assert(confirmation.value.err && result.meta.err, `${label}: expected actual onchain failure`);
    if (expectedFailure instanceof RegExp) assert.match((result.meta.logMessages ?? []).join('\n'), expectedFailure, `${label}: wrong error`);
  } else assert.equal(result.meta.err, null, `${label}: ${JSON.stringify(result.meta.err)}\n${result.meta.logMessages?.join('\n')}`);
  return entry;
}
async function info(address, commitment = 'confirmed') { return connection.getAccountInfo(pub(address), commitment); }
async function balance(address) { return connection.getBalance(pub(address), 'confirmed'); }
function raw(address, account) { return { publicKey: pub(address).toBase58(), data: account.data, owner: account.owner.toBase58(), executable: account.executable, lamports: { basisPoints: BigInt(account.lamports), identifier: 'SOL', decimals: 9 }, rentEpoch: BigInt(account.rentEpoch ?? 0) }; }
async function assetState(address, expectedOwner, commitment = 'confirmed') {
  const account = await info(address, commitment); assert(account, 'Core asset must exist'); assert(account.owner.equals(CORE));
  const asset = deserializeAssetV1(raw(address, account));
  if (expectedOwner) assert.equal(asset.owner, pub(expectedOwner).toBase58());
  assert.equal(asset.updateAuthority.type, 'Collection'); assert.equal(asset.updateAuthority.address, collection.publicKey.toBase58());
  assert.equal(asset.immutableMetadata?.authority.type, 'None'); assert.equal(asset.addBlocker?.authority.type, 'None');
  assert(asset.pluginHeader, 'Actual Core plugin header must exist');
  const registry = deserializePluginRegistryV1({ ...raw(address, account), data: account.data.subarray(Number(asset.pluginHeader.pluginRegistryOffset)) });
  assert.equal(registry.registry.length, 2); assert.equal(registry.externalRegistry.length, 0);
  assert.deepEqual(registry.registry.map(x => x.pluginType).sort((a,b) => a-b), [PluginType.AddBlocker, PluginType.ImmutableMetadata]);
  return { address: pub(address).toBase58(), accountOwner: account.owner.toBase58(), owner: asset.owner, name: asset.name, uri: asset.uri, collection: asset.updateAuthority.address, plugins: registry.registry, externalPluginCount: registry.externalRegistry.length, lamports: account.lamports, bytes: account.data.length };
}
async function record(asset) { return program.account.petRecord.fetch(petPda(pub(asset))); }
async function fingerprint(address) { const account = await info(address); return account ? { owner: account.owner.toBase58(), lamports: account.lamports, hash: createHash('sha256').update(account.data).digest('hex') } : null; }
const collection = Keypair.generate();
const issuer = Keypair.generate();
const walletA = Keypair.generate();
const walletB = Keypair.generate();
const outsider = Keypair.generate();
const feeRecipient = Keypair.generate();
const nextFeeRecipient = Keypair.generate();
const poorBuyer = Keypair.generate();
const edition = pda('edition', le(1));
const capEdition = pda('edition', le(2));
const assetA = Keypair.generate(); const assetB = Keypair.generate(); const capAsset = Keypair.generate();
evidence.wallets = Object.fromEntries(Object.entries({ admin, issuer, walletA, walletB, outsider, feeRecipient, nextFeeRecipient, poorBuyer, collection }).map(([name, k]) => [name, k.publicKey.toBase58()]));

async function initializeIx(signer, collectionKey) { return program.methods.initialize({ name: 'PixelPets Local E2E', uri: 'ipfs://local-e2e-collection', issuer: issuer.publicKey, feeRecipient: feeRecipient.publicKey, feeBps: 250 }).accountsStrict({ ...common, admin: signer.publicKey, collection: collectionKey.publicKey, program: program.programId, programData }).instruction(); }
async function configureIx(paused, fee = feeRecipient.publicKey, bps = 250, signer = admin) { return program.methods.configure(issuer.publicKey, fee, bps, paused).accountsStrict({ admin: signer.publicKey, config }).instruction(); }
async function createEditionIx(id, cap) { return program.methods.createEdition({ editionId: bn(id), maxSupply: cap, originHash: hash(`origin-${id}`), rulesVersion: 1, species: id === 1 ? 0 : 2, name: `E2E Pet ${id}`, uri: `ipfs://local-e2e-pet-${id}` }).accountsStrict({ admin: admin.publicKey, config, edition: pda('edition', le(id)), systemProgram: SystemProgram.programId }).instruction(); }
async function claimIx(asset, recipient, targetEdition, claimId, attestor = issuer, expiry) { return program.methods.claimPet(claimId, bn(expiry ?? ((await now()) + 600))).accountsStrict({ ...common, payer: recipient.publicKey, recipient: recipient.publicKey, issuer: attestor.publicKey, edition: targetEdition, collection: collection.publicKey, asset: asset.publicKey, petRecord: petPda(asset.publicKey), receipt: claimPda(claimId) }).instruction(); }
async function checkpointIx(asset, owner, seq, form, bond, label, attestor = issuer) { return program.methods.checkpoint({ expectedCheckpoint: bn(seq), form, bond, eventHash: hash(label) }).accountsStrict({ config, owner: owner.publicKey, issuer: attestor.publicKey, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)) }).instruction(); }
async function saleIx(asset, maker, price, nonce, expiry) { return program.methods.createSale(bn(nonce), bn(expiry ?? ((await now()) + 3600)), bn(price)).accountsStrict({ ...common, maker: maker.publicKey, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)), offer: offerPda(pub(asset), nonce) }).instruction(); }
async function swapIx(asset, desired, maker, nonce) { return program.methods.createSwap(bn(nonce), bn((await now()) + 3600)).accountsStrict({ ...common, maker: maker.publicKey, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)), desiredAsset: pub(desired), desiredRecord: petPda(pub(desired)), offer: offerPda(pub(asset), nonce) }).instruction(); }
async function acceptIx(asset, desired, taker, maker, nonce) { return program.methods.acceptSwap().accountsStrict({ ...common, taker: taker.publicKey, maker: maker.publicKey, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)), desiredAsset: pub(desired), desiredRecord: petPda(pub(desired)), offer: offerPda(pub(asset), nonce) }).instruction(); }
async function buyIx(asset, buyer, maker, nonce, price, fee = feeRecipient.publicKey) { return program.methods.buy(bn(price)).accountsStrict({ ...common, buyer: buyer.publicKey, maker: maker.publicKey, feeRecipient: fee, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)), offer: offerPda(pub(asset), nonce) }).instruction(); }
async function cancelIx(asset, caller, maker, nonce) { return program.methods.cancelOffer().accountsStrict({ ...common, caller: caller.publicKey, maker: maker.publicKey, collection: collection.publicKey, asset: pub(asset), petRecord: petPda(pub(asset)), offer: offerPda(pub(asset), nonce) }).instruction(); }

try {
  assert.equal(await info(config), null, 'This test requires a fresh validator without an initialized Config');
  const programAccount = await info(program.programId); const coreAccount = await info(CORE);
  assert(programAccount?.executable && programAccount.owner.equals(LOADER), 'PixelPets must be an actual upgradeable SBF deployment');
  assert(coreAccount?.executable, 'Actual Core SBF fixture must be loaded');
  const data = await info(programData); assert(data, 'Upgradeable ProgramData must exist');
  assert.equal(data.data.readUInt32LE(0), 3); assert.equal(data.data[12], 1); assert(new PublicKey(data.data.subarray(13, 45)).equals(admin.publicKey), 'Disposable admin must be the upgrade authority');
  evidence.binary = { pixelPetsSha256: createHash('sha256').update(await readFile(path.join(ROOT, 'chain/target/deploy/pixel_pets.so'))).digest('hex'), coreFixtureSha256: createHash('sha256').update(await readFile(path.join(ROOT, 'runtime/chain-fixtures/mpl_core.so'))).digest('hex'), programAccountOwner: programAccount.owner.toBase58(), programData: programData.toBase58() };
  await tx('fund_disposable_wallets', [walletA, walletB, outsider].map(k => SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: k.publicKey, lamports: 10 * LAMPORTS_PER_SOL })));
  const attackerCollection = Keypair.generate();
  await tx('initialize_front_run_rejected', await initializeIx(outsider, attackerCollection), [outsider, attackerCollection], /Unauthorized/);
  assert.equal(await info(config), null); assert.equal(await info(attackerCollection), null);
  check('Initialization requires the deployed program upgrade authority; failed initialization leaves no Config or collection');
  await tx('initialize_authorized', await initializeIx(admin, collection), [collection]);
  const cfg = await program.account.config.fetch(config); assert(cfg.admin.equals(admin.publicKey)); assert(cfg.collection.equals(collection.publicKey));
  const ci = await info(collection); assert(ci.owner.equals(CORE)); const decodedCollection = deserializeCollectionV1(raw(collection, ci)); assert.equal(decodedCollection.updateAuthority, config.toBase58());
  check('Collection created by real Core CPI and update authority is the Config PDA');
  await tx('create_editions', [await createEditionIx(1, 2), await createEditionIx(2, 1)]);
  await tx('edition_cap_cannot_be_recreated', await createEditionIx(1, 999), [], /already in use/);
  assert.equal((await program.account.edition.fetch(edition)).maxSupply, 2);
  check('Edition cap is fixed at creation');
  const badAsset = Keypair.generate(); const badClaim = hash('unauthorized-claim');
  await tx('unauthorized_issuer_rejected', await claimIx(badAsset, walletA, edition, badClaim, outsider), [badAsset, walletA, outsider], /ConstraintHasOne/);
  assert.equal(await info(badAsset), null); assert.equal(await info(claimPda(badClaim)), null);
  const claimA = hash('claim-A'); const claimB = hash('claim-B'); const claimCap = hash('claim-cap');
  await tx('claim_pet_wallet_A', await claimIx(assetA, walletA, edition, claimA), [assetA, walletA, issuer]);
  await tx('claim_pet_wallet_B', await claimIx(assetB, walletB, edition, claimB), [assetB, walletB, issuer]);
  await tx('claim_one_of_one_edition', await claimIx(capAsset, walletA, capEdition, claimCap), [capAsset, walletA, issuer]);
  evidence.snapshots.initialAssets = [await assetState(assetA, walletA), await assetState(assetB, walletB), await assetState(capAsset, walletA)];
  const receiptA = await program.account.claimReceipt.fetch(claimPda(claimA)); assert(receiptA.asset.equals(assetA.publicKey)); assert(receiptA.recipient.equals(walletA.publicKey));
  assert.equal((await record(assetA)).serial, 1); assert.equal((await record(assetB)).serial, 2);
  check('Issuer and recipient signed claims mint actual Core assets with only immutable ImmutableMetadata and AddBlocker plugins');
  const overflowAsset = Keypair.generate(); const overflowClaim = hash('claim-over-cap');
  await tx('edition_cap_rejected', await claimIx(overflowAsset, walletB, capEdition, overflowClaim), [overflowAsset, walletB, issuer], /SoldOut/);
  assert.equal(await info(overflowAsset), null); assert.equal(await info(petPda(overflowAsset.publicKey)), null); assert.equal(await info(claimPda(overflowClaim)), null); assert.equal((await program.account.edition.fetch(capEdition)).issued, 1);
  check('Sold-out claim rolls back asset, record and receipt creation, preserving issued count');
  const replayAsset = Keypair.generate();
  await tx('claim_replay_rejected_across_wallet_and_edition', await claimIx(replayAsset, walletB, capEdition, claimA), [replayAsset, walletB, issuer], /already in use/);
  assert.equal(await info(replayAsset), null); check('Claim receipt prevents replay across wallets and editions');
  const beforeCheckpoint = await fingerprint(petPda(assetA.publicKey));
  await tx('checkpoint_wrong_owner_rejected', await checkpointIx(assetA, walletB, 0, 1, 6, 'bad-owner'), [walletB, issuer], /WrongOwner/);
  assert.deepEqual(await fingerprint(petPda(assetA.publicKey)), beforeCheckpoint);
  await tx('checkpoint_growth', await checkpointIx(assetA, walletA, 0, 1, 6, 'sun-growth'), [walletA, issuer]);
  let aRecord = await record(assetA); assert.equal(aRecord.form, 1); assert.equal(aRecord.bond, 6); assert.equal(aRecord.checkpoint.toString(), '1');
  await tx('checkpoint_stale_sequence_rejected', await checkpointIx(assetA, walletA, 0, 1, 7, 'stale-growth'), [walletA, issuer], /CheckpointChanged/);
  await tx('checkpoint_illegal_branch_rejected', await checkpointIx(assetA, walletA, 1, 2, 7, 'switch-growth'), [walletA, issuer], /InvalidTraits/);
  check('Checkpoint requires current owner and enforces sequence and irreversible growth branch');
  const swapOffer = offerPda(assetA.publicKey, 0);
  await tx('create_swap_A_for_B', await swapIx(assetA, assetB, walletA, 0), [walletA]);
  await assetState(assetA, swapOffer); assert((await record(assetA)).activeOffer.equals(swapOffer));
  check('Swap listing transfers actual Core ownership from maker to Offer PDA escrow');
  // Run both real Core swap CPIs, then fail a separate instruction in the same transaction.
  // This explicitly proves transaction-wide atomic rollback, not a fabricated second-CPI failure.
  const swapBefore = await Promise.all([fingerprint(assetA), fingerprint(assetB), fingerprint(swapOffer), fingerprint(petPda(assetA.publicKey)), balance(walletA), balance(walletB)]);
  const revertedSwap = await tx('swap_then_later_instruction_failure_rolls_back', [await acceptIx(assetA, assetB, walletB, walletA, 0), await configureIx(false, feeRecipient.publicKey, 250, outsider)], [walletB, outsider], /ConstraintHasOne/);
  assert.equal(revertedSwap.logs.filter(l => l === `Program ${CORE} success`).length, 2, 'Both genuine Core transfer CPIs must complete before deliberate later failure');
  assert.deepEqual(await Promise.all([fingerprint(assetA), fingerprint(assetB), fingerprint(swapOffer), fingerprint(petPda(assetA.publicKey)), balance(walletA), balance(walletB)]), swapBefore);
  check('Two completed Core swap CPIs roll back together after a later instruction fails', { signature: revertedSwap.signature, scope: 'transaction atomicity after both CPIs; does not claim a forced second-CPI failure' });
  await tx('accept_swap_two_wallets', await acceptIx(assetA, assetB, walletB, walletA, 0), [walletB]);
  await assetState(assetA, walletB); await assetState(assetB, walletA); assert.equal(await info(swapOffer), null); assert((await record(assetA)).activeOffer.equals(ZERO));
  check('Two-wallet swap changes both actual owners and closes escrow; maker signature not needed at acceptance');
  await tx('create_swap_with_checkpoint_snapshot', await swapIx(capAsset, assetA, walletA, 0), [walletA]);
  await tx('advance_desired_checkpoint', await checkpointIx(assetA, walletB, 1, 1, 7, 'desired-change'), [walletB, issuer]);
  const staleSwapOffer = offerPda(capAsset.publicKey, 0);
  await tx('changed_desired_checkpoint_rejects_swap', await acceptIx(capAsset, assetA, walletB, walletA, 0), [walletB], /CheckpointChanged/);
  await assetState(capAsset, staleSwapOffer); await assetState(assetA, walletB);
  await tx('cancel_stale_swap', await cancelIx(capAsset, walletA, walletA, 0), [walletA]);
  await assetState(capAsset, walletA);
  check('Changed desired-pet checkpoint invalidates swap quote and maker can recover escrow');
  // Buyer uses exact base units; admin pays transaction fee separately for unambiguous balances.
  const price = 100_000_003; const expectedFee = Math.floor(price * 250 / 10_000); const sellerNet = price - expectedFee;
  const saleOffer = offerPda(assetA.publicKey, 1);
  await tx('create_sale', await saleIx(assetA, walletB, price, 1), [walletB]);
  await assetState(assetA, saleOffer);
  const offerRent = (await info(saleOffer)).lamports;
  const sale = await program.account.offer.fetch(saleOffer); assert.equal(sale.priceLamports.toString(), String(price)); assert.equal(sale.feeBps, 250);
  const changedConfig = await tx('change_config_after_listing', await configureIx(false, nextFeeRecipient.publicKey, 500));
  const marketDeadline = Date.now() + 45000;
  while (Date.now() < marketDeadline) {
    if ((await connection.getSignatureStatuses([changedConfig.signature])).value[0]?.confirmationStatus === 'finalized') break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal((await connection.getSignatureStatuses([changedConfig.signature])).value[0]?.confirmationStatus, 'finalized');
  const market = new MarketReader({ rpc: connection, network: 'localnet', expectedGenesisHash: expectedGenesis,
    programId: program.programId.toBase58(), collectionAddress: collection.publicKey.toBase58() });
  const quotes = await market.list();
  const quote = quotes.offers.find(item => item.offer_address === saleOffer.toBase58());
  assert(quote, `Actual offer missing: ${JSON.stringify(quotes.rejected)}`);
  assert.equal(quote.price_lamports, String(price)); assert.equal(quote.fee_bps, 250);
  assert.equal(quote.fee_recipient, feeRecipient.publicKey.toBase58()); assert.equal(quote.pet.owner_address, saleOffer.toBase58());
  assert.equal(quote.can_settle, true); assert.equal(quote.pet.asset_address, assetA.publicKey.toBase58());
  const detail = await market.detail(assetA.publicKey.toBase58(), '1'); assert.equal(detail.offer.price_lamports, String(price));
  evidence.snapshots.market = quotes;
  check('Market reader verifies actual finalized escrow, chain Clock, pet traits and original fee snapshot');
  await tx('buy_changed_price_rejected', await buyIx(assetA, walletA, walletB, 1, price + 1), [walletA], /InvalidPrice/);
  await tx('buy_wrong_fee_recipient_rejected', await buyIx(assetA, walletA, walletB, 1, price, nextFeeRecipient.publicKey), [walletA], /ConstraintAddress/);
  // The first System transfer succeeds, then fee payment fails for insufficient funds.
  const poorFunding = sellerNet + Math.floor(expectedFee / 2);
  await tx('fund_underfunded_buyer', SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: poorBuyer.publicKey, lamports: poorFunding }));
  const failedBuyBefore = await Promise.all([balance(walletB), balance(feeRecipient), balance(poorBuyer), fingerprint(assetA), fingerprint(saleOffer), fingerprint(petPda(assetA.publicKey))]);
  const revertedBuy = await tx('buy_second_payment_failure_rolls_back_first_payment', await buyIx(assetA, poorBuyer, walletB, 1, price), [poorBuyer], /insufficient lamports/);
  assert(revertedBuy.logs.includes(`Program ${SystemProgram.programId} success`), 'Seller transfer must succeed before fee transfer failure');
  assert.deepEqual(await Promise.all([balance(walletB), balance(feeRecipient), balance(poorBuyer), fingerprint(assetA), fingerprint(saleOffer), fingerprint(petPda(assetA.publicKey))]), failedBuyBefore);
  check('Insufficient fee funds roll back prior seller payment and preserve asset escrow and offer', { signature: revertedBuy.signature });
  const buyBefore = { seller: await balance(walletB), buyer: await balance(walletA), fee: await balance(feeRecipient), newFee: await balance(nextFeeRecipient) };
  await tx('buy_sale', await buyIx(assetA, walletA, walletB, 1, price), [walletA]);
  const buyAfter = { seller: await balance(walletB), buyer: await balance(walletA), fee: await balance(feeRecipient), newFee: await balance(nextFeeRecipient) };
  assert.equal(buyAfter.seller - buyBefore.seller, sellerNet + offerRent); assert.equal(buyBefore.buyer - buyAfter.buyer, price); assert.equal(buyAfter.fee - buyBefore.fee, expectedFee); assert.equal(buyAfter.newFee, buyBefore.newFee);
  await assetState(assetA, walletA); assert.equal(await info(saleOffer), null); assert((await record(assetA)).activeOffer.equals(ZERO));
  evidence.snapshots.saleBalances = { price, feeBpsSnapshot: 250, expectedFee, sellerNet, offerRent, feePayer: admin.publicKey.toBase58(), before: buyBefore, after: buyAfter };
  check('Sale settles atomically with floor-rounded fee deducted from gross; listing retains its fee snapshot', evidence.snapshots.saleBalances);
  await tx('create_sale_to_cancel', await saleIx(assetB, walletA, price, 0), [walletA]);
  const cancelOffer = offerPda(assetB.publicKey, 0); await assetState(assetB, cancelOffer);
  await tx('unauthorized_early_cancel_rejected', await cancelIx(assetB, outsider, walletA, 0), [outsider], /Unauthorized/);
  await tx('pause_protocol', await configureIx(true, nextFeeRecipient.publicKey, 500));
  await tx('paused_buy_rejected', await buyIx(assetB, walletB, walletA, 0, price, nextFeeRecipient.publicKey), [walletB], /Paused/);
  const cancelRent = (await info(cancelOffer)).lamports; const cancelBefore = { maker: await balance(walletA), fee: await balance(nextFeeRecipient) };
  await tx('maker_cancel_while_paused', await cancelIx(assetB, walletA, walletA, 0), [walletA]);
  await assetState(assetB, walletA); assert.equal(await info(cancelOffer), null); assert.equal(await balance(walletA), cancelBefore.maker + cancelRent); assert.equal(await balance(nextFeeRecipient), cancelBefore.fee);
  check('Maker can recover actual escrowed asset while paused; no platform cancellation fee');
  await tx('resume_protocol', await configureIx(false));
  await tx('stale_offer_nonce_rejected', await saleIx(assetB, walletA, price, 0), [walletA], /InvalidNonce/);
  assert.equal(await info(cancelOffer), null); await assetState(assetB, walletA);
  check('Closed offer addresses cannot be replayed because nonce increases monotonically');
  const lastSignature = evidence.transactions.at(-1).signature;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { const status = (await connection.getSignatureStatuses([lastSignature])).value[0]; if (status?.confirmationStatus === 'finalized') break; await new Promise(r => setTimeout(r, 500)); }
  const finalStatus = (await connection.getSignatureStatuses([lastSignature])).value[0]; assert.equal(finalStatus?.confirmationStatus, 'finalized', 'Final evidence must be rooted');
  evidence.snapshots.finalAssets = [await assetState(assetA, walletA, 'finalized'), await assetState(assetB, walletA, 'finalized'), await assetState(capAsset, walletA, 'finalized')];
  const finalReceiptInfo = await info(claimPda(claimA), 'finalized'); assert(finalReceiptInfo?.owner.equals(program.programId));
  evidence.finalizedAtSlot = await connection.getSlot('finalized');
  evidence.result = 'passed'; evidence.completedAt = new Date().toISOString(); await save();
  console.log(`SUCCESS ${evidence.checks.length} checks, ${evidence.transactions.length} real local transactions. Evidence: ${evidenceFile}`);
} catch (error) {
  evidence.result = 'failed'; evidence.error = error.stack ?? String(error); evidence.completedAt = new Date().toISOString(); await save(); console.error(error); process.exitCode = 1;
}
