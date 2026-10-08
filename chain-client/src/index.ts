import { Buffer } from 'buffer';
import { BN, BorshAccountsCoder, BorshInstructionCoder } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import { getTransferV1InstructionDataSerializer, getPluginHeaderV1AccountDataSerializer, Key, PluginType } from '@metaplex-foundation/mpl-core';
import { getAssetV1AccountDataSerializer, getCollectionV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/hooked/index.js';
import { getAssetV1AccountDataSerializer as getBaseAssetSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js';
import { getCollectionV1AccountDataSerializer as getBaseCollectionSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js';
import { getPluginRegistryV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js';
import {
  PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction,
} from '@solana/web3.js';
import type { AccountInfo, Commitment, Connection, Signer, TransactionError } from '@solana/web3.js';
import rawIdl from '../../chain/idl/pixel_pets.json' with { type: 'json' };
import { isImmutableMetadataUri } from './metadata-uri.ts';
export { isImmutableMetadataUri } from './metadata-uri.ts';

export const PIXEL_PETS_IDL = rawIdl as Idl;
export const PROGRAM_ID = new PublicKey(rawIdl.address);
export const CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const GENESIS_HASHES = Object.freeze({
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
});
export type PublicKeyInput = PublicKey | string;
export type IntegerInput = string | bigint | BN;
export type HashInput = Uint8Array | readonly number[] | string;
export type SupportedNetwork = 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta';
export type ProgramAccountName = 'Config' | 'Edition' | 'PetRecord' | 'ClaimReceipt' | 'Offer';

export class ChainClientError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message); this.name = 'ChainClientError'; this.code = code; this.details = details;
  }
}
function requireThat(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) throw new ChainClientError(code, message);
}
export function publicKey(value: PublicKeyInput): PublicKey {
  try { return value instanceof PublicKey ? value : new PublicKey(value); }
  catch { throw new ChainClientError('INVALID_PUBLIC_KEY', 'A valid Solana public key is required.'); }
}
export function integer(value: IntegerInput, bits = 64, signed = false): bigint {
  requireThat(Number.isInteger(bits) && bits >= 1 && bits <= 256, 'INTEGER_RANGE', 'Integer width must be between 1 and 256 bits.');
  requireThat(typeof value === 'string' || typeof value === 'bigint' || BN.isBN(value),
    'UNSAFE_INTEGER', 'Use a decimal integer string, bigint, or BN; numbers are not accepted.');
  const text = value.toString(10);
  requireThat(signed ? /^-?(0|[1-9]\d*)$/.test(text) : /^(0|[1-9]\d*)$/.test(text),
    'INVALID_INTEGER', 'Integer must use plain decimal notation without fractions or exponents.');
  const result = BigInt(text);
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
  requireThat(result >= min && result <= max, 'INTEGER_RANGE', `Integer is outside ${signed ? 'i' : 'u'}${bits}.`);
  return result;
}
function bn(value: IntegerInput, signed = false): BN { return new BN(integer(value, 64, signed).toString()); }
export function u64LE(value: IntegerInput): Buffer {
  const result = Buffer.alloc(8); result.writeBigUInt64LE(integer(value)); return result;
}
function small(value: number, bits: 8 | 16 | 32, label: string): number {
  requireThat(Number.isSafeInteger(value) && value >= 0 && value <= 2 ** bits - 1,
    'INTEGER_RANGE', `${label} must be a u${bits} integer.`); return value;
}
export function hash32(value: HashInput): Buffer {
  if (typeof value === 'string') {
    requireThat(/^[0-9a-fA-F]{64}$/.test(value), 'INVALID_HASH', 'Hash must contain exactly 64 hexadecimal characters.');
    return Buffer.from(value, 'hex');
  }
  requireThat(value.length === 32 && Array.from(value).every(x => Number.isInteger(x) && x >= 0 && x <= 255),
    'INVALID_HASH', 'Hash must contain exactly 32 bytes.'); return Buffer.from(value);
}
function nonzeroHash(value: HashInput): Buffer {
  const bytes = hash32(value); requireThat(bytes.some(x => x !== 0), 'INVALID_HASH', 'Hash cannot be all zero.'); return bytes;
}
function metadata(name: string, uri: string): void {
  requireThat(typeof name === 'string' && name.trim().length > 0 && Buffer.byteLength(name) <= 32,
    'INVALID_METADATA', 'Name must contain 1–32 UTF-8 bytes.');
  requireThat(isImmutableMetadataUri(uri), 'INVALID_METADATA',
    'URI must contain a supported IPFS CID or Arweave transaction ID, a canonical optional path, and fit 200 UTF-8 bytes.');
}
export function solToLamports(value: string): string {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value),
    'INVALID_AMOUNT', 'SOL amount must be a decimal string with at most 9 fractional digits.');
  const [whole, fractional = ''] = value.split('.');
  return integer(BigInt(whole) * 1_000_000_000n + BigInt(fractional.padEnd(9, '0'))).toString();
}
export function lamportsToSol(value: IntegerInput): string {
  const amount = integer(value); const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${amount / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`;
}
export function saleAmounts(priceLamports: IntegerInput, feeBps: number) {
  small(feeBps, 16, 'feeBps'); requireThat(feeBps <= 500, 'INVALID_FEE', 'Fee cannot exceed 500 basis points.');
  const gross = integer(priceLamports); const fee = gross * BigInt(feeBps) / 10_000n;
  return { grossLamports: gross.toString(), feeLamports: fee.toString(), sellerLamports: (gross - fee).toString() };
}

export class PixelPetsPdas {
  readonly programId: PublicKey;
  constructor(programId: PublicKeyInput = PROGRAM_ID) { this.programId = publicKey(programId); }
  private derive(seeds: Buffer[]): [PublicKey, number] { return PublicKey.findProgramAddressSync(seeds, this.programId); }
  config() { return this.derive([Buffer.from('config')]); }
  edition(editionId: IntegerInput) { return this.derive([Buffer.from('edition'), u64LE(editionId)]); }
  petRecord(asset: PublicKeyInput) { return this.derive([Buffer.from('pet'), publicKey(asset).toBuffer()]); }
  claimReceipt(claimId: HashInput) { return this.derive([Buffer.from('claim'), hash32(claimId)]); }
  offer(asset: PublicKeyInput, nonce: IntegerInput) { return this.derive([Buffer.from('offer'), publicKey(asset).toBuffer(), u64LE(nonce)]); }
  programData() { return PublicKey.findProgramAddressSync([this.programId.toBuffer()], UPGRADEABLE_LOADER_ID); }
}

export interface InitializeInput { admin: PublicKeyInput; collection: PublicKeyInput; name: string; uri: string; issuer: PublicKeyInput; feeRecipient: PublicKeyInput; feeBps: number }
export interface EditionInput { admin: PublicKeyInput; editionId: IntegerInput; maxSupply: number; originHash: HashInput; rulesVersion: number; species: number; name: string; uri: string }
export interface ClaimInput { payer: PublicKeyInput; recipient: PublicKeyInput; issuer: PublicKeyInput; collection: PublicKeyInput; asset: PublicKeyInput; editionId: IntegerInput; claimId: HashInput; expiresAt: IntegerInput }
export interface CheckpointInput { owner: PublicKeyInput; issuer: PublicKeyInput; collection: PublicKeyInput; asset: PublicKeyInput; expectedCheckpoint: IntegerInput; form: number; bond: number; eventHash: HashInput }
export interface ListingInput { maker: PublicKeyInput; collection: PublicKeyInput; asset: PublicKeyInput; nonce: IntegerInput; expiresAt: IntegerInput }
export interface SettlementInput { maker: PublicKeyInput; collection: PublicKeyInput; asset: PublicKeyInput; nonce: IntegerInput }
export interface GiftInput { owner: PublicKeyInput; recipient: PublicKeyInput; collection: PublicKeyInput; asset: PublicKeyInput; payer?: PublicKeyInput }

/** Core owner-signed transfer. No issuer approval, listing, escrow or platform fee is involved. */
export function createGiftInstruction(input: GiftInput): TransactionInstruction {
  requireThat(!publicKey(input.owner).equals(publicKey(input.recipient)), 'SELF_TRANSFER', 'Gift recipient must differ from the owner.');
  return new TransactionInstruction({ programId: CORE_PROGRAM_ID,
    data: Buffer.from(getTransferV1InstructionDataSerializer().serialize({})),
    keys: [
      { pubkey: publicKey(input.asset), isWritable: true, isSigner: false },
      { pubkey: publicKey(input.collection), isWritable: false, isSigner: false },
      { pubkey: publicKey(input.payer ?? input.owner), isWritable: true, isSigner: true },
      { pubkey: publicKey(input.owner), isWritable: false, isSigner: true },
      { pubkey: publicKey(input.recipient), isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      // Core represents omitted optional accounts with the Core program address.
      { pubkey: CORE_PROGRAM_ID, isWritable: false, isSigner: false },
    ] });
}

/** Pure builders. These do not assert eligibility, send transactions, or read wallets. */
export class PixelPetsInstructions {
  readonly programId: PublicKey;
  readonly pdas: PixelPetsPdas;
  readonly coder = new BorshInstructionCoder(PIXEL_PETS_IDL);
  constructor(programId: PublicKeyInput = PROGRAM_ID) {
    this.programId = publicKey(programId);
    requireThat(this.programId.equals(PROGRAM_ID), 'PROGRAM_MISMATCH', 'Program must match the checked-in IDL address.');
    this.pdas = new PixelPetsPdas(this.programId);
  }
  private build(name: string, args: Record<string, unknown>, accounts: Record<string, PublicKeyInput>): TransactionInstruction {
    const instruction = rawIdl.instructions.find(x => x.name === name)!;
    const common: Record<string, PublicKeyInput> = {
      config: this.pdas.config()[0], core_program: CORE_PROGRAM_ID,
      system_program: SystemProgram.programId, ...accounts,
    };
    return new TransactionInstruction({ programId: this.programId, data: this.coder.encode(name, args),
      keys: instruction.accounts.map(a => ({ pubkey: publicKey(common[a.name]), isSigner: 'signer' in a && a.signer === true, isWritable: 'writable' in a && a.writable === true })) });
  }
  initialize(input: InitializeInput) {
    metadata(input.name, input.uri); small(input.feeBps, 16, 'feeBps');
    requireThat(input.feeBps <= 500, 'INVALID_FEE', 'Fee cannot exceed 500 basis points.');
    return this.build('initialize', { args: { name: input.name, uri: input.uri, issuer: publicKey(input.issuer), fee_recipient: publicKey(input.feeRecipient), fee_bps: input.feeBps } },
      { admin: input.admin, collection: input.collection, program: this.programId, program_data: this.pdas.programData()[0] });
  }
  configure(input: { admin: PublicKeyInput; issuer: PublicKeyInput; feeRecipient: PublicKeyInput; feeBps: number; paused: boolean }) {
    small(input.feeBps, 16, 'feeBps'); requireThat(input.feeBps <= 500, 'INVALID_FEE', 'Fee cannot exceed 500 basis points.');
    requireThat(typeof input.paused === 'boolean', 'INVALID_BOOLEAN', 'paused must be a boolean.');
    return this.build('configure', { issuer: publicKey(input.issuer), fee_recipient: publicKey(input.feeRecipient), fee_bps: input.feeBps, paused: input.paused }, { admin: input.admin });
  }
  createEdition(input: EditionInput) {
    metadata(input.name, input.uri); small(input.maxSupply, 32, 'maxSupply'); small(input.rulesVersion, 16, 'rulesVersion');
    requireThat(input.maxSupply > 0 && input.rulesVersion > 0, 'INVALID_EDITION', 'Supply and rules version must be positive.');
    requireThat(Number.isInteger(input.species) && input.species >= 0 && input.species <= 2, 'INVALID_SPECIES', 'Species must be 0, 1 or 2.');
    return this.build('create_edition', { args: { edition_id: bn(input.editionId), max_supply: input.maxSupply, origin_hash: Array.from(nonzeroHash(input.originHash)), rules_version: input.rulesVersion, species: input.species, name: input.name, uri: input.uri } },
      { admin: input.admin, edition: this.pdas.edition(input.editionId)[0] });
  }
  claim(input: ClaimInput) {
    return this.build('claim_pet', { claim_id: Array.from(nonzeroHash(input.claimId)), expires_at: bn(input.expiresAt, true) },
      { payer: input.payer, recipient: input.recipient, issuer: input.issuer, collection: input.collection, asset: input.asset,
        edition: this.pdas.edition(input.editionId)[0], pet_record: this.pdas.petRecord(input.asset)[0], receipt: this.pdas.claimReceipt(input.claimId)[0] });
  }
  checkpoint(input: CheckpointInput) {
    requireThat(Number.isInteger(input.form) && input.form >= 0 && input.form <= 2, 'INVALID_FORM', 'Form must be 0, 1 or 2.'); small(input.bond, 32, 'bond');
    return this.build('checkpoint', { args: { expected_checkpoint: bn(input.expectedCheckpoint), form: input.form, bond: input.bond, event_hash: Array.from(nonzeroHash(input.eventHash)) } },
      { owner: input.owner, issuer: input.issuer, collection: input.collection, asset: input.asset, pet_record: this.pdas.petRecord(input.asset)[0] });
  }
  private listingAccounts(input: SettlementInput) {
    return { maker: input.maker, collection: input.collection, asset: input.asset, pet_record: this.pdas.petRecord(input.asset)[0], offer: this.pdas.offer(input.asset, input.nonce)[0] };
  }
  createSwap(input: ListingInput & { desiredAsset: PublicKeyInput }) {
    requireThat(!publicKey(input.asset).equals(publicKey(input.desiredAsset)), 'SELF_TRADE', 'Swap assets must differ.');
    return this.build('create_swap', { nonce: bn(input.nonce), expires_at: bn(input.expiresAt, true) },
      { ...this.listingAccounts(input), desired_asset: input.desiredAsset, desired_record: this.pdas.petRecord(input.desiredAsset)[0] });
  }
  createSale(input: ListingInput & { priceLamports: IntegerInput }) {
    requireThat(integer(input.priceLamports) > 0n, 'INVALID_PRICE', 'Sale price must be positive.');
    return this.build('create_sale', { nonce: bn(input.nonce), expires_at: bn(input.expiresAt, true), price_lamports: bn(input.priceLamports) }, this.listingAccounts(input));
  }
  acceptSwap(input: SettlementInput & { taker: PublicKeyInput; desiredAsset: PublicKeyInput }) {
    return this.build('accept_swap', {}, { ...this.listingAccounts(input), taker: input.taker, desired_asset: input.desiredAsset, desired_record: this.pdas.petRecord(input.desiredAsset)[0] });
  }
  buy(input: SettlementInput & { buyer: PublicKeyInput; feeRecipient: PublicKeyInput; expectedPriceLamports: IntegerInput }) {
    requireThat(integer(input.expectedPriceLamports) > 0n, 'INVALID_PRICE', 'Expected price must be positive.');
    return this.build('buy', { expected_price_lamports: bn(input.expectedPriceLamports) }, { ...this.listingAccounts(input), buyer: input.buyer, fee_recipient: input.feeRecipient });
  }
  cancel(input: SettlementInput & { caller: PublicKeyInput }) {
    return this.build('cancel_offer', {}, { ...this.listingAccounts(input), caller: input.caller });
  }
}

export interface ConfigAccount { admin: PublicKey; issuer: PublicKey; collection: PublicKey; fee_recipient: PublicKey; fee_bps: number; paused: boolean; bump: number }
export interface EditionAccount { edition_id: BN; max_supply: number; issued: number; origin_hash: number[]; rules_version: number; species: number; name: string; uri: string; bump: number }
export interface PetRecordAccount { asset: PublicKey; edition: PublicKey; serial: number; origin_hash: number[]; rules_version: number; species: number; form: number; checkpoint: BN; bond: number; event_hash: number[]; checkpoint_slot: BN; active_offer: PublicKey; next_offer_nonce: BN; bump: number }
export interface OfferAccount { maker: PublicKey; asset: PublicKey; desired_asset: PublicKey; fee_recipient: PublicKey; nonce: BN; expires_at: BN; offered_checkpoint: BN; desired_checkpoint: BN; price_lamports: BN; fee_bps: number; kind: number; bump: number }
export interface ClaimReceiptAccount { claim_id: number[]; recipient: PublicKey; asset: PublicKey; edition: PublicKey; origin_hash: number[]; rules_version: number; expires_at: BN; bump: number }
export type RpcClient = Pick<Connection, 'getGenesisHash' | 'getAccountInfo' | 'getLatestBlockhash' | 'getFeeForMessage' | 'simulateTransaction' | 'getSignatureStatuses' | 'getBlockHeight'> & Partial<Pick<Connection, 'getTransaction'>>;
export interface ClientOptions {
  rpc: RpcClient; network: SupportedNetwork; programId?: PublicKeyInput;
  /** Required for localnet, obtained from the selected validator, never inferred from the URL. */
  expectedGenesisHash?: string;
  expectedCollection?: PublicKeyInput;
  commitment?: 'confirmed' | 'finalized';
}
export interface PrepareInput { payer: PublicKeyInput; instructions: readonly TransactionInstruction[]; temporarySigners?: readonly Signer[] }
export interface PreparedTransaction {
  transaction: Transaction; transactionBase64: string; expectedMessage: Uint8Array; expectedMessageBase64: string;
  blockhash: string; lastValidBlockHeight: number; requiredSigners: string[];
  /** Only the network fee. Rent and Core protocol charges are additional. */
  networkFeeLamports: string; simulationLogs: readonly string[]; unitsConsumed: number | null;
}
export type FinalizedStatus =
  | { state: 'finalized'; signature: string; slot: number }
  | { state: 'failed'; signature: string; error: TransactionError; slot: number }
  | { state: 'pending'; signature: string; confirmationStatus: string | null }
  | { state: 'unknown'; signature: string; blockhashExpired: boolean | null };

/** Reject every transaction change, including fee payer, blockhash, destinations, data and added instructions. */
export function assertCoSignedTransaction(expectedMessage: Uint8Array, returnedWire: Uint8Array | string,
  options: { requiredSigners?: readonly PublicKeyInput[]; requireAllSignatures?: boolean } = {}): Transaction {
  let transaction: Transaction;
  try { transaction = Transaction.from(typeof returnedWire === 'string' ? Buffer.from(returnedWire, 'base64') : returnedWire); }
  catch { throw new ChainClientError('INVALID_TRANSACTION', 'Expected a serialized legacy transaction.'); }
  requireThat(Buffer.from(expectedMessage).equals(transaction.serializeMessage()), 'TRANSACTION_REPLACED', 'Co-signer changed the expected transaction message. Do not sign or submit it.');
  requireThat(transaction.verifySignatures(options.requireAllSignatures ?? false), 'INVALID_SIGNATURE', 'Transaction contains invalid or missing required signatures.');
  for (const key of options.requiredSigners ?? []) {
    requireThat(transaction.signatures.some(s => s.publicKey.equals(publicKey(key)) && s.signature !== null),
      'MISSING_COSIGNATURE', `Missing co-signature for ${publicKey(key).toBase58()}.`);
  }
  return transaction;
}

/** Same conservative plugin policy as the contract. Reject unknown adapters and delegated assets. */
function assertCorePlugins(data: Buffer, baseLength: number, asset: boolean): void {
  try {
    if (data.length === baseLength) {
      requireThat(!asset, 'UNSAFE_CORE_PLUGINS', 'Official pets require both immutable plugins.'); return;
    }
    const [header] = getPluginHeaderV1AccountDataSerializer().deserialize(data, baseLength);
    requireThat(header.key === Key.PluginHeaderV1 && header.pluginRegistryOffset >= BigInt(baseLength + 9)
      && header.pluginRegistryOffset < BigInt(data.length), 'UNSAFE_CORE_PLUGINS', 'Invalid Core plugin registry location.');
    const [registry] = getPluginRegistryV1AccountDataSerializer().deserialize(data, Number(header.pluginRegistryOffset));
    requireThat(registry.key === Key.PluginRegistryV1 && registry.externalRegistry.length === 0,
      'UNSAFE_CORE_PLUGINS', 'External Core adapters are not supported.');
    requireThat(registry.registry.length === (asset ? 2 : 0), 'UNSAFE_CORE_PLUGINS', 'Unexpected Core plugins or delegates.');
    if (asset) for (const kind of [PluginType.ImmutableMetadata, PluginType.AddBlocker]) {
      requireThat(registry.registry.filter(p => p.pluginType === kind && p.authority.__kind === 'None').length === 1,
        'UNSAFE_CORE_PLUGINS', 'Pet metadata and plugin additions must be immutable.');
    }
  } catch (error) {
    if (error instanceof ChainClientError) throw error;
    throw new ChainClientError('UNSAFE_CORE_PLUGINS', 'Cannot safely decode Core plugin registry.');
  }
}

export class PixelPetsClient {
  readonly rpc: RpcClient;
  readonly network: SupportedNetwork;
  readonly instructions: PixelPetsInstructions;
  readonly pdas: PixelPetsPdas;
  readonly commitment: 'confirmed' | 'finalized';
  readonly expectedGenesisHash: string;
  readonly expectedCollection?: PublicKey;
  readonly accountCoder = new BorshAccountsCoder(PIXEL_PETS_IDL);
  constructor(options: ClientOptions) {
    const network = options.network;
    requireThat(['localnet', 'devnet', 'testnet', 'mainnet-beta'].includes(network), 'UNSUPPORTED_NETWORK', 'Unsupported Solana network.');
    this.rpc = options.rpc; this.network = network; this.instructions = new PixelPetsInstructions(options.programId);
    this.pdas = this.instructions.pdas; this.commitment = options.commitment ?? 'confirmed';
    const knownHash = network === 'localnet' ? undefined : network === 'mainnet-beta' ? GENESIS_HASHES.mainnet : GENESIS_HASHES[network];
    if (knownHash && options.expectedGenesisHash) requireThat(knownHash === options.expectedGenesisHash, 'NETWORK_MISMATCH', 'Configured genesis hash does not match network.');
    this.expectedGenesisHash = knownHash ?? options.expectedGenesisHash ?? '';
    requireThat(this.expectedGenesisHash.length > 0, 'INVALID_GENESIS', 'An explicit genesis hash is required for localnet.');
    if (network === 'localnet') requireThat(!(Object.values(GENESIS_HASHES) as string[]).includes(this.expectedGenesisHash), 'INVALID_GENESIS', 'Localnet cannot use a public-cluster genesis hash.');
    this.expectedCollection = options.expectedCollection ? publicKey(options.expectedCollection) : undefined;
  }
  async assertNetwork(): Promise<void> {
    const actual = await this.rpc.getGenesisHash();
    requireThat(actual === this.expectedGenesisHash, 'NETWORK_MISMATCH', 'RPC genesis hash differs from the selected network.');
  }
  async assertDeployment(): Promise<{ programData: PublicKey; upgradeAuthority: PublicKey | null }> {
    await this.assertNetwork();
    const [program, core] = await Promise.all([
      this.rpc.getAccountInfo(this.instructions.programId, this.commitment), this.rpc.getAccountInfo(CORE_PROGRAM_ID, this.commitment),
    ]);
    requireThat(program && program.executable && program.owner.equals(UPGRADEABLE_LOADER_ID), 'PROGRAM_NOT_DEPLOYED', 'PixelPets program is absent or is not an executable upgradeable program.');
    requireThat(program.data.length >= 36 && program.data.readUInt32LE(0) === 2, 'INVALID_PROGRAM', 'Invalid upgradeable program account.');
    const programData = new PublicKey(program.data.subarray(4, 36));
    requireThat(programData.equals(this.pdas.programData()[0]), 'INVALID_PROGRAM_DATA', 'ProgramData address is not the expected loader PDA.');
    const data = await this.rpc.getAccountInfo(programData, this.commitment);
    requireThat(data && data.owner.equals(UPGRADEABLE_LOADER_ID) && data.data.length >= 13 && data.data.readUInt32LE(0) === 3,
      'INVALID_PROGRAM_DATA', 'Missing or invalid ProgramData account.');
    requireThat(data.data[12] === 0 || (data.data[12] === 1 && data.data.length >= 45), 'INVALID_PROGRAM_DATA', 'Invalid upgrade authority encoding.');
    requireThat(core?.executable, 'CORE_NOT_DEPLOYED', 'Metaplex Core is not executable on this network.');
    return { programData, upgradeAuthority: data.data[12] === 0 ? null : new PublicKey(data.data.subarray(13, 45)) };
  }
  private async account(address: PublicKeyInput, owner: PublicKey, commitment: Commitment = this.commitment): Promise<AccountInfo<Buffer>> {
    const result = await this.rpc.getAccountInfo(publicKey(address), commitment);
    requireThat(result, 'ACCOUNT_MISSING', `Account ${publicKey(address).toBase58()} does not exist.`);
    requireThat(result.owner.equals(owner), 'ACCOUNT_OWNER_MISMATCH', 'Account is owned by the wrong program.'); return result;
  }
  async fetchAccount<T>(name: ProgramAccountName, address: PublicKeyInput, commitment: Commitment = this.commitment): Promise<T> {
    const account = await this.account(address, this.instructions.programId, commitment);
    try { return this.accountCoder.decode<T>(name, account.data); }
    catch { throw new ChainClientError('ACCOUNT_DECODE_FAILED', `Invalid ${name} account discriminator or data.`); }
  }
  async fetchConfig(commitment: Commitment = this.commitment): Promise<ConfigAccount> {
    const config = await this.fetchAccount<ConfigAccount>('Config', this.pdas.config()[0], commitment);
    requireThat(config.bump === this.pdas.config()[1], 'PDA_MISMATCH', 'Config bump mismatch.');
    if (this.expectedCollection) requireThat(config.collection.equals(this.expectedCollection), 'COLLECTION_MISMATCH', 'Collection differs from the configured collection.');
    requireThat(config.fee_bps <= 500, 'INVALID_CONFIG', 'Config fee exceeds the protocol limit.'); return config;
  }
  async fetchPetRecord(asset: PublicKeyInput, commitment: Commitment = this.commitment): Promise<PetRecordAccount> {
    const pda = this.pdas.petRecord(asset); const pet = await this.fetchAccount<PetRecordAccount>('PetRecord', pda[0], commitment);
    requireThat(pet.asset.equals(publicKey(asset)) && pet.bump === pda[1], 'PDA_MISMATCH', 'Pet record identity mismatch.'); return pet;
  }
  async fetchEdition(editionId: IntegerInput, commitment: Commitment = this.commitment): Promise<EditionAccount> {
    const pda = this.pdas.edition(editionId); const edition = await this.fetchAccount<EditionAccount>('Edition', pda[0], commitment);
    requireThat(edition.edition_id.eq(bn(editionId)) && edition.bump === pda[1], 'PDA_MISMATCH', 'Edition identity mismatch.'); return edition;
  }
  async fetchOffer(asset: PublicKeyInput, nonce: IntegerInput, commitment: Commitment = this.commitment): Promise<OfferAccount> {
    const pda = this.pdas.offer(asset, nonce); const offer = await this.fetchAccount<OfferAccount>('Offer', pda[0], commitment);
    requireThat(offer.asset.equals(publicKey(asset)) && offer.nonce.eq(bn(nonce)) && offer.bump === pda[1], 'PDA_MISMATCH', 'Offer identity mismatch.'); return offer;
  }
  async verifyOfficialPet(asset: PublicKeyInput, expectedOwner: PublicKeyInput, commitment: Commitment = this.commitment) {
    const [config, record, assetInfo] = await Promise.all([this.fetchConfig(commitment), this.fetchPetRecord(asset, commitment), this.account(asset, CORE_PROGRAM_ID, commitment)]);
    requireThat(assetInfo.data[0] === Key.AssetV1, 'INVALID_ASSET', 'Core account is not an AssetV1.');
    assertCorePlugins(assetInfo.data, getBaseAssetSerializer().deserialize(assetInfo.data)[1], true);
    const [coreAsset] = getAssetV1AccountDataSerializer().deserialize(assetInfo.data);
    requireThat(coreAsset.owner === publicKey(expectedOwner).toBase58(), 'ASSET_OWNER_MISMATCH', 'Core asset owner does not match the expected wallet or escrow.');
    requireThat(coreAsset.updateAuthority.type === 'Collection' && coreAsset.updateAuthority.address === config.collection.toBase58(), 'COLLECTION_MISMATCH', 'Core asset is not in the canonical collection.');
    const collectionInfo = await this.account(config.collection, CORE_PROGRAM_ID, commitment);
    requireThat(collectionInfo.data[0] === Key.CollectionV1, 'INVALID_COLLECTION', 'Core account is not a CollectionV1.');
    assertCorePlugins(collectionInfo.data, getBaseCollectionSerializer().deserialize(collectionInfo.data)[1], false);
    const [collection] = getCollectionV1AccountDataSerializer().deserialize(collectionInfo.data);
    requireThat(collection.updateAuthority === this.pdas.config()[0].toBase58(), 'COLLECTION_AUTHORITY_MISMATCH', 'Collection authority is not the Config PDA.');
    return { config, record, coreAsset };
  }
  async prepare(input: PrepareInput): Promise<PreparedTransaction> {
    await this.assertDeployment();
    requireThat(input.instructions.length > 0, 'EMPTY_TRANSACTION', 'At least one instruction is required.');
    for (const instruction of input.instructions) {
      if (instruction.programId.equals(CORE_PROGRAM_ID)) {
        requireThat(input.instructions.length === 1 && instruction.keys.length === 7, 'INVALID_GIFT', 'A gift must be a single canonical Core transfer.');
        const keys = instruction.keys;
        const canonical = createGiftInstruction({ asset: keys[0].pubkey, collection: keys[1].pubkey, payer: keys[2].pubkey, owner: keys[3].pubkey, recipient: keys[4].pubkey });
        requireThat(instruction.data.equals(canonical.data) && keys.every((key, index) => key.pubkey.equals(canonical.keys[index].pubkey)
          && key.isSigner === canonical.keys[index].isSigner && key.isWritable === canonical.keys[index].isWritable),
          'INVALID_GIFT', 'Gift data, accounts, authority or permissions differ from Core TransferV1.');
        requireThat(publicKey(input.payer).equals(keys[2].pubkey), 'INVALID_GIFT', 'Gift fee payer must match the Core payer.');
        const pet = await this.verifyOfficialPet(keys[0].pubkey, keys[3].pubkey);
        requireThat(keys[1].pubkey.equals(pet.config.collection), 'COLLECTION_MISMATCH', 'Gift uses the wrong collection.');
        requireThat(pet.record.active_offer.equals(PublicKey.default), 'ALREADY_LISTED', 'Escrowed pets cannot be gifted.');
        continue;
      }
      requireThat(instruction.programId.equals(this.instructions.programId), 'PROGRAM_MISMATCH', 'Only PixelPets instructions may be prepared.');
      const decoded = this.instructions.coder.decode(instruction.data);
      requireThat(decoded !== null, 'INVALID_INSTRUCTION', 'Unknown PixelPets instruction.');
      const schema = rawIdl.instructions.find(x => x.name === decoded.name)!;
      requireThat(instruction.keys.length === schema.accounts.length, 'INVALID_ACCOUNTS', 'Instruction account count mismatch.');
      schema.accounts.forEach((account, index) => {
        const key = instruction.keys[index];
        requireThat(key.isSigner === ('signer' in account && account.signer === true) && key.isWritable === ('writable' in account && account.writable === true), 'INVALID_ACCOUNTS', 'Instruction account permissions differ from the IDL.');
        if (account.name === 'config') requireThat(key.pubkey.equals(this.pdas.config()[0]), 'PDA_MISMATCH', 'Invalid Config PDA.');
        if ('address' in account) requireThat(key.pubkey.equals(publicKey(account.address!)), 'PROGRAM_MISMATCH', 'Instruction contains an incorrect fixed program.');
      });
      if (decoded.name !== 'initialize') {
        const config = await this.fetchConfig();
        if (!['cancel_offer', 'configure'].includes(decoded.name)) requireThat(!config.paused, 'PROTOCOL_PAUSED', 'Protocol is paused.');
        for (const role of ['collection', 'issuer'] as const) {
          const index = schema.accounts.findIndex(a => a.name === role);
          if (index >= 0) requireThat(instruction.keys[index].pubkey.equals(config[role]), role === 'collection' ? 'COLLECTION_MISMATCH' : 'ISSUER_MISMATCH', `Incorrect ${role} account.`);
        }
      }
    }
    const latest = await this.rpc.getLatestBlockhash(this.commitment);
    const transaction = new Transaction({ feePayer: publicKey(input.payer), recentBlockhash: latest.blockhash });
    transaction.add(...input.instructions);
    if (input.temporarySigners?.length) transaction.partialSign(...input.temporarySigners);
    const expectedMessage = transaction.serializeMessage();
    const versioned = new VersionedTransaction(transaction.compileMessage());
    const [simulation, fee] = await Promise.all([
      this.rpc.simulateTransaction(versioned, { commitment: this.commitment, sigVerify: false, replaceRecentBlockhash: false }),
      this.rpc.getFeeForMessage(transaction.compileMessage(), this.commitment),
    ]);
    if (simulation.value.err) throw new ChainClientError('SIMULATION_FAILED', 'RPC simulation rejected the transaction.', { error: simulation.value.err, logs: simulation.value.logs });
    requireThat(fee.value !== null && Number.isSafeInteger(fee.value) && fee.value >= 0, 'FEE_UNAVAILABLE', 'RPC could not provide a safe network fee estimate.');
    return { transaction, transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString('base64'),
      expectedMessage: Uint8Array.from(expectedMessage), expectedMessageBase64: expectedMessage.toString('base64'),
      blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
      requiredSigners: transaction.compileMessage().accountKeys.slice(0, transaction.compileMessage().header.numRequiredSignatures).map(x => x.toBase58()),
      networkFeeLamports: BigInt(fee.value).toString(), simulationLogs: simulation.value.logs ?? [], unitsConsumed: simulation.value.unitsConsumed ?? null };
  }
  async prepareSale(input: Omit<ListingInput, 'nonce' | 'collection'> & { priceLamports: IntegerInput }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const { config, record } = await this.verifyOfficialPet(input.asset, input.maker);
    requireThat(record.active_offer.equals(PublicKey.default), 'ALREADY_LISTED', 'Pet already has an active offer.');
    return this.prepare({ payer: input.maker, instructions: [this.instructions.createSale({ ...input, collection: config.collection, nonce: record.next_offer_nonce })] });
  }
  async prepareClaim(input: Omit<ClaimInput, 'issuer' | 'collection' | 'asset'> & { assetSigner: Signer }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const config = await this.fetchConfig();
    return this.prepare({ payer: input.payer, temporarySigners: [input.assetSigner], instructions: [this.instructions.claim({
      ...input, asset: input.assetSigner.publicKey, issuer: config.issuer, collection: config.collection,
    })] });
  }
  async prepareCheckpoint(input: Omit<CheckpointInput, 'issuer' | 'collection'>): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const { config, record } = await this.verifyOfficialPet(input.asset, input.owner);
    requireThat(record.active_offer.equals(PublicKey.default), 'ALREADY_LISTED', 'Listed pets cannot checkpoint.');
    requireThat(record.checkpoint.eq(bn(input.expectedCheckpoint)), 'CHECKPOINT_CHANGED', 'Checkpoint changed; refresh before signing.');
    return this.prepare({ payer: input.owner, instructions: [this.instructions.checkpoint({ ...input, issuer: config.issuer, collection: config.collection })] });
  }
  async prepareSwap(input: Omit<ListingInput, 'nonce' | 'collection'> & { desiredAsset: PublicKeyInput }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const { config, record } = await this.verifyOfficialPet(input.asset, input.maker);
    requireThat(record.active_offer.equals(PublicKey.default), 'ALREADY_LISTED', 'Pet already has an active offer.');
    return this.prepare({ payer: input.maker, instructions: [this.instructions.createSwap({ ...input, collection: config.collection, nonce: record.next_offer_nonce })] });
  }
  async prepareAcceptSwap(input: { taker: PublicKeyInput; asset: PublicKeyInput; nonce: IntegerInput }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const [config, offer] = await Promise.all([this.fetchConfig(), this.fetchOffer(input.asset, input.nonce)]);
    requireThat(offer.kind === 0, 'INVALID_OFFER', 'Offer is not a swap.');
    return this.prepare({ payer: input.taker, instructions: [this.instructions.acceptSwap({ ...input, maker: offer.maker, collection: config.collection, desiredAsset: offer.desired_asset })] });
  }
  async prepareCancel(input: { caller: PublicKeyInput; asset: PublicKeyInput; nonce: IntegerInput }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const [config, offer] = await Promise.all([this.fetchConfig(), this.fetchOffer(input.asset, input.nonce)]);
    return this.prepare({ payer: input.caller, instructions: [this.instructions.cancel({ ...input, maker: offer.maker, collection: config.collection })] });
  }
  async prepareGift(input: Omit<GiftInput, 'collection'>): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const config = await this.fetchConfig();
    return this.prepare({ payer: input.payer ?? input.owner, instructions: [createGiftInstruction({ ...input, collection: config.collection })] });
  }
  async prepareBuy(input: { buyer: PublicKeyInput; asset: PublicKeyInput; nonce: IntegerInput; expectedPriceLamports: IntegerInput }): Promise<PreparedTransaction> {
    await this.assertNetwork();
    const [config, offer] = await Promise.all([this.fetchConfig(), this.fetchOffer(input.asset, input.nonce)]);
    requireThat(offer.kind === 1 && offer.price_lamports.eq(bn(input.expectedPriceLamports)), 'PRICE_CHANGED', 'Offer kind or price differs from the accepted quote.');
    return this.prepare({ payer: input.buyer, instructions: [this.instructions.buy({ ...input, maker: offer.maker, feeRecipient: offer.fee_recipient, collection: config.collection })] });
  }
  /** Validate an untrusted co-signer/wallet response against the locally retained preparation. Never broadcasts. */
  async verifySignedTransaction(prepared: Pick<PreparedTransaction, 'expectedMessage' | 'blockhash' | 'lastValidBlockHeight'>,
    returnedWire: Uint8Array | string, options: { requiredSigners?: readonly PublicKeyInput[]; requireAllSignatures?: boolean } = {}): Promise<Transaction> {
    await this.assertNetwork();
    const allSigned = options.requireAllSignatures ?? true;
    const transaction = assertCoSignedTransaction(prepared.expectedMessage, returnedWire, { ...options, requireAllSignatures: allSigned });
    requireThat(transaction.recentBlockhash === prepared.blockhash, 'TRANSACTION_REPLACED', 'Blockhash differs from prepared transaction.');
    requireThat(Number.isSafeInteger(prepared.lastValidBlockHeight) && prepared.lastValidBlockHeight >= 0, 'INVALID_BLOCK_HEIGHT', 'Expected a safe last valid block height.');
    requireThat(await this.rpc.getBlockHeight(this.commitment) <= prepared.lastValidBlockHeight, 'TRANSACTION_EXPIRED', 'Transaction blockhash expired. Prepare and approve a new message.');
    if (allSigned) {
      const signed = VersionedTransaction.deserialize(transaction.serialize());
      const simulation = await this.rpc.simulateTransaction(signed, { commitment: this.commitment, sigVerify: true, replaceRecentBlockhash: false });
      if (simulation.value.err) throw new ChainClientError('SIMULATION_FAILED', 'Signed transaction simulation failed.', { error: simulation.value.err, logs: simulation.value.logs });
    }
    return transaction;
  }
  async queryFinalized(signature: string, lastValidBlockHeight?: number): Promise<FinalizedStatus> {
    requireThat(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature), 'INVALID_SIGNATURE', 'Invalid transaction signature.');
    await this.assertNetwork();
    const result = await this.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = result.value[0];
    if (!status) {
      const expired = lastValidBlockHeight === undefined ? null : await this.rpc.getBlockHeight('finalized') > lastValidBlockHeight;
      return { state: 'unknown', signature, blockhashExpired: expired };
    }
    if (status.err) return { state: 'failed', signature, error: status.err, slot: status.slot };
    if (status.confirmationStatus === 'finalized') return { state: 'finalized', signature, slot: status.slot };
    return { state: 'pending', signature, confirmationStatus: status.confirmationStatus ?? null };
  }
  /** Bind finalized status to this exact prepared message, not merely an unrelated successful signature. */
  async verifyFinalizedTransaction(prepared: Pick<PreparedTransaction, 'expectedMessage' | 'lastValidBlockHeight'>, signature: string) {
    const status = await this.queryFinalized(signature, prepared.lastValidBlockHeight);
    if (status.state !== 'finalized') return { status, verified: false as const };
    requireThat(this.rpc.getTransaction, 'TRANSACTION_LOOKUP_UNAVAILABLE', 'Finalized verification requires RPC getTransaction.');
    const result = await this.rpc.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!result) return { status, verified: false as const };
    requireThat(result.slot === status.slot && result.meta && result.meta.err === null && result.transaction.signatures[0] === signature,
      'FINALIZED_TRANSACTION_MISMATCH', 'Finalized transaction is missing, failed, or has a different signature.');
    requireThat(Buffer.from(prepared.expectedMessage).equals(Buffer.from(result.transaction.message.serialize())),
      'FINALIZED_TRANSACTION_MISMATCH', 'Finalized transaction message differs from the prepared operation.');
    return { status, verified: true as const };
  }
  async verifyFinalizedClaim(input: { signature: string; claimId: HashInput; recipient: PublicKeyInput; asset: PublicKeyInput; editionId: IntegerInput; lastValidBlockHeight?: number }) {
    const status = await this.queryFinalized(input.signature, input.lastValidBlockHeight);
    if (status.state !== 'finalized') return { status, verified: false as const };
    requireThat(this.rpc.getTransaction, 'TRANSACTION_LOOKUP_UNAVAILABLE', 'Finalized claim verification requires RPC getTransaction.');
    const result = await this.rpc.getTransaction(input.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!result) return { status, verified: false as const };
    requireThat(result.slot === status.slot && result.meta && result.meta.err === null && result.transaction.signatures[0] === input.signature
      && 'instructions' in result.transaction.message, 'FINALIZED_TRANSACTION_MISMATCH', 'Expected a successful finalized legacy claim transaction.');
    const pda = this.pdas.claimReceipt(input.claimId);
    const receipt = await this.fetchAccount<ClaimReceiptAccount>('ClaimReceipt', pda[0], 'finalized');
    requireThat(Buffer.from(receipt.claim_id).equals(hash32(input.claimId)) && receipt.bump === pda[1]
      && receipt.recipient.equals(publicKey(input.recipient)) && receipt.asset.equals(publicKey(input.asset))
      && receipt.edition.equals(this.pdas.edition(input.editionId)[0]), 'CLAIM_MISMATCH', 'Finalized receipt differs from the expected claim.');
    const pet = await this.verifyOfficialPet(input.asset, input.recipient, 'finalized');
    requireThat(pet.record.edition.equals(receipt.edition) && pet.record.rules_version === receipt.rules_version
      && Buffer.from(pet.record.origin_hash).equals(Buffer.from(receipt.origin_hash)), 'CLAIM_MISMATCH', 'Pet provenance differs from claim receipt.');
    const landed = Transaction.populate(result.transaction.message).instructions;
    const matchingClaim = landed.some(instruction => {
      if (!instruction.programId.equals(this.instructions.programId) || instruction.keys.length !== 11) return false;
      // The issuer may have rotated since landing. The finalized program validated that historical issuer.
      const expected = this.instructions.claim({ payer: instruction.keys[0].pubkey, issuer: instruction.keys[2].pubkey,
        recipient: input.recipient, collection: pet.config.collection, asset: input.asset, editionId: input.editionId,
        claimId: input.claimId, expiresAt: receipt.expires_at });
      return expected.data.equals(instruction.data) && expected.keys.every((key, index) => key.pubkey.equals(instruction.keys[index].pubkey));
    });
    requireThat(matchingClaim, 'FINALIZED_TRANSACTION_MISMATCH', 'Finalized transaction does not contain the expected claim.');
    return { status, verified: true as const, receipt, pet };
  }
}
