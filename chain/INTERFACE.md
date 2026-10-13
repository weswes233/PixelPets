# PixelPets chain interface v1 — implementation, not a deployment

Development program ID: `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` (replaced `2R4P5J6rwE1F2R8fRRF1dvqV9JxwSTix4Qf6FGhc3iQR` on 2026-10-10 because that address's deploy key was not available to the Devnet build machine; the old ID remains only in historical local evidence files). Synced in `declare_id!`, `Anchor.toml`, `idl/pixel_pets.json`, `idl/pixel_pets.ts`; SDK, server and web read the IDL address. The deploy key is gitignored at `target/deploy/pixel_pets-keypair.json` (copy kept in gitignored `runtime/devnet-keys/`); never serve or commit it. Core ID is `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`.

Exact account and argument order is in `programs/pixel-pets/src/lib.rs` and the generated `idl/pixel_pets.json`. The IDL and builders have been exercised by SDK tests and actual local execution. Rust names below use snake_case; Anchor TS exposes camelCase.

## PDA derivation

All PDAs belong to the configured PixelPets program. u64 seeds are **8-byte little endian**, not decimal text.

| Account | Seeds |
|---|---|
| Config | `utf8("config")` |
| Edition | `utf8("edition"), edition_id_u64_le` |
| PetRecord | `utf8("pet"), asset_public_key_bytes` |
| ClaimReceipt | `utf8("claim"), canonical_claim_id_hash_32bytes` |
| Offer | `utf8("offer"), offered_asset_public_key_bytes, nonce_u64_le` |

Read the pet's `next_offer_nonce`; do not use a random nonce. It increments on every created offer, even cancelled offers. Offer account rent returns to the maker on settlement/cancellation; nonce prevents old offer-address reuse. Claims, editions and pet records never close.

## Calls

- `initialize({name,uri,issuer,fee_recipient,fee_bps})`: accounts `admin*, config+, collection*+, program, program_data, core_program, system_program`. `program_data` must match this program's upgradeable loader record and its upgrade authority must sign as admin. URI must be ipfs:// or ar://. Collection authority becomes Config PDA; no externally held authority/delegate.
- `configure(issuer,fee_recipient,fee_bps,paused)`: `admin*, config+`. Fee cap 500 bps. Applies only to future offers; existing offers retain fee snapshot.
- `create_edition({edition_id,max_supply,origin_hash[32],rules_version,species,name,uri})`: `admin*+, config, edition+, system_program`. Species `0=moss,1=puddle,2=wisp`. Frozen at creation; no update/cap increase.
- `claim_pet(claim_id[32],expires_at_i64_seconds)`: `payer*+, recipient*, issuer*, config, edition+, collection+, asset*+, pet_record+, receipt+, core_program, system_program`. A fresh asset keypair signs (temporary, non-wallet secret). Issuer must co-sign this exact transaction after server qualification; recipient must sign too. Max 15-minute claim expiry. Canonical claim hash is server allocated, not caller-controlled for eligibility. Replay receipt is global per program, not per wallet/edition. The edition fixes metadata and species. Core asset has ImmutableMetadata+AddBlocker with immutable authority. Form starts `0=seed`.
- `checkpoint({expected_checkpoint,form,bond,event_hash[32]})`: `owner*, issuer*, config, collection, asset, pet_record+`. Form `0=seed,1=sun,2=moon`. Only seed→sun/moon (bond>=6) or unchanged. Bond cannot decrease, sequence increments. Requires current owner and issuer, no active offer.
- `create_swap(nonce_u64,expires_at_i64_seconds)`: `maker*+, config, collection, asset+, pet_record+, desired_asset, desired_record, offer+, core_program, system_program`. Desired asset fixed by address; both pets must have canonical records and allowed plugins. Snapshot desired pet checkpoint and offered checkpoint. Max 30-day expiry.
- `create_sale(nonce_u64,expires_at_i64_seconds,price_lamports_u64)`: `maker*+, config, collection, asset+, pet_record+, offer+, core_program, system_program`. Exact nonzero SOL amount in lamports, no floats. Owns escrow at Offer PDA.
- `accept_swap()`: `taker*+, maker+, config, collection, asset+, pet_record+, desired_asset+, desired_record, offer+, core_program, system_program`. `maker` comes from onchain offer; original maker need not sign. Two Core CPIs in same instruction. Desired checkpoint must match listing snapshot.
- `buy(expected_price_lamports_u64)`: `buyer*+, maker+, fee_recipient+, config, collection, asset+, pet_record+, offer+, core_program, system_program`. Maker/fee recipient fixed by offer, not current config. Payment and Core transfer atomic. No extra buyer surcharge; fee subtracted from gross price with floor rounding.
- `cancel_offer()`: `caller*+, maker+, config, collection, asset+, pet_record+, offer+, core_program, system_program`. Maker may cancel any time. After expiration anyone may return it **only to original maker**. Works while paused. No platform fee on cancellation.

`*` = transaction signer; `+` = writable. Same key may fulfil multiple signer roles. Pay rent/network/Core protocol charges in addition to SOL purchase price. RPC simulation required before UI quotes cost.

## Asset / client invariants

- Check `account.owner == Core ID` for account program AND decoded Core `owner == expected wallet/Offer PDA`; these differ.
- Core collection + correct PetRecord PDA defines official identity; name/image alone never does.
- Only two asset plugins accepted by market: immutable AddBlocker + ImmutableMetadata; no external plugins. AddBlocker does not prevent owner delegates. Owners who add delegates must remove them before listing. Withdrawals avoid the market plugin-policy check to keep return possible.
- Free eligibility and growth remain trusted server attestations; onchain signatures do not prove care happened. Issuer cannot mint beyond edition cap but can attest other valid claims. No issuer key belongs in a client.
- No fake connection/mint/settlement. Query finalized claim receipt/asset owner after transaction. Unknown outcome stays pending, reconcile by signature and receipt before retry.
- Program remains upgradeable in development; upgrade authority can change rules. No claim of immutability or audit. No mainnet program address/configuration yet.
