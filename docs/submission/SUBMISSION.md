# PixelPets — Hackathon submission text

Copy/paste-ready fields for the Colosseum / Solana hackathon form. Update the demo video URL after upload.

## Project name

**PixelPets** (中文名：掌心伙伴)

## Tagline

**A tiny companion. A world of stories. Collect the journey.**

会替你出门的像素伙伴，以及可以交换的旅途收藏。

## Short description (≤280 chars)

Pixel companions you adopt for free, send on short trips for postcards & keepsakes, then optionally claim on Solana Devnet (Metaplex Core) and save a verifiable journey receipt. No project token — play first, chain when you choose.

## Long description

PixelPets is a cozy pixel-pet game built for people who like Travel Frog–style anticipation and light collecting — not for people hunting a token chart.

**Player loop**
1. Adopt Moss, Puddle, or Wisp for free (no wallet, no mint).
2. Care on a soft schedule; bond unlocks sun/moon forms.
3. Pack a bag, pick a place, send them out (demo trips are explicitly time-accelerated).
4. They return with a postcard story and maybe a keepsake in your Album.
5. When ready, connect a Solana wallet, claim a Metaplex Core companion on **Devnet**, and save a **checkpoint v2** journey receipt you can open on Explorer.
6. Gift the companion; the recipient syncs ownership and keeps caring.

**What lives where**
- Godot 4.5.2 Web client: art, care UI, travel/postcard, album.
- Node 24 + SQLite server: authoritative care, supplies, travel RNG, sessions.
- Anchor program + Metaplex Core on Solana Devnet: limited editions, claim, PetRecord hashes, gifts/transfers.
- Wallet Standard bridge: SIWS and reviewed transactions (scripted test wallet verified; real Phantom/Backpack QA pending).

**Honesty**
- Devnet only today; assets have no cash value.
- Travel randomness is server-side and labelled; the chain stores a hash of the settled result.
- No project token by design (free non-redeemable supplies).
- Public HTTPS full-stack host and real extension-wallet popups are still open items for the owner.

Repo: https://github.com/weswes233/PixelPets · Branch: `feature/travel-devnet-demo` · Draft PR: https://github.com/weswes233/PixelPets/pull/1

## Problem

Fragmented players still want a tiny ongoing relationship and something worth collecting or gifting — but most “chain pets” lead with speculation, confusing wallets, or empty JPEGs. Mild pet games (Travel Frog, Neopets cosmetics) prove the emotion; Solana can prove ownership and journey provenance without putting every feed on-chain.

## Solution

Ship the emotion loop first (adopt → travel → postcard → album), keep daily care off-chain for UX, and use Solana for **optional identity, journey receipts, and gifts**. Monetization target is later fixed cosmetics / theme packs and peer trades — not a casino wrapped as a pet.

## Tech stack

- Godot 4.5.2 (Web export)
- TypeScript / Node 24, SQLite
- Solana + Anchor 0.32 + Metaplex Core
- Wallet Standard (`@wallet-standard/*`, `@solana/wallet-standard-features`)
- Optional Helius Devnet RPC (server-side)

## On-chain components

| Component | Address / id | Notes |
| --- | --- | --- |
| Program | `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` | Devnet; Wes approval needed vs old declare_id |
| Collection | `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS` | Metaplex Core |
| Editions | moss 1001 / puddle 1002 / wisp 1003 | max supply 20 (demo) |
| Sample claim tx | `5RX2AWhv…7pu7NcT` | Scripted smoke |
| Sample receipt tx | `2WtTemMx…YKZC5mix` | checkpoint v2 |
| Public proof | `jr_eIE4lv-XhPMvy0bgFLcUTw` | Independent verifier 10/10 |
| Sample gift tx | `5ZNrPvAM…HEe9UW2` | Two-wallet scripted |

Evidence JSON: `docs/evidence/devnet-demo-2026-10-10.json`

## Links

- GitHub: https://github.com/weswes233/PixelPets
- Draft PR: https://github.com/weswes233/PixelPets/pull/1
- Product preview: `docs/plan/PRODUCT-PREVIEW.md`
- Program Explorer: https://explorer.solana.com/address/2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT?cluster=devnet
- Collection Explorer: https://explorer.solana.com/address/5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS?cluster=devnet
- Demo video: **[PLACEHOLDER — upload /workspace/PixelPets-demo.mp4 then paste public URL]**

## Team

- **Wes** / [weswes233](https://github.com/weswes233) — owner, product, Windows/Devnet ops
- Built with Grok coding agents on the one-day travel + Devnet track

## Demo video placeholder

```
Demo video URL: <PASTE AFTER UPLOAD to Streamable/YouTube/GitHub release>
Local / repo: docs/evidence/demo/PixelPets-demo.mp4 · box: /workspace/PixelPets-demo.mp4
Local path: /workspace/PixelPets-demo.mp4
Notes in captions: scripted Wallet Standard test wallet; TRAVEL_DURATION_MS=10000 for recording; Devnet only
```

## What's next

1. Wes approves program id `2SCKfWsz…` and runs Phantom claim + receipt on Devnet.
2. Public HTTPS single-instance host (Caddy + Node + SQLite); box tunnels blocked.
3. Optional Pinata/Filebase dashboard pins (Lighthouse/Irys already hold matching CIDs).
4. More routes/stories; keepsake exchange intent; English/Chinese polish.
5. Fixed cosmetic packs only after unpaid retention signals — still no project token by default.
