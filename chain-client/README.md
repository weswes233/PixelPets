# PixelPets chain client

TypeScript client for the checked-in PixelPets Anchor IDL and Metaplex Core assets. It constructs and checks transactions, reads accounts, and reports finalized outcomes. It never broadcasts transactions, opens a wallet, requests airdrops, loads key files, or chooses a network implicitly.

This package is workspace source, imported from `chain-client/src/index.ts`. Use Node 24 for its tests and a browser bundler for the wallet application. Dependencies and versions are locked by the root `package-lock.json`.

## Network and deployment configuration

```ts
import { Connection } from '@solana/web3.js';
import { PixelPetsClient } from './chain-client/src/index.ts';

const client = new PixelPetsClient({
  rpc: new Connection(config.rpcUrl, 'confirmed'),
  network: config.network,          // localnet | devnet | testnet | mainnet-beta
  programId: config.programId,      // must equal the checked-in IDL address
  expectedCollection: config.collection,
  expectedGenesisHash: config.genesisHash,
});

await client.assertDeployment();
```

Public networks use their complete 32-byte base58 genesis hashes. Wallet Standard chain identifiers and abbreviated hash prefixes are not RPC genesis hashes. An explicit genesis hash is required for localnet, and localnet rejects known public cluster hashes. The RPC URL alone never establishes network identity.

`assertDeployment()` checks the selected network, executable program, upgradeable loader state, ProgramData PDA, and executable Core program. Its result includes the current upgrade authority. This is a deployment identity check; it does not hash or attest the deployed bytecode or guarantee that an upgrade authority cannot change it. Production deployment tooling must verify and record the deployed build separately.

## APIs

| API | Purpose |
| --- | --- |
| `PixelPetsPdas` | Derive Config, Edition, PetRecord, ClaimReceipt, Offer and ProgramData addresses. |
| `PixelPetsInstructions` | Pure builders for initialize, configure, edition, claim, checkpoint, swap, sale, buy and cancellation instructions. |
| `createGiftInstruction()` | Exact owner-authorized Core `TransferV1`; no issuer signature or platform fee. |
| `fetchConfig/Edition/PetRecord/Offer()` | Decode program-owned accounts and check their expected identity/PDA. |
| `verifyOfficialPet()` | Check record, current owner, canonical collection, collection authority, Core account types, and conservative immutable plugin policy. |
| `prepareClaim/Checkpoint/Gift/Swap/Sale/AcceptSwap/Buy/Cancel()` | Build an operation from explicit inputs and relevant current account data, then validate deployment and simulate it. |
| `prepare()` | Lower-level preparation of PixelPets instructions or one exact Core gift. Rejects other programs, incorrect IDL permissions, fixed accounts, issuer and collection substitutions. |
| `assertCoSignedTransaction()` | Compare exact transaction message bytes and verify supplied signatures without RPC calls. |
| `verifySignedTransaction()` | Recheck network, exact message, signatures and blockhash lifetime; simulate fully signed transactions with signature verification. |
| `queryFinalized()` | Return `unknown`, `pending`, `failed`, or `finalized` status without treating missing history as success. |
| `verifyFinalizedTransaction()` | Require finalized status plus matching signature, slot, success metadata and exact prepared message. |
| `verifyFinalizedClaim()` | Bind a finalized legacy claim instruction to its claim receipt, provenance, canonical Core pet and current recipient ownership. |

Pure builders do not establish eligibility or read chain state. Preparation uses RPC simulation for remaining contract eligibility checks. Fetch methods and `verifyOfficialPet()` do not independently run `assertNetwork()`; call `assertNetwork()` or `assertDeployment()` before standalone reads. Operation preparation and finalized verification check the network themselves.

## Amounts, signing and confirmations

Pass u64/i64 values as decimal strings, `bigint`, or Anchor `BN`. JavaScript numbers are rejected for these fields, even when small. `solToLamports()`, `lamportsToSol()` and `saleAmounts()` preserve integer precision; sale fees round down using integer arithmetic.

