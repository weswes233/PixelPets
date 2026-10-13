import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { PixelPetsClient, PixelPetsInstructions, assertCoSignedTransaction, lamportsToSol } from '../../chain-client/src/index.ts';
import type { ClaimInput, CheckpointInput, SupportedNetwork } from '../../chain-client/src/index.ts';

export class TransactionFlowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function check(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new TransactionFlowError(code, message);
}
export interface DeploymentConfig {
  enabled: boolean; market_enabled?: boolean; network: string; program_id?: string | null; collection_address?: string | null;
  issuer_address?: string | null; rpc_url?: string; genesis_hash?: string;
}
export type IntentKind = 'claim' | 'checkpoint';
export type TransactionReview = {
  title: string; petName: string; network: string; address: string; asset: string;
  estimatedDebitSol: string; networkFeeSol: string; message: string;
};
export interface PetIntent {
  intent_id: string; kind: IntentKind; state: string; pet_id: string; network: string;
  program_id: string; collection_address: string; asset_address: string; expires_at: string;
  transaction_base64: string; expected_message_base64: string; blockhash: string;
  last_valid_block_height: number; instruction_inputs: ClaimInput | CheckpointInput;
  signature?: string; signed_transaction_base64?: string; pet?: any;
  journey?: { schema: string; trip_id: string; public_receipt_id: string; result_hash: string; canonical_checkpoint: string; event_hash: string } | null;
}
async function sha256Hex(text: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
}
/** Journey receipt (checkpoint v2): the wallet side recomputes the commitment it is about to sign. */
export async function validateJourneyCommitment(intent: PetIntent, config: DeploymentConfig, tripId: string, resultHash?: string): Promise<void> {
  const journey = intent.journey; const input = intent.instruction_inputs as CheckpointInput;
  check(journey && journey.schema === 'pixel-pets:checkpoint:v2' && journey.trip_id === tripId, 'JOURNEY_MISMATCH', 'This receipt does not belong to the selected trip.');
  check(await sha256Hex(journey.canonical_checkpoint) === journey.event_hash && String(input.eventHash) === journey.event_hash,
    'JOURNEY_MISMATCH', 'The journey commitment does not match the transaction.');
  const c = JSON.parse(journey.canonical_checkpoint) as unknown[];
  check(Array.isArray(c) && c.length === 14 && c[0] === 'pixel-pets:checkpoint:v2' && c[1] === config.genesis_hash && c[2] === config.program_id
    && c[3] === intent.asset_address && c[4] === intent.intent_id && c[5] === String(input.expectedCheckpoint)
    && c[7] === input.form && c[8] === input.bond && c[12] === journey.public_receipt_id && c[13] === journey.result_hash
    && (!resultHash || resultHash === journey.result_hash), 'JOURNEY_MISMATCH', 'The journey commitment fields do not match this pet and trip.');
}
export type FlowApi = (path: string, method: string, token?: string, body?: unknown) => Promise<any>;
export function rawNetwork(value: string): SupportedNetwork {
  const network = value.replace(/^solana:/, '').replace(/^mainnet$/, 'mainnet-beta');
  check(['devnet', 'testnet', 'localnet', 'mainnet-beta'].includes(network), 'NETWORK_UNSUPPORTED', '这个网络暂不支持。');
  return network as SupportedNetwork;
}
export async function canonicalClaimId(network: string, genesisHash: string, programId: string, petId: string): Promise<string> {
  const value = JSON.stringify(['pixel-pets:claim:v1', JSON.stringify([rawNetwork(network), genesisHash, programId]), petId]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(hash).toString('hex');
}

/** Rebuild the one permitted instruction locally; an expected-message string from the API is not trusted on its own. */
export async function validatePetIntent(intent: PetIntent, config: DeploymentConfig, address: string, petId: string, kind: IntentKind): Promise<Transaction> {
  check(intent && intent.kind === kind && intent.pet_id === petId && intent.network === rawNetwork(config.network), 'INTENT_MISMATCH', '返回的操作与选择的宠物或网络不一致。');
  check(intent.program_id === config.program_id && intent.collection_address === config.collection_address, 'DEPLOYMENT_MISMATCH', '交易合约或系列与游戏配置不一致。');
  check(config.genesis_hash && config.issuer_address, 'DEPLOYMENT_MISSING', '发行服务配置不完整。');
  check(Number.isSafeInteger(intent.last_valid_block_height) && intent.last_valid_block_height > 0, 'INVALID_EXPIRY', '交易有效期无效。');
  check(Number.isFinite(Date.parse(intent.expires_at)) && Date.parse(intent.expires_at) > Date.now(), 'INTENT_EXPIRED', '交易已过期，请重新准备。');
  const inputs = intent.instruction_inputs;
  check(inputs && String(inputs.asset) === intent.asset_address && String(inputs.collection) === config.collection_address && String(inputs.issuer) === config.issuer_address, 'INTENT_MISMATCH', '宠物地址、系列或发行签名者不一致。');
  const builder = new PixelPetsInstructions(config.program_id!);
  let instruction;
  let coSigners: string[];
  if (kind === 'claim') {
    const claim = inputs as ClaimInput;
    check(String(claim.payer) === address && String(claim.recipient) === address, 'RECIPIENT_CHANGED', '领取人必须是当前钱包。');
    check(claim.claimId === await canonicalClaimId(config.network, config.genesis_hash, config.program_id!, petId), 'CLAIM_CHANGED', '领取编号与当前宠物不一致。');
    instruction = builder.claim(claim);
    coSigners = [config.issuer_address, intent.asset_address];
  } else {
    const checkpoint = inputs as CheckpointInput;
    check(String(checkpoint.owner) === address, 'OWNER_CHANGED', '成长记录必须由当前所有者确认。');
    instruction = builder.checkpoint(checkpoint);
    coSigners = [config.issuer_address];
  }
  const expected = new Transaction({ feePayer: new PublicKey(address), recentBlockhash: intent.blockhash }).add(instruction);
  const message = expected.serializeMessage();
  check(message.toString('base64') === intent.expected_message_base64, 'TRANSACTION_REPLACED', '交易内容包含未选择的操作。');
  return assertCoSignedTransaction(message, intent.transaction_base64, { requiredSigners: coSigners });
}

export interface FlowContext {
  api: FlowApi; token: string; wallet: Wallet; account: WalletAccount; config: DeploymentConfig;
  review: (summary: TransactionReview) => Promise<boolean>; assertCurrent: () => void;
  connection?: Connection;
}

/** JSON-RPC reads need their own deadline; confirmation timeouts do not cover fetch. */
export const boundedRpcFetch: typeof fetch = (input, init = {}) => {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  return fetch(input, { ...init, signal });
};
export async function runPetTransaction(context: FlowContext, petId: string, kind: IntentKind, options: { tripId?: string; resultHash?: string } = {}): Promise<any> {
  const { api, token, wallet, account, config } = context;
  check(config.enabled && config.rpc_url && config.program_id && config.collection_address, 'CHAIN_NOT_DEPLOYED', '链上服务尚未开放。');
  const feature = wallet.features['solana:signTransaction'] as SolanaSignTransactionFeature['solana:signTransaction'] | undefined;
  check(feature && account.features.includes('solana:signTransaction') && feature.supportedTransactionVersions.includes('legacy'), 'SIGN_TRANSACTION_UNSUPPORTED', '请使用支持 Solana 交易签名的钱包。');
  const rpcUrl = new URL(config.rpc_url);
  check(!rpcUrl.username && !rpcUrl.password && !rpcUrl.search && !rpcUrl.hash && (rpcUrl.protocol === 'https:' || (rpcUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(rpcUrl.hostname))), 'RPC_INVALID', '链连接地址不符合配置要求。');
  const rpc = context.connection ?? new Connection(config.rpc_url, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: boundedRpcFetch });
  check(account.publicKey.length === 32 && new PublicKey(account.publicKey).toBase58() === account.address, 'ACCOUNT_MISMATCH', '钱包地址与签名公钥不一致。');
  const client = new PixelPetsClient({ rpc, network: rawNetwork(config.network), programId: config.program_id, expectedGenesisHash: config.genesis_hash, expectedCollection: config.collection_address });
  await client.assertDeployment(); context.assertCurrent();
  const pets = await api('/pets', 'GET', token);
  const pet = pets.pets?.find((item: any) => item.id === petId);
  check(pet, 'PET_NOT_FOUND', '找不到这只宠物，请刷新档案。');
  check(!options.tripId || kind === 'checkpoint', 'INTENT_MISMATCH', 'Only a checkpoint can carry a journey receipt.');
  let intent: PetIntent = await api(options.tripId ? `/trips/${encodeURIComponent(options.tripId)}/checkpoint-intent`
    : `/pets/${encodeURIComponent(petId)}/${kind}-intent`, 'POST', token, {});
  context.assertCurrent();
  if (intent.state === 'confirmed') return { ...intent, message: '链上记录已经确认。' };
  if (intent.signature) {
    intent = await api(`/chain/intents/${intent.intent_id}`, 'GET', token);
    context.assertCurrent();
    if (intent.state === 'confirmed') return { ...intent, message: '上一笔链上记录已确认，档案已更新。' };
    if (intent.state === 'failed' || intent.state === 'expired') return { ...intent, message: '上一笔交易未完成，可再次点击准备新的确认。' };
    if (intent.signed_transaction_base64 && Date.parse(intent.expires_at) > Date.now() && await rpc.getBlockHeight('confirmed') <= intent.last_valid_block_height) {
      const expected = await validatePetIntent(intent, config, account.address, petId, kind);
      const previous = assertCoSignedTransaction(expected.serializeMessage(), intent.signed_transaction_base64, { requireAllSignatures: true });
      check(encodeBase58(previous.signature!) === intent.signature, 'SIGNATURE_MISMATCH', '待恢复交易的编号不匹配。');
      context.assertCurrent(); await client.assertNetwork();
      // Retry only the already-approved signed bytes; never request another wallet signature here.
      try { await rpc.sendRawTransaction(previous.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 }); } catch { /* Reconcile the same signature below. */ }
      const status = await api(`/chain/intents/${intent.intent_id}`, 'GET', token);
      return { ...status, message: status.state === 'confirmed' ? '链上记录已确认，档案已更新。' : '已恢复上一笔交易，正在等待最终确认。' };
    }
    return { ...intent, message: '上一笔交易正在核对，请稍后再次查看。' };
  }
  const transaction = await validatePetIntent(intent, config, account.address, petId, kind);
  if (options.tripId) await validateJourneyCommitment(intent, config, options.tripId, options.resultHash);
  const onchainConfig = await client.fetchConfig();
  check(onchainConfig.issuer.toBase58() === config.issuer_address, 'ISSUER_CHANGED', '发行签名者已变化，请刷新后重试。');
  if (kind === 'checkpoint') {
    check(pet.chain?.asset_address === intent.asset_address, 'ASSET_CHANGED', '成长记录对应的宠物资产不一致。');
    const input = intent.instruction_inputs as CheckpointInput;
    check(input.bond === pet.bond && input.form === ({ seed: 0, sun: 1, moon: 2 } as Record<string, number>)[pet.form], 'PROGRESS_CHANGED', '养成进度发生变化，请重新准备。');
    await client.verifyOfficialPet(intent.asset_address, account.address);
  } else {
    const edition = await client.fetchEdition((intent.instruction_inputs as ClaimInput).editionId);
    check(edition.species === ({ moss: 0, puddle: 1, wisp: 2 } as Record<string, number>)[pet.species_id], 'SPECIES_CHANGED', '领取的宠物种类不一致。');
  }
  const before = await rpc.getBalance(new PublicKey(account.address), 'confirmed');
  const [simulation, fee] = await Promise.all([
    rpc.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [account.address] } }),
    rpc.getFeeForMessage(transaction.compileMessage(), 'confirmed'),
  ]);
  check(!simulation.value.err, 'SIMULATION_FAILED', '链上预检查未通过，请检查余额和宠物状态。');
  const after = simulation.value.accounts?.[0]?.lamports;
  check(Number.isSafeInteger(before) && Number.isSafeInteger(after) && Number.isSafeInteger(fee.value) && fee.value !== null, 'ESTIMATE_UNAVAILABLE', '暂时无法核对费用，请稍后重试。');
  // Simulation post-balance includes the network fee. Clamp only a net credit, never conceal a debit.
  const debit = Math.max(fee.value!, before - after!);
  context.assertCurrent();
  const approved = await context.review({ title: kind === 'claim' ? 'Claim on Devnet · 给伙伴一份链上身份' : options.tripId ? 'Save journey receipt · 保存旅程凭证' : 'Save growth · 保存这段成长', petName: pet.nickname, network: rawNetwork(config.network), address: account.address, asset: intent.asset_address,
    estimatedDebitSol: lamportsToSol(String(debit)), networkFeeSol: lamportsToSol(String(fee.value)), message: kind === 'claim' ? 'Includes the network fee, account rent and the Core protocol fee. The asset will be owned by this wallet. Devnet test asset, no cash value. · 预计支出包括网络费、账户租金和 Core 协议费用。' : options.tripId ? 'Records this trip result (hash) on your pet record. Ownership stays in this wallet. · 只登记旅程结果摘要，所有权不变。' : 'Records a growth checkpoint only. Ownership stays in this wallet. · 本次只登记成长记录。' });
  check(approved, 'USER_CANCELLED', '已取消，本次没有提交交易。');
  context.assertCurrent(); await client.assertNetwork();
  check(await rpc.getBlockHeight('confirmed') <= intent.last_valid_block_height && Date.parse(intent.expires_at) > Date.now(), 'INTENT_EXPIRED', '确认期间交易已过期，请重新准备。');
  const [signed] = await feature.signTransaction({ account, transaction: transaction.serialize({ requireAllSignatures: false }), chain: config.network as `${string}:${string}` });
  context.assertCurrent();
  check(signed?.signedTransaction, 'SIGNATURE_MISSING', '钱包未返回完整签名。');
  await client.assertNetwork();
  const signedTx = assertCoSignedTransaction(transaction.serializeMessage(), signed.signedTransaction, { requireAllSignatures: true });
  const wire = signedTx.serialize();
  const signature = encodeBase58(signedTx.signature!);
  // Persist the exact signed transaction at the service before broadcasting; refreshes can reconcile this same intent.
  const receipt = { signature, transaction_base64: wire.toString('base64') };
  let status = await api(`/chain/intents/${intent.intent_id}/confirm`, 'POST', token, receipt);
  if (status.state === 'confirmed') return { ...status, message: '链上记录已经确认。' };
  context.assertCurrent();
  try {
    const returned = await rpc.sendRawTransaction(wire, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
    check(returned === signature, 'SIGNATURE_MISMATCH', '节点返回的交易编号不一致。');
  } catch {
    return { intent_id: intent.intent_id, signature, state: 'pending', message: '提交结果尚未确定，记录已保存。请稍后核对这笔交易，避免重复操作。' };
  }
  // Finalization usually takes ~13–20 s on Devnet/localnet; poll for up to ~36 s before handing back a resumable pending state.
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    context.assertCurrent();
    status = await api(`/chain/intents/${intent.intent_id}/confirm`, 'POST', token, receipt);
    if (status.state === 'confirmed') return { ...status, message: '链上记录已确认，伙伴档案已更新。' };
    if (status.state === 'failed') throw new TransactionFlowError('TRANSACTION_FAILED', '这笔交易没有成功，请查看交易结果后重试。');
  }
  return { ...status, message: '交易已提交，正在等待最终确认。稍后点击同一操作可继续核对。' };
}
function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n; for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = ''; while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}


