#!/usr/bin/env bash
# TEMPORARY public demo: API + web on loopback, exposed through a free Cloudflare *quick tunnel* (random trycloudflare.com URL,
# no account, no uptime guarantee, changes on every restart). Not a production deployment.
# Chain features are enabled only if runtime/devnet-chain.env exists (written by tools/devnet-deploy.ts --execute).
# Usage: tools/demo-up.sh [start|local|stop|status]   (local = same stack on http://127.0.0.1:9783 without a tunnel)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; RUN="$ROOT/runtime/demo"; mkdir -p "$RUN"
PIDS="$RUN/pids"; URLF="$RUN/demo-url.txt"
stop() { [ -f "$PIDS" ] && while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDS"; rm -f "$PIDS" "$URLF"; echo stopped; }
case "${1:-start}" in
  stop) stop; exit 0 ;;
  status) cat "$URLF" 2>/dev/null || echo "not running"; exit 0 ;;
esac
stop >/dev/null
MODE="${1:-start}"
if [ "$MODE" = "local" ]; then URL="http://127.0.0.1:9783"; else
: > "$RUN/cloudflared.log"
nohup cloudflared tunnel --no-autoupdate --protocol "${TUNNEL_PROTOCOL:-http2}" --url http://127.0.0.1:9783 > "$RUN/cloudflared.log" 2>&1 & echo $! >> "$PIDS"
URL=""
for _ in $(seq 1 60); do URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/cloudflared.log" | head -1 || true)"; [ -n "$URL" ] && break; sleep 1; done
[ -n "$URL" ] || { echo "quick tunnel did not start; see $RUN/cloudflared.log"; stop; exit 1; }
fi
CHAIN_ENV="$ROOT/runtime/devnet-chain.env"
(
  set -a; [ -f "$CHAIN_ENV" ] && . "$CHAIN_ENV"; set +a
  export PIXELPETS_DB="${DEMO_DB:-$RUN/pets-demo-devnet.sqlite}" PUBLIC_ORIGIN="$URL" CHAIN_NETWORK="${CHAIN_NETWORK:-devnet}" \
    TRAVEL_DURATION_MS="${TRAVEL_DURATION_MS:-45000}" TRUSTED_PROXY_IPS=127.0.0.1 PORT=9782 HOST=127.0.0.1
  nohup node "$ROOT/server/src/index.ts" > "$RUN/api.log" 2>&1 & echo $! >> "$PIDS"
  SERVE_FORWARD_CLIENT_IP=1 WEB_PORT=9783 API_PORT=9782 nohup node "$ROOT/tools/serve.ts" > "$RUN/web.log" 2>&1 & echo $! >> "$PIDS"
)
for _ in $(seq 1 60); do curl -sf -m 3 http://127.0.0.1:9783/api/v1/health >/dev/null && break; sleep 1; done
echo "$URL" > "$URLF"
if [ "$MODE" = "local" ]; then echo "local demo: $URL"; else
  for _ in $(seq 1 30); do grep -q "Registered tunnel connection" "$RUN/cloudflared.log" && break; sleep 1; done
  grep -q "Registered tunnel connection" "$RUN/cloudflared.log" || echo "WARNING: tunnel URL assigned but no edge connection registered (outbound 7844 blocked?) — URL will return 530"
  echo "TEMPORARY demo URL (Cloudflare quick tunnel, changes on restart): $URL"; fi
echo "chain: $([ -f "$CHAIN_ENV" ] && echo "enabled from runtime/devnet-chain.env" || echo "disabled (Devnet not deployed yet)")"
