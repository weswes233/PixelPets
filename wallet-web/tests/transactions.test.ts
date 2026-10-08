import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { PROGRAM_ID, PixelPetsInstructions } from '../../chain-client/src/index.ts';
import { canonicalClaimId, validatePetIntent } from '../src/transactions.ts';
import type { DeploymentConfig, PetIntent } from '../src/transactions.ts';
import type { ClaimInput } from '../../chain-client/src/index.ts';

async function fixture() {
  const wallet = Keypair.generate(), issuer = Keypair.generate(), asset = Keypair.generate();
  const config: DeploymentConfig = { enabled: true, network: 'solana:localnet', program_id: PROGRAM_ID.toBase58(), collection_address: Keypair.generate().publicKey.toBase58(), issuer_address: issuer.publicKey.toBase58(), genesis_hash: Keypair.generate().publicKey.toBase58() };
  const petId = 'a415b7db-2c09-49d2-bfa6-eb0de2e46a25';
  const inputs: ClaimInput = { payer: wallet.publicKey.toBase58(), recipient: wallet.publicKey.toBase58(), issuer: issuer.publicKey.toBase58(), collection: config.collection_address!, asset: asset.publicKey.toBase58(), editionId: '1',
    claimId: await canonicalClaimId('localnet', config.genesis_hash!, config.program_id!, petId), expiresAt: String(Math.floor(Date.now() / 1000) + 300) };
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: blockhash }).add(new PixelPetsInstructions().claim(inputs));
  transaction.partialSign(issuer, asset);
  const intent: PetIntent = { intent_id: 'request-1', kind: 'claim', state: 'prepared', pet_id: petId, network: 'localnet', program_id: config.program_id!, collection_address: config.collection_address!, asset_address: inputs.asset.toString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(), transaction_base64: transaction.serialize({ requireAllSignatures: false }).toString('base64'), expected_message_base64: transaction.serializeMessage().toString('base64'), blockhash, last_valid_block_height: 500, instruction_inputs: inputs };
  return { config, petId, inputs, wallet, issuer, asset, intent, transaction };
}
test('co-signed claim is independently rebuilt and preserves both issuer and asset signatures', async () => {
  const f = await fixture(); const tx = await validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim');
  assert.equal(tx.signatures.filter(s => s.signature !== null).length, 2);
  assert.equal(tx.verifySignatures(false), true);
});
test('claim identity is scoped to the selected network, program, genesis and pet', async () => {
  const f = await fixture();
  assert.notEqual(await canonicalClaimId('devnet', f.config.genesis_hash!, f.config.program_id!, f.petId), f.inputs.claimId);
  await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), 'another-pet', 'claim'), { code: 'INTENT_MISMATCH' });
});
test('an API replacement that adds a SOL transfer is rejected even when its expected-message also changes', async () => {
  const f = await fixture();
  f.transaction.add(SystemProgram.transfer({ fromPubkey: f.wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000000 }));
  f.transaction.partialSign(f.issuer, f.asset);
  f.intent.transaction_base64 = f.transaction.serialize({ requireAllSignatures: false }).toString('base64');
  f.intent.expected_message_base64 = f.transaction.serializeMessage().toString('base64');
  await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim'), { code: 'TRANSACTION_REPLACED' });
});
test('changing recipient or claim identifier is rejected before asking the wallet to sign', async () => {
  for (const field of ['recipient', 'claimId'] as const) {
    const f = await fixture(); f.inputs[field] = field === 'recipient' ? Keypair.generate().publicKey.toBase58() : 'ff'.repeat(32);
    await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim'), { code: field === 'recipient' ? 'RECIPIENT_CHANGED' : 'CLAIM_CHANGED' });
  }
});
test('missing issuer signature, stale quote and wrong deployment are rejected', async () => {
  const f = await fixture();
  f.transaction.signatures.find(s => s.publicKey.equals(f.issuer.publicKey))!.signature = null;
  f.intent.transaction_base64 = f.transaction.serialize({ requireAllSignatures: false }).toString('base64');
  await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim'), { code: 'MISSING_COSIGNATURE' });
  f.intent.expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim'), { code: 'INTENT_EXPIRED' });
  f.intent.program_id = Keypair.generate().publicKey.toBase58();
  await assert.rejects(validatePetIntent(f.intent, f.config, f.wallet.publicKey.toBase58(), f.petId, 'claim'), { code: 'DEPLOYMENT_MISMATCH' });
});
