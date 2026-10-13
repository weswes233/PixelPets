# PixelPets cloud deploy — 2026-10-10

## Public URL

- **Intended:** `https://175.178.27.231/`
- Browser will warn (self-signed cert). Accept the warning for the hackathon demo.
- `PUBLIC_ORIGIN=https://175.178.27.231` (HTTPS required by API; bare `http://IP` will crash).

## Status (CST / Asia/Shanghai)

| Check | Result |
|--------|--------|
| Docker stack on server | **Up** — `pixelpets-api-1` healthy, `pixelpets-web-1` serving :80/:443 |
| Chain | **Enabled** — Devnet, program `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`, collection `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS` |
| Local HTTPS health | OK via `curl -sk https://127.0.0.1/api/v1/health` on the VM |
| Host UFW | Active — allow 22, 80, 443/tcp+udp, 1666 (existing Perforce) |
| External :80 | Reachable (301 → HTTPS) |
| External :443 | **OPEN** (Wes opened Tencent SG TCP 443; verified 2026-10-10 afternoon CST) |
| Let's Encrypt / sslip.io | Failed — LE TLS-ALPN timed out on :443; HTTP-01 hit Tencent DNSPod webblock for `*.sslip.io` (566). Fell back to self-signed cert for `175.178.27.231`. |

Public HTTPS works after Wes opened TCP 443 in the Tencent security group (verified `curl -sk https://175.178.27.231/api/v1/health` → 200, `chain.configured=true`). Certificate remains **self-signed** — browsers show a warning; choose Advanced → Continue.

## Health JSON (local on VM)

```json
{"ok":true,"data":{"service":"pixel-pets","storage":"sqlite","chain":{"network":"devnet","configured":true,"program_id":"2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT"},"ai":{"configured":false}}}
```

Chain config also reports `enabled: true`, `market_enabled: true`, issuer `Cf6QfJVbeVPdzLJCShJozFuFtyjuSGAUtRJzrvwKoTxX`.

## Layout on server

- App root: `/opt/pixelpets`
- Compose: `/opt/pixelpets/deploy/compose.yaml` + `compose.override.yaml` (chain + issuer mount + TLS files)
- Env: `/opt/pixelpets/deploy/.env` (`DOMAIN=175.178.27.231`, ACME email unused after LE fallback)
- Issuer key: `/opt/pixelpets/runtime/issuer.json` mode `600`, mounted at `/run/secrets/issuer.json` in API
- TLS: `/opt/pixelpets/deploy/tls/{cert,key}.pem` (self-signed, SAN IP+DNS `175.178.27.231`)
- SQLite: Docker volume `pixelpets_pets-data`
- Existing Perforce on host `:1666` left running

## Deploy notes / patches applied on server (not necessarily in git)

1. `API.Dockerfile`: `npm ci` → `npm install` (Node 24 npm rejected lockfile missing optional `bufferutil` / `utf-8-validate`).
2. `compose.yaml` tmpfs short-options form broke Docker 27 (`noexec` parsed as path) → `tmpfs: [/tmp]`.
3. Caddyfile `encode … match { header Content-Type a b c }` invalid on Caddy 2 → plain `encode zstd gzip`.
4. GitHub clone from Guangzhou timed out; tree rsynced from box (branch `feature/travel-devnet-demo` artifacts + `dist/web`).
5. Helius Devnet RPC used for `CHAIN_RPC_URL` (server-side); public CSP origin `https://devnet.helius-rpc.com`.

## Restart / rebuild

```bash
ssh -i /home/box/.ssh/pixelpets_deploy -o IdentitiesOnly=yes -o BatchMode=yes ubuntu@175.178.27.231
cd /opt/pixelpets/deploy
sudo docker compose -f compose.yaml -f compose.override.yaml ps
sudo docker compose -f compose.yaml -f compose.override.yaml restart
# full rebuild:
sudo docker compose -f compose.yaml -f compose.override.yaml up -d --build
# logs:
sudo docker logs -f pixelpets-api-1
sudo docker logs -f pixelpets-web-1
# local smoke (on VM; hairpin to public IP often fails):
curl -sk https://127.0.0.1/api/v1/live
curl -sk https://127.0.0.1/api/v1/health
curl -sk https://127.0.0.1/api/v1/chain/config
```

## Wes action required

1. **Tencent security group:** allow inbound **TCP 80**, **TCP 443**, **UDP 443** from `0.0.0.0/0` (or demo audience CIDRs). Host UFW already allows them; the cloud SG is what blocks external :443 today.
2. Optional later: point a real domain at the IP and restore Let's Encrypt (avoid sslip.io / nip.io under Tencent DNSPod webblock), then revert Caddy to ACME and drop self-signed files.

## Security reminders

- Do not commit `runtime/issuer.json`, `deploy/compose.override.yaml` (contains RPC secrets), or `deploy/tls/key.pem`.
- Issuer and override are mode `600` on the server.