const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
/** Phantom may prepend ComputeBudget ixs; compare compiled messages, not decompiled metas. */
function acceptWalletComputeBudget(expected: Transaction, returnedWire: Uint8Array | string, owner: string): Transaction {
  let returned: Transaction;
  try { returned = Transaction.from(typeof returnedWire === 'string' ? Buffer.from(returnedWire, 'base64') : returnedWire); }
  catch { throw new TransactionFlowError('INVALID_TRANSACTION', 'Expected a serialized legacy transaction.'); }
  check(!!expected.feePayer && returned.feePayer?.equals(expected.feePayer), 'TRANSACTION_REPLACED', 'Fee payer changed. Do not submit this gift.');
  check(returned.recentBlockhash === expected.recentBlockhash, 'TRANSACTION_REPLACED', 'Blockhash changed. Prepare the gift again.');
  const budget: typeof returned.instructions = [];
  for (const ix of returned.instructions) {
    if (!ix.programId.equals(COMPUTE_BUDGET_PROGRAM)) break;
    budget.push(ix);
  }
  check(budget.length < returned.instructions.length, 'TRANSACTION_REPLACED', 'Wallet returned only compute-budget instructions.');
  const rebuilt = new Transaction();
  rebuilt.feePayer = expected.feePayer;
  rebuilt.recentBlockhash = expected.recentBlockhash;
  for (const ix of budget) rebuilt.add(ix);
  for (const ix of expected.instructions) rebuilt.add(ix);
  check(Buffer.from(rebuilt.serializeMessage()).equals(returned.serializeMessage()), 'TRANSACTION_REPLACED', 'Gift message changed beyond compute-budget. Do not submit.');
  check(returned.verifySignatures(true), 'INVALID_SIGNATURE', 'Gift transaction signatures are invalid.');
  check(returned.signatures.some(s => s.publicKey.toBase58() === owner && s.signature !== null), 'MISSING_COSIGNATURE', 'Missing owner signature on gift.');
  return returned;
}