```ts
const prepared = await client.prepareSale({
  maker: account.address,
  asset: selectedAsset,
  expiresAt: expirationUnixSeconds, // decimal string
  priceLamports: '10000000',
});

// Present the exact operation and estimated total cost to the user first.
const returnedWire = await walletSignTransaction(prepared.transactionBase64);
const signed = await client.verifySignedTransaction(prepared, returnedWire);

// Broadcasting and durable retry records belong to the caller.
// The SDK has no sendTransaction or sendRawTransaction method.
```

Keep `expectedMessage`, `blockhash` and `lastValidBlockHeight` from local preparation. Compare wallet/server responses against those retained values; never trust a replacement "expected message" returned by an untrusted signer. `assertCoSignedTransaction()` permits missing signatures by default for intermediate co-signing; provide `requiredSigners` for the issuer/asset as applicable. `verifySignedTransaction()` requires all signatures by default.

`networkFeeLamports` covers the network fee only. Rent and Core protocol charges can add to the wallet debit. The wallet layer is responsible for estimating and displaying the total cost. Successful simulation does not guarantee settlement: balances, ownership, checkpoints, offers and blockhashes can change before execution.

Persist a signed transaction before broadcast so an uncertain network result can resume using the same bytes. A missing signature status is an unknown outcome; even after blockhash expiry, reconcile prior signatures and claim receipts before creating a new attempt. Claim IDs must be stable for the same server-authorized pet and network/program scope. The ClaimReceipt PDA prevents reusing a claim ID for a second issue.

Finalized checks rely on the selected RPC returning truthful data; this SDK is not an independent consensus verifier. `verifyFinalizedClaim()` also checks **current** owner equals the original recipient. A claim followed by a gift or sale will need a separate ownership-reconciliation flow; a failed current-owner check does not prove the historical claim never occurred.

## Immutable metadata URI policy

`isImmutableMetadataUri()` and initialize/edition builders validate content-address syntax before an irreversible metadata lock:

- `ipfs://` accepts CIDv0 base58btc and CIDv1 lowercase base32 or base58btc (`b`/`z`). CIDv1 supports raw, dag-pb, dag-cbor and dag-json codecs with SHA-256 or SHA-512. Varints must be minimal and digest length must consume all bytes.
- `ar://` requires a canonical, unpadded 43-character base64url transaction ID representing 32 bytes.
- Optional paths accept unreserved characters or valid percent-encoded UTF-8 segments. Queries, fragments, credentials, traversal, empty internal segments, encoded separators, controls and double-encoding are rejected. The whole URI must fit 200 UTF-8 bytes.

The CID subset is intentionally conservative; it is not a universal CID parser. The format follows the [IPFS CID specification](https://specs.ipfs.tech/cid/) and [Arweave transaction ID format](https://docs.arweave.org/developers/arweave-node-server/http-api). This is **syntax validation only**. It does not upload, pin or retrieve content; prove JSON validity, image availability or file hashes; verify an Arweave transaction; or guarantee permanence. Publishing must upload and retrieve the actual metadata and artwork, check bytes/content, and record evidence before creating the immutable edition. The program's prefix checks alone are weaker than this client policy.

## Verification

From the repository root:

```powershell
node --test chain-client/tests/*.test.ts
node node_modules/typescript/bin/tsc -p chain-client/tsconfig.json
```

Verified on 2026-10-07: **22 tests passed**, TypeScript check passed. Tests use real IDL encoding, Core serialization and cryptographic signatures with read-only mocked RPC responses. They cover amount precision, complete genesis hashes, immutable URI parsing, account identities, plugin restrictions, co-signature preservation, altered transaction rejection, quote/fee snapshots, pause/cancellation, expiry and finalized operation binding. They do not execute the SBF contract, Core CPI, a validator, or a public network transaction; those require the separate chain integration suite.
