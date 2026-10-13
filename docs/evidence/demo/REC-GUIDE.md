# PixelPets — recording guide (latest, 2026-10-10 evening CST)

For Colosseum: silent gameplay source ≤ ~2:40; pitch ≤ 2:00. English VO layered later.

## 1. Live status

| Item | Status |
| --- | --- |
| Public demo | **UP** — https://175.178.27.231/ |
| Health | `chain.configured=true`, program `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` |
| TLS | Self-signed — browser must click Advanced → Continue |
| Browser RPC | Same-origin `https://175.178.27.231/solana-rpc` (do not use bare Helius in the client) |
| Gift UI | Present in current `index.pck` (~7.8MB) |
| Known nits | In-game review dialog expires if you wait; click Continue quickly. English care messages now use Moss/Puddle/Wisp for default CN nicknames. |

**Local fallback:** branch `feature/travel-devnet-demo`, `./tools/demo-up.sh local` → http://127.0.0.1:9783/

## 2. Recommended shot list (demo ~2:30–2:50)

| # | Shot | Notes |
| --- | ---: | --- |
| 1 | URL bar + cert warning → Continue | Honest about self-signed |
| 2 | Home / adopt Moss (or open existing) | Cute pixel art |
| 3 | Connect Phantom → SIWS Confirm | Real extension popup |
| 4 | Claim on Devnet → in-game review (fast) → Phantom Confirm Transaction | Show −0.006 SOL fee |
| 5 | Claimed on Devnet | Asset owned |
| 6 | Pack & Travel (Sunny Market) → away timer | **Default ~45s**; for tighter cut set `TRAVEL_DURATION_MS=15000` and caption it |
| 7 | Postcard + keepsake | Album flash OK |
| 8 | Save journey receipt → Phantom Confirm | |
| 9 | Refresh (F5) → reconnect → pet still there | Persistence |
| 10 | Optional: Gift → second wallet Sync → Feed | Strong differentiator |
| 11 | End card: Explorer links + program/collection | See §4 |

**Pitch (~90–110s):** problem (speculation pets) → emotion loop → optional chain identity/receipt/gift → Devnet honesty → live URL.

## 3. Phantom Devnet setup

1. Phantom → Settings → Developer Settings → Testnet Mode → Solana **Devnet**
2. ≥ 0.05 SOL on the recording wallet
3. Prefer a dedicated test wallet (not personal mainnet funds)
4. After each Phantom Confirm, wait for UI “Confirmed / Claimed” before next click

## 4. End-card IDs (current Devnet)

- Program: `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`
- Collection: `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS`
- Sample claim: https://explorer.solana.com/tx/547q8DdRfxtyV7R5qV259Ar8gysruYDdyRB5m7mNqnMpDKSPziyWsLmM9XFSCXajXgp6LoahfWtcpspVeSe8q6iv?cluster=devnet
- Sample receipt: https://explorer.solana.com/tx/5gYhD9c4h2EKLM11H4x5HifmvRvxDg2Pp98jQeDzQ3fX5EpqGbQRBEofby5VoZZe4xxGNRorB4Sj7X64BmxonsfZ?cluster=devnet
- Sample gift: https://explorer.solana.com/tx/2kYtGeuaphnTQtb4SnbaD9fgw3d3gfh6z5abzHEZ2chfjUJyG8dWkzUcUPnsuW5smcHCEfco4Z1AMeexK6zWiPpw?cluster=devnet

Do **not** use older program `Huv1rw3…`.

## 5. Stills / prior silent sources

- Verified Phantom stills: `docs/evidence/phantom-p0-2026-10-10/screens/`
- Rec pack copies: `docs/evidence/demo/rec-pack/stills/`
- Older scripted silent demo: `docs/evidence/demo/PixelPets-demo.mp4` (captioned scripted wallet; superseded for “real Phantom” claim)
- Product UI smoke: `docs/evidence/ui-smoke/`

## 6. Captions to keep honest

- Solana **Devnet** only; no cash value
- Self-signed HTTPS for the hackathon host
- If travel timer shortened for recording, say so (product default 45s)
- If any segment uses a scripted wallet, say so (prefer real Phantom for new cut)
