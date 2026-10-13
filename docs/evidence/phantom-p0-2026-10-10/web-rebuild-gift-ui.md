# Web rebuild — Gift UI in Godot pck (2026-10-10)

## Problem

Public demo `https://175.178.27.231/index.pck` was still the **02:05 CST** export (`Content-Length: 7750836`, Last-Modified `Fri, 09 Oct 2026 18:05:12 GMT`). Gift UI landed in `game/scripts/main.gd` at **02:19 CST**. `bridge.js` already handled method `gift`; the packaged `scripts/main.gdc` did not call it. Phantom P0 claim + journey receipt already PASS; gift UI was missing.

## Rebuild (box)

- Branch: `feature/travel-devnet-demo`
- Godot: `/workspace/godot/Godot_v4.5.2-stable_linux.x86_64`
- Template: `runtime/web_nothreads_release.zip` (preset `Web`)
- Commands:
  - `$GODOT --headless --path game --export-release "Web" ../dist/web/index.html`
  - `node tools/build-web.mjs`
- New `dist/web/index.pck`: **7798332** bytes, mtime **2026-10-10 17:03 CST**
- SHA-256: `2cf6ce36f0d7101953151a28f1b81b1b5c8c38fd63b7911aedd5016006af7bf9`
- Decompressed GDSC strings present in `scripts/main.gdc` / `scripts/i18n.gdc`: `作为礼物送出`, `接收者钱包地址`, `Send as a gift`, `送给朋友`, `gifted`

## Deploy

- Host: `ubuntu@175.178.27.231`, app `/opt/pixelpets`
- Synced `dist/web` (wasm unchanged SHA-256 `6ead2ac5…45240`)
- `docker compose -f compose.yaml -f compose.override.yaml build web && up -d --no-deps --force-recreate web`
- Kept bind mounts: `deploy/Caddyfile`, TLS certs, caddy volumes (`/solana-rpc` proxy intact)

## Verify

```text
curl -skI https://175.178.27.231/index.pck
# HTTP/2 200
# content-length: 7798332
# last-modified: Sat, 10 Oct 2026 09:17:05 GMT
```

Live pck SHA-256 matches local build. Homepage / bridge.js / `POST /solana-rpc` (getHealth) → HTTP 200.

Phantom gift flow **not** re-executed in this rebuild step (parent owns that QA).
