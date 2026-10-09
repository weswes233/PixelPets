# Handoff (2026-10-10, 02:10 UTC+8)

Branch `feature/travel-devnet-demo`. Status table: `docs/plan/00-today-checklist.md`.

## Done (localnet, verified)
- Server-authoritative travel, checkpoint v2, public proof `jr_…`, independent verifier.
- Godot English-first UI (Travel/Album/Journal/Wallet tabs, 中文 toggle).
- Browser e2e in headless Chrome with a Wallet Standard test wallet: SIWS → claim → trip → reveal → journey receipt confirmed (`docs/evidence/ui-smoke/35–37`).
- Tests: npm 146/146; Godot client 52, travel 26, session 26, HTTP 11; deployed-stack smoke 4 PASS.
- Root cause of the "receipt hang" was an e2e mis-click (the layout shifted); real fix: a `prepared` intent with no signature now shows Save again instead of "Submitted".
- Buffer polyfill for the wallet bundle (a real bug since baseline).

## Ready but blocked
- Devnet deploy: `node tools/devnet-deploy.ts --network devnet` (plan) / `--execute`. Needs about 5 SOL on deployer `294hmkx17KS7ww6CzA6ZeDx2F3o7zybo8txRYRvhW9BU`.
- Public HTTPS: `tools/demo-up.sh start` (cloudflared quick tunnel), but this box blocks egress on 7844/22.
- Metadata: pinned only in local kubo (`tools/pin-metadata-local.sh`); a pinning account is needed for public retrieval of the same CIDs.

## Not done
- P1 gift UI (contract/SDK already exist).

## Overnight update (2026-10-10, ~03:40 UTC+8)
- Devnet: still 0 SOL. Airdrop loop still rate-limited; `devnet-pow` installed, but every on-chain PoW faucet (difficulty 3–8 and 20) holds 0 SOL, so mining can't pay out. Nothing was deployed to Devnet.
- P1 gift UI done (localnet): `runGiftTransaction` in wallet-web (chain-client `prepareGift`, owner-signed Core TransferV1, review dialog, travelling → `GIFT_BLOCKED_TRAVELLING`, success only after finalize + ownership sync). Godot Wallet tab "Send as a gift". Two-wallet e2e `node chain/tests/gift-two-wallet-localnet.mjs` 6 PASS.
- Restart drill: `node chain/tests/restart-recovery-localnet.mjs` 4 PASS.
- Evidence: `docs/evidence/localnet-demo-2026-10-10.json` (localnet only; says so).
- P2: zh toggle checks for travel/gift strings; optional 120-codex silhouette browse in Album.
- Tests: npm 146/146; Godot client 52, travel 43, session 26, HTTP 11.
- Needs Wes: ≈5 devnet SOL; approve program id 2SCKfWsz…; pinning account; HTTPS host/domain; real Phantom/Backpack + second wallet run (incl. gift).
