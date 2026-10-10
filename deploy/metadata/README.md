# PixelPets Devnet metadata

Status: **content-addressed; same CIDs pinned to Lighthouse; identical bytes also on Irys Devnet gateway.**

- `tools/build-metadata.ts` writes `images/`, `json/` and `manifest.json`.
  The PNGs come from `game/tools/render_pet_png.gd` (same PetArt as the game).
- Each URI is a raw-leaf CIDv1 (`bafkrei…`, sha2-256). Re-pinning identical bytes keeps the same URI.
- On-chain collection + editions already use these `ipfs://bafkrei…` URIs. Metaplex Core assets are immutable — existing assets keep these URIs; no redeploy needed when the same CID becomes publicly resolvable.

## Public pinning (2026-10-10)

| Path | Result | Evidence |
| --- | --- | --- |
| Lighthouse (ephemeral ETH wallet API key, no Wes account) | Upload+pin of all 7 files; **CID match** vs manifest | `docs/evidence/lighthouse-pin-2026-10-10.json` |
| Irys Devnet (funded with Devnet SOL from deployer) | Identical bytes fetchable via `https://gateway.irys.xyz/<id>` (HTTP 200 + sha256 match). Irys L1/devnet ids are **not** valid `ar://` under `chain-client` policy | `docs/evidence/irys-devnet-*.json` |
| Public gateways (ipfs.io / dweb.link) | Currently challenge/block non-browser curl (SW/bot). Wallet-native gateways may still resolve after DHT propagation | — |

`tools/pin-metadata-local.sh` still pins into local kubo for offline checks.

Optional for Wes: Pinata / Filebase free-tier JWT to make CIDs visible in a dashboard (CID should stay identical).