/**
 * P1 gift (Astra §9): owner-signed Core TransferV1 built locally with chain-client prepareGift().
 * No server custody. Blocked while the pet is travelling. Success is only reported after the
 * transfer is finalized AND the service's ownership sync no longer lists the pet for this wallet.
 */
export async function runGiftTransaction(context: FlowContext, petId: string, recipient: string): Promise<any> {
  const { api, token, wallet, account, config } = context;
  check(config.enabled && config.rpc_url && config.program_id && config.collection_address, 'CHAIN_NOT_DEPLOYED', 'On-chain gifting is not open yet.');
  let recipientKey: PublicKey;
  try { recipientKey = new PublicKey(recipient); } catch { throw new TransactionFlowError('RECIPIENT_INVALID', 'That is not a valid Solana address.'); }
  check(recipientKey.toBase58() === recipient && PublicKey.isOnCurve(recipientKey.toBytes()), 'RECIPIENT_INVALID', 'Send gifts to a wallet address (not a program account).');
  check(recipient !== account.address, 'SELF_TRANSFER', 'You already own this companion.');
  const feature = wallet.features['solana:signTransaction'] as SolanaSignTransactionFeature['solana:signTransaction'] | undefined;
  check(feature && account.features.includes('solana:signTransaction') && feature.supportedTransactionVersions.includes('legacy'), 'SIGN_TRANSACTION_UNSUPPORTED', 'Use a wallet that can sign Solana transactions.');
  const rpc = context.connection ?? new Connection(config.rpc_url, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: boundedRpcFetch });
  const client = new PixelPetsClient({ rpc, network: rawNetwork(config.network), programId: config.program_id, expectedGenesisHash: config.genesis_hash, expectedCollection: config.collection_address });
  await client.assertDeployment(); context.assertCurrent();
  const pets = await api('/pets', 'GET', token);
  const pet = pets.pets?.find((item: any) => item.id === petId);
  check(pet, 'PET_NOT_FOUND', 'Companion not found. Refresh your profile.');
  check(pet.chain?.status === 'registered' && pet.chain.asset_address, 'GIFT_NOT_REGISTERED', 'Only companions claimed on Solana can be gifted.');
  check(pet.ownership?.can_interact !== false, 'OWNERSHIP_UNVERIFIED', 'Sync your wallet first; ownership of this companion is not confirmed.');
  const current = await api(`/pets/${encodeURIComponent(petId)}/trips/current`, 'GET', token);
  check(current?.trip?.state !== 'travelling', 'GIFT_BLOCKED_TRAVELLING', 'Your companion is travelling. Gifting opens again after it is back.');
  context.assertCurrent();
  const prepared = await client.prepareGift({ owner: account.address, recipient, asset: pet.chain.asset_address });
  const approved = await context.review({ title: 'Send as a gift', petName: String(pet.nickname ?? pet.id), network: config.network,
    address: `${account.address} → ${recipient}`, asset: pet.chain.asset_address, estimatedDebitSol: lamportsToSol(prepared.networkFeeLamports),
    networkFeeSol: lamportsToSol(prepared.networkFeeLamports),
    message: `This transfers the companion to ${recipient}. Your private journal and other companions stay with you. This cannot be undone by the game.` });
  check(approved, 'USER_CANCELLED', 'Gift cancelled. Nothing was sent.');
  context.assertCurrent();
  const [signed] = await feature.signTransaction({ account, transaction: prepared.transaction.serialize({ requireAllSignatures: false }), chain: config.network as `${string}:${string}` });
  context.assertCurrent();
  check(signed?.signedTransaction, 'SIGNATURE_MISSING', 'The wallet did not return a signature.');
  // Phantom (and some Wallet Standard wallets) may prepend ComputeBudget ixs. Keep gift transfer
  // bytes identical, but allow those leading budget instructions before verify/simulate/send.
  const signedTx = acceptWalletComputeBudget(prepared.transaction, signed.signedTransaction, account.address);
  await client.assertNetwork();
  check(await rpc.getBlockHeight('confirmed') <= prepared.lastValidBlockHeight, 'TRANSACTION_EXPIRED', 'Gift transaction expired. Try again.');
  const simulation = await rpc.simulateTransaction(VersionedTransaction.deserialize(signedTx.serialize()), { commitment: 'confirmed', sigVerify: true, replaceRecentBlockhash: false });
  check(!simulation.value.err, 'SIMULATION_FAILED', 'Gift simulation failed. Your companion was not transferred.');
  const signature = encodeBase58(signedTx.signature!);
  try {
    const returned = await rpc.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
    check(returned === signature, 'SIGNATURE_MISMATCH', 'The node returned a different signature.');
  } catch (error) {
    if (error instanceof TransactionFlowError) throw error;
    return { state: 'pending', signature, recipient, message: 'Gift submission is uncertain. Check this signature before trying again.' };
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const status = await client.queryFinalized(signature, prepared.lastValidBlockHeight);
    if (status.state === 'failed') throw new TransactionFlowError('TRANSACTION_FAILED', 'The gift did not go through. Your companion is still yours.');
    if (status.state === 'finalized') {
      context.assertCurrent();
      const synced = await api('/wallet/assets/sync', 'POST', token, {});
      const still = synced.pets?.find((item: any) => item.id === petId);
      if (still && still.ownership?.can_interact) return { state: 'pending', signature, recipient, message: 'Gift finalized; the service has not caught up yet. Sync again shortly.' };
      return { state: 'gifted', signature, slot: status.slot, recipient, pets: synced.pets, ownership: synced.ownership, message: 'Gift confirmed on Solana. The recipient can sync their wallet to continue care.' };
    }
  }
  return { state: 'pending', signature, recipient, message: 'Gift submitted · checking confirmation. Sync your wallet later.' };
}
