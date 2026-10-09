# PixelPets Devnet metadata (DEV / TEMPORARY path)

Status: **content-addressed locally, not yet pinned by a durable provider.**

- `tools/build-metadata.ts` writes `images/`, `json/` and `manifest.json`.
  The PNGs come from `game/tools/render_pet_png.gd`, which uses the same
  PetArt code as the game.
- Each URI is a raw-leaf CIDv1 (`bafkrei…`, sha2-256) that depends only on
  the file bytes. Running `ipfs add --cid-version=1 --only-hash` (kubo 0.43.1)
  gives the same CIDs (checked 2026-10-11).
- Any pinning service that stores a single file as CIDv1 raw (Pinata,
  Filebase, Storacha, a self-hosted kubo) returns these exact URIs. Pinning
  later does not change the on-chain URI.

## Temporary provider

`tools/pin-metadata-local.sh` adds and pins every file in a local kubo node
on this box. The content can be reached through IPFS while the box is
online, but public gateways may rate-limit (HTTP 429 seen) or time out.
**This is not durable hosting.** Before a public demo, Wes needs to pin these
files with a real provider account (see docs/plan/00-today-checklist.md).
