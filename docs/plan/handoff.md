# Handoff (2026-10-10, 10:20 UTC+8)

Branch `feature/travel-devnet-demo`. Status table: `docs/plan/00-today-checklist.md`.

## Devnet deploy (done this morning)

- Deployer `294hmkx17KS7ww6CzA6ZeDx2F3o7zybo8txRYRvhW9BU` funded with 5 SOL (transfer `38c6KpY5…XA4qp`).
- `node tools/devnet-deploy.ts --network devnet --rpc https://api.devnet.solana.com --execute` succeeded.
  - Program: `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` (deploy sig `5dtmhPyR…xpWj`)
  - Collection: `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS`
  - Editions: moss=1001, puddle=1002, wisp=1003
  - Spent ≈2.9088 SOL; deployer after deploy ≈2.0912 SOL; after funding players ≈1.9912 SOL
- Funded player-a / player-b with 0.05 SOL each.
- Scripted Devnet smoke (`chain/tests/devnet-stack-smoke.mjs`) 4 PASS: claim → trip → reveal → journey receipt → independent verifier 10 checks.
  - Claim sig `5RX2AWhv…7NcT`, asset `B8qGUnAsf2uaqVL8TiEMdq4myPEEtLR59cSJjvGzRSs5`
  - Journey receipt sig `2WtTemMx…5mix`, public proof `jr_eIE4lv-XhPMvy0bgFLcUTw`
- Evidence: `docs/evidence/devnet-demo-2026-10-10.json` (network=devnet, explorer links), `docs/evidence/devnet-deploy-2026-10-10.json`, `chain/evidence/deployed-stack-smoke-devnet.json`.
- Runtime env `runtime/devnet-chain.env` (gitignored, 0600). Server-side may use Helius; browser/public stays on `https://api.devnet.solana.com`. Never put api-key in public URLs.

## Still needs Wes

1. Approve program id `2SCKfWsz…Qm2nT` (original `2R4P5J6r…` key not on this box).
2. Metadata pinning account (CIDs only in local kubo today).
3. Public HTTPS host/domain (box egress 7844/22 blocked).
4. Real Phantom/Backpack + second-wallet Devnet run (incl. gift). Scripted wallet flow is done.

## Done earlier (localnet, still valid)

- Server-authoritative travel, checkpoint v2, public proof `jr_…`, independent verifier.
- Godot English-first UI; P1 gift UI; restart recovery.
- Browser e2e with Wallet Standard test wallet on localnet.
- Tests (last overnight check): npm 146/146; Godot client 52, travel 43, session 26, HTTP 11.
- Localnet evidence: `docs/evidence/localnet-demo-2026-10-10.json`.

## Not done / blocked

- Public HTTPS demo URL.
- Public metadata retrieval (pinning).
- Real extension-wallet Devnet recording.
- Devnet gift two-wallet run (player-b is funded and ready).
