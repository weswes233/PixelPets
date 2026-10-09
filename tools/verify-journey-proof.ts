/**
 * Independent verifier for a PixelPets journey receipt.
 * Recomputes R (trip result) and C (checkpoint v2) from their canonical bytes and, with --rpc,
 * decodes the finalized checkpoint transaction and compares its event_hash argument.
 * Usage: node tools/verify-journey-proof.ts --proof <file|https URL> [--rpc <url>]
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BorshInstructionCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { PIXEL_PETS_IDL, PixelPetsPdas } from '../chain-client/src/index.ts';
import { assertCanonical } from '../server/src/canonical.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const source = args.get('--proof'); if (!source) { console.error('Usage: --proof <file|url> [--rpc url]'); process.exit(2); }
const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const raw = /^https?:\/\//.test(source) ? await (await fetch(source)).json() : JSON.parse(await readFile(source, 'utf8'));
const proof = raw.ok !== undefined ? raw.data : raw;
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const R = assertCanonical(proof.trip_result.canonical) as unknown[];
check('trip result bytes are canonical and hash to result_hash', sha(proof.trip_result.canonical) === proof.trip_result.sha256);
check('trip result names this public receipt', R[0] === 'pixel-pets:trip-result:v1' && R[1] === proof.public_receipt_id);
const rpcUrl = args.get('--rpc'); const connection = rpcUrl ? new Connection(rpcUrl, 'finalized') : undefined;
const coder = new BorshInstructionCoder(PIXEL_PETS_IDL);
for (const [index, cp] of (proof.checkpoints as any[]).entries()) {
  const C = assertCanonical(cp.canonical) as unknown[];
  check(`#${index} checkpoint bytes are canonical and hash to event_hash`, sha(cp.canonical) === cp.sha256);
  check(`#${index} checkpoint commits to this trip result`, C[0] === 'pixel-pets:checkpoint:v2' && C[12] === proof.public_receipt_id && C[13] === proof.trip_result.sha256);
  check(`#${index} checkpoint names network, program, asset and sequence`, C[1] === cp.network_genesis && C[2] === cp.program_id && C[3] === cp.asset_address && C[5] === cp.expected_checkpoint);
  if (!connection) continue;
  check(`#${index} RPC genesis matches`, await connection.getGenesisHash() === cp.network_genesis);
  const tx = await connection.getTransaction(cp.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  check(`#${index} transaction is finalized without error at the recorded slot`, !!tx && tx.meta?.err === null && tx.slot === cp.finalized_slot, tx ? `slot ${tx.slot}` : 'not found');
  if (!tx) continue;
  const keys = tx.transaction.message.staticAccountKeys ?? (tx.transaction.message as any).accountKeys;
  const ixs = tx.transaction.message.compiledInstructions;
  const ours = ixs.filter(ix => keys[ix.programIdIndex].toBase58() === cp.program_id).map(ix => ({ ix, decoded: coder.decode(Buffer.from(ix.data)) }));
  const checkpoint = ours.find(item => item.decoded?.name === 'checkpoint');
  const argsDecoded = (checkpoint?.decoded?.data as any)?.args;
  const onChainHash = argsDecoded ? Buffer.from(argsDecoded.event_hash).toString('hex') : null;
  check(`#${index} checkpoint instruction carries this event_hash`, onChainHash === cp.sha256, onChainHash ?? 'no checkpoint instruction');
  check(`#${index} instruction expected_checkpoint matches`, argsDecoded && argsDecoded.expected_checkpoint.toString() === cp.expected_checkpoint);
  const assetIndex = checkpoint ? checkpoint.ix.accountKeyIndexes[4] : -1;
  check(`#${index} instruction targets the recorded asset`, assetIndex >= 0 && keys[assetIndex].toBase58() === cp.asset_address);
  const record = await connection.getAccountInfo(new PixelPetsPdas(cp.program_id).petRecord(cp.asset_address)[0], 'finalized');
  if (record) {
    const current = Buffer.from(record.data.subarray(record.data.length - 0)).toString('hex');
    const isLatest = current.includes(cp.sha256);
    console.log(`INFO #${index} current PetRecord ${isLatest ? 'still holds' : 'has moved past'} this event_hash (only the latest checkpoint is stored on the account)`);
  }
}
const failed = checks.filter(item => !item.ok).length;
console.log(failed ? `FAILED ${failed}/${checks.length}` : `VERIFIED ${checks.length} checks`);
process.exitCode = failed ? 1 : 0;
