import test from 'node:test';
import assert from 'node:assert/strict';
import { BN, BorshAccountsCoder } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { AccountInfo, Connection } from '@solana/web3.js';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { CORE_PROGRAM_ID, PROGRAM_ID, UPGRADEABLE_LOADER_ID, PIXEL_PETS_IDL, PixelPetsInstructions, PixelPetsPdas } from '../../chain-client/src/index.ts';
import { canonicalClaimId, runPetTransaction } from '../src/transactions.ts';
import type { DeploymentConfig, FlowContext, PetIntent, TransactionReview } from '../src/transactions.ts';

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`), text = '';
  while (value) { text = alphabet[Number(value % 58n)] + text; value /= 58n; }
  for (const byte of bytes) { if (byte) break; text = '1' + text; }
  return text;
}

/** These are real serialized accounts and signatures; RPC responses are controlled, not a running chain. */
async function fixture() {
  const owner = Keypair.generate(), issuer = Keypair.generate(), asset = Keypair.generate();
  const collection = Keypair.generate().publicKey, pdas = new PixelPetsPdas(), coder = new BorshAccountsCoder(PIXEL_PETS_IDL);
  const config: DeploymentConfig = { enabled: true, network: 'solana:localnet', rpc_url: 'http://127.0.0.1:8899',
    genesis_hash: Keypair.generate().publicKey.toBase58(), program_id: PROGRAM_ID.toBase58(), collection_address: collection.toBase58(), issuer_address: issuer.publicKey.toBase58() };
  const pet = { id: 'pet-flow-test', nickname: '苔苔', species_id: 'moss', form: 'seed', bond: 2, chain: { status: 'unregistered' } };
  const blockhash = Keypair.generate().publicKey.toBase58();
  const inputs = { payer: owner.publicKey.toBase58(), recipient: owner.publicKey.toBase58(), issuer: issuer.publicKey.toBase58(),
    collection: collection.toBase58(), asset: asset.publicKey.toBase58(), editionId: '1',
    claimId: await canonicalClaimId(config.network, config.genesis_hash!, config.program_id!, pet.id), expiresAt: String(Math.floor(Date.now() / 1000) + 300) };
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(new PixelPetsInstructions().claim(inputs));
  tx.partialSign(issuer, asset);
  const intent: PetIntent = { intent_id: 'intent-flow-test', kind: 'claim', state: 'prepared', pet_id: pet.id, network: 'localnet', program_id: PROGRAM_ID.toBase58(),
    collection_address: collection.toBase58(), asset_address: asset.publicKey.toBase58(), expires_at: new Date(Date.now() + 300000).toISOString(),
    transaction_base64: tx.serialize({ requireAllSignatures: false }).toString('base64'), expected_message_base64: tx.serializeMessage().toString('base64'),
    blockhash, last_valid_block_height: 500, instruction_inputs: inputs };
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const account = (data: Uint8Array, owner = PROGRAM_ID, executable = false): AccountInfo<Buffer> => ({ data: Buffer.from(data), owner, executable, lamports: 1, rentEpoch: 0 });
  const put = async (name: string, address: PublicKey, data: object) => accounts.set(address.toBase58(), account(await coder.encode(name, data)));
  const program = Buffer.alloc(36); program.writeUInt32LE(2); pdas.programData()[0].toBuffer().copy(program, 4);
  const data = Buffer.alloc(45); data.writeUInt32LE(3); data[12] = 1; owner.publicKey.toBuffer().copy(data, 13);
  accounts.set(PROGRAM_ID.toBase58(), account(program, UPGRADEABLE_LOADER_ID, true));
  accounts.set(pdas.programData()[0].toBase58(), account(data, UPGRADEABLE_LOADER_ID));
  accounts.set(CORE_PROGRAM_ID.toBase58(), account(Buffer.alloc(0), UPGRADEABLE_LOADER_ID, true));
  await put('Config', pdas.config()[0], { admin: owner.publicKey, issuer: issuer.publicKey, collection,
    fee_recipient: owner.publicKey, fee_bps: 250, paused: false, bump: pdas.config()[1] });
  await put('Edition', pdas.edition('1')[0], { edition_id: new BN(1), max_supply: 100, issued: 0, origin_hash: Array(32).fill(1),
    rules_version: 1, species: 0, name: 'Pet', uri: 'ipfs://bafkreigh2akiscaildc3b5rqfgzozc2fkausk6fkgteh4s6s5uswy4my6a', bump: pdas.edition('1')[1] });
  const state = { genesis: config.genesis_hash!, height: 400, signCount: 0, broadcastCount: 0, reviewCount: 0, confirmCount: 0,
    broadcastError: false, storageError: false, current: true, cancel: false, mutateWallet: false,
    simulationError: null as unknown, postBalance: 997000000 as number | undefined, fee: 15000 as number | null,
    receipt: null as any, review: null as TransactionReview | null, events: [] as string[], wires: [] as Buffer[] };
  const rpc = {
    async getGenesisHash() { return state.genesis; },
    async getAccountInfo(address: PublicKey) { return accounts.get(address.toBase58()) ?? null; },
    async getBalance() { return 1000000000; },
    async getBlockHeight() { return state.height; },
    async getFeeForMessage() { return { context: { slot: 1 }, value: state.fee }; },
    async simulateTransaction() { return { context: { slot: 1 }, value: { err: state.simulationError, accounts: [{ lamports: state.postBalance }] } }; },
    async sendRawTransaction(bytes: Buffer) { state.broadcastCount++; state.events.push('broadcast'); state.wires.push(Buffer.from(bytes));
      if (state.broadcastError) throw new Error('Connection lost after possible submission');
      return base58(Transaction.from(bytes).signature!); },
  } as unknown as Connection;
  const accountInfo: WalletAccount = { address: owner.publicKey.toBase58(), publicKey: owner.publicKey.toBytes(), chains: ['solana:localnet'], features: ['solana:signTransaction'] };
  const wallet = { version: '1.0.0', name: 'Test signer', icon: 'data:image/svg+xml;base64,', chains: ['solana:localnet'], accounts: [accountInfo],
    features: { 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy'], async signTransaction(input: any) {
      state.signCount++; state.events.push('sign'); const signed = Transaction.from(input.transaction);
      if (state.mutateWallet) { signed.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 100 })); signed.partialSign(issuer, asset); }
      signed.partialSign(owner); return [{ signedTransaction: signed.serialize() }];
    } } } } as unknown as Wallet;
  const context: FlowContext = { token: 'wallet-session', config, wallet, account: accountInfo, connection: rpc,
    assertCurrent() { if (!state.current) throw new Error('ACCOUNT_CHANGED'); },
    async review(summary) { state.reviewCount++; state.review = summary; state.events.push('review'); return !state.cancel; },
    async api(path, method, token, body) {
      assert.equal(token, 'wallet-session');
      if (path === '/pets') return { pets: [pet] };
      if (path.endsWith('/claim-intent')) return intent;
      if (path.endsWith('/confirm')) {
        state.confirmCount++; state.events.push('persist'); if (state.storageError) throw new Error('Storage unavailable');
        state.receipt = body;
        return { ...intent, signature: (body as any).signature, signed_transaction_base64: (body as any).transaction_base64, state: state.broadcastCount ? 'confirmed' : 'pending' };
      }
      if (path === '/chain/intents/intent-flow-test' && method === 'GET') return { ...intent, state: state.broadcastCount ? 'confirmed' : 'pending' };
      throw new Error(`Unexpected API ${method} ${path}`);
    },
  };
  return { state, context, intent, owner, tx, pet, accounts };
}

test('full claim flow reviews total debit, preserves co-signatures and persists exact signed bytes before broadcast', async () => {
  const f = await fixture(); const result = await runPetTransaction(f.context, f.pet.id, 'claim');
  assert.equal(result.state, 'confirmed'); assert.equal(f.state.signCount, 1); assert.equal(f.state.broadcastCount, 1);
  assert.equal(f.state.review?.estimatedDebitSol, '0.003'); assert.equal(f.state.review?.networkFeeSol, '0.000015');
  assert.deepEqual(f.state.events, ['review', 'sign', 'persist', 'broadcast', 'persist']);
  assert.equal(f.state.receipt.transaction_base64, f.state.wires[0].toString('base64'));
  assert.equal(Transaction.from(f.state.wires[0]).verifySignatures(), true);
});

test('cancelled review, missing fee, simulation error and changed wallet never sign or broadcast', async () => {
  for (const issue of ['cancel', 'fee', 'simulation', 'account'] as const) {
    const f = await fixture();
    if (issue === 'cancel') f.state.cancel = true;
    if (issue === 'fee') f.state.fee = null;
    if (issue === 'simulation') f.state.simulationError = { InstructionError: [0, 'Custom'] };
    if (issue === 'account') f.state.current = false;
    await assert.rejects(runPetTransaction(f.context, f.pet.id, 'claim'));
    assert.equal(f.state.signCount, 0); assert.equal(f.state.broadcastCount, 0);
  }
});

test('wallet message replacement and unavailable recovery storage stop before broadcast', async () => {
  for (const issue of ['mutateWallet', 'storageError'] as const) {
    const f = await fixture(); f.state[issue] = true;
    await assert.rejects(runPetTransaction(f.context, f.pet.id, 'claim'));
    assert.equal(f.state.signCount, 1); assert.equal(f.state.broadcastCount, 0);
  }
});

test('uncertain submission returns pending and resumes the identical transaction without another signature', async () => {
  const f = await fixture(); f.state.broadcastError = true;
  const pending = await runPetTransaction(f.context, f.pet.id, 'claim');
  assert.equal(pending.state, 'pending'); assert.equal(f.state.signCount, 1);
  Object.assign(f.intent, { state: 'pending', signature: f.state.receipt.signature, signed_transaction_base64: f.state.receipt.transaction_base64 });
  f.state.broadcastError = false; f.state.broadcastCount = 0;
  const recovered = await runPetTransaction(f.context, f.pet.id, 'claim');
  assert.equal(recovered.state, 'confirmed'); assert.equal(f.state.signCount, 1); assert.equal(f.state.reviewCount, 1);
  assert.deepEqual(f.state.wires[0], f.state.wires[1]);
});

test('expired pending transaction and different genesis cannot trigger a new signature or a rebroadcast', async () => {
  for (const issue of ['expired', 'genesis'] as const) {
    const f = await fixture(); f.tx.partialSign(f.owner);
    Object.assign(f.intent, { state: 'pending', signature: base58(f.tx.signature!), signed_transaction_base64: f.tx.serialize().toString('base64') });
    if (issue === 'expired') { f.state.height = 501; assert.equal((await runPetTransaction(f.context, f.pet.id, 'claim')).state, 'pending'); }
    else { f.state.genesis = Keypair.generate().publicKey.toBase58(); await assert.rejects(runPetTransaction(f.context, f.pet.id, 'claim'), { code: 'NETWORK_MISMATCH' }); }
    assert.equal(f.state.signCount, 0); assert.equal(f.state.broadcastCount, 0);
  }
});
