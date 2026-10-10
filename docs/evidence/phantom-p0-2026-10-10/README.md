# Phantom P0 QA — 2026-10-10 (public demo)

Public URL: https://175.178.27.231/ (self-signed TLS).
Test wallet **player-a** (not Wes personal): `5wpnLLhKQhaLE5zYouZHQYmrrcwN3s2u9uPWLbFvjdow`.

## Results

| Step | Result |
| --- | --- |
| Connect + SIWS | PASS (real Phantom) |
| Travel + postcard + refresh | PASS (earlier run) |
| Claim on Devnet | PASS |
| Journey receipt | PASS |

## Claim

- Sig: `547q8DdRfxtyV7R5qV259Ar8gysruYDdyRB5m7mNqnMpDKSPziyWsLmM9XFSCXajXgp6LoahfWtcpspVeSe8q6iv`
- Explorer: https://explorer.solana.com/tx/547q8DdRfxtyV7R5qV259Ar8gysruYDdyRB5m7mNqnMpDKSPziyWsLmM9XFSCXajXgp6LoahfWtcpspVeSe8q6iv?cluster=devnet
- Asset: `BbJDvrJYN6MR5Xtf1xBBe9FmqQCFANEPLZCu1sRW5mF9` (Moss)

## Journey receipt

- Proof id: `jr_UdRHkunr7zDblzK8Ae1dZg`
- Sig: `5gYhD9c4h2EKLM11H4x5HifmvRvxDg2Pp98jQeDzQ3fX5EpqGbQRBEofby5VoZZe4xxGNRorB4Sj7X64BmxonsfZ`
- Explorer: https://explorer.solana.com/tx/5gYhD9c4h2EKLM11H4x5HifmvRvxDg2Pp98jQeDzQ3fX5EpqGbQRBEofby5VoZZe4xxGNRorB4Sj7X64BmxonsfZ?cluster=devnet

## Ops note

Browser RPC uses same-origin `https://175.178.27.231/solana-rpc` (Caddy → Helius) because public Devnet endpoints were blocked or dropped txs from the QA browser egress.

JSON: `phantom-p0-claim-trip-v3.json`. Screenshots: `screens/v3-*`.

## Gift UI web rebuild

Stale `index.pck` (02:05 CST) lacked gift UI added to `main.gd` at 02:19. Rebuilt and redeployed at **17:03–17:17 CST**; live pck `Content-Length: 7798332`. Details: `web-rebuild-gift-ui.md`.
