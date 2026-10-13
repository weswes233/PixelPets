# Handoff (2026-10-10, 10:35 UTC+8)

Branch `feature/travel-devnet-demo`. Status table: `docs/plan/00-today-checklist.md`.  
Wes checklist: `docs/plan/wes-verify.md`. Product look: `docs/plan/PRODUCT-PREVIEW.md`.

## Devnet deploy (done this morning)

- Deployer `294hmkx17KS7ww6CzA6ZeDx2F3o7zybo8txRYRvhW9BU` funded with 5 SOL.
- Program `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`; collection `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS`; editions moss/puddle/wisp = 1001/1002/1003.
- Scripted smoke claim→trip→reveal→receipt PASS. Evidence: `docs/evidence/devnet-demo-2026-10-10.json`.

## Metadata pinning (done without Wes account)

- **Lighthouse:** same 7 CIDs uploaded+pin-requested (`docs/evidence/lighthouse-pin-2026-10-10.json`).
- **Irys Devnet:** identical bytes publicly fetchable at gateway.irys.xyz (HTTP 200 + sha256); ids are not valid on-chain `ar://`.
- On-chain URIs unchanged (immutable Core). Public ipfs.io/dweb.link still bot/SW-challenge curl.

## Devnet two-wallet gift (done)

- `chain/tests/gift-two-wallet-devnet.mjs` 6 PASS.
- Gift sig `5ZNrPvAM…Ee9UW2`; asset `FNjCcimb…Jddm`. Evidence: `chain/evidence/gift-two-wallet-devnet.json`.

## Still needs Wes

1. Approve program id `2SCKfWsz…Qm2nT`.
2. Real Phantom/Backpack claim+trip+receipt (+ optional gift) on Devnet.
3. Public HTTPS host/domain (box egress 7844/22 blocked; wrangler needs his login). Static Pages alone ≠ full stack.
4. Optional: Pinata/Filebase JWT if he wants dashboard-visible pins.

## Public HTTPS

- Box tunnels blocked. GitHub Pages not enabled. `dist/web/` (~45MB) gitignored — static shell possible on Pages later; API still needs a host. See PRODUCT-PREVIEW §静态预览.
