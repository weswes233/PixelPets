#!/usr/bin/env bash
# Linux helper: isolated, disposable solana-test-validator for PixelPets integration tests.
# Uses RPC 127.0.0.1:8999 so it never touches a developer validator on 8899. Never reads the default wallet.
# Usage: tools/local-chain.sh start [--bare] | test contract|service|ownership | stop | status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/runtime"; STATE="$RUNTIME/local-chain-linux.json"
ADMIN="$RUNTIME/chain-fixtures/local-admin.keypair.json"; CORE_SO="$RUNTIME/chain-fixtures/mpl_core.so"
PROGRAM_SO="$ROOT/chain/target/deploy/pixel_pets.so"; RPC="http://127.0.0.1:8999"
CORE_ID=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
rpc() { curl -s -m 2 -H "content-type: application/json" -d "$1" "$RPC" || true; }
start() {
  local bare="${1:-}"
  [ -f "$PROGRAM_SO" ] || { echo "missing $PROGRAM_SO (run tools/build-chain.sh)"; exit 1; }
  [ -f "$CORE_SO" ] || { echo "missing $CORE_SO (solana program dump $CORE_ID from devnet)"; exit 1; }
  mkdir -p "$(dirname "$ADMIN")"; [ -f "$ADMIN" ] || solana-keygen new --no-bip39-passphrase --silent -o "$ADMIN" >/dev/null
  if rpc '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q result; then echo "port 8999 already serving; refusing"; exit 1; fi
  local admin program run
  admin="$(solana-keygen pubkey "$ADMIN")"; program="$(node -p "require('$ROOT/chain/idl/pixel_pets.json').address")"
  run="$RUNTIME/validator-linux-$(date -u +%Y%m%d-%H%M%S)-$RANDOM"; mkdir -p "$run"
  RUST_LOG=warn nohup solana-test-validator --ledger "$run/ledger" --bind-address 127.0.0.1 --rpc-port 8999 \
    --faucet-port 9911 --gossip-port 9101 --dynamic-port-range 9200-9260 --mint "$admin" \
    $([ "$bare" = "--bare" ] || echo --upgradeable-program "$program" "$PROGRAM_SO" "$admin") --bpf-program "$CORE_ID" "$CORE_SO" \
    --limit-ledger-size 5000000 > "$run/stdout.log" 2> "$run/stderr.log" &
  local pid=$!
  for _ in $(seq 1 300); do
    kill -0 "$pid" 2>/dev/null || { echo "validator exited; see $run"; exit 1; }
    local genesis slot
    genesis="$(rpc '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result??"")}catch{console.log("")}})')"
    slot="$(rpc '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"finalized"}]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result??0)}catch{console.log(0)}})')"
    if [ -n "$genesis" ] && [ "$slot" -ge 2 ]; then
      printf '{"pid":%s,"run":"%s","rpc":"%s","genesis":"%s","program":"%s","admin":"%s"}\n' "$pid" "$run" "$RPC" "$genesis" "$program" "$admin" > "$STATE"
      echo "ready genesis=$genesis pid=$pid"; return 0
    fi
    sleep 0.5
  done
  echo "validator not ready"; exit 1
}
field() { node -p "require('$STATE').$1"; }
case "${1:-}" in
  start) start "${2:-}" ;;  # --bare: Core only, PixelPets not preloaded (deploy rehearsal)
  stop) [ -f "$STATE" ] && { pid="$(field pid)"; run="$(field run)"; if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "$run/ledger"; then kill "$pid"; fi; rm -f "$STATE"; echo stopped; } ;;
  status) cat "$STATE" ;;
  test)
    export PIXELPETS_TEST_RPC="$RPC" PIXELPETS_EXPECTED_GENESIS="$(field genesis)" PIXELPETS_TEST_ADMIN="$ADMIN"
    case "${2:-}" in
      contract) node "$ROOT/chain/tests/local-validator-e2e.mjs" ;;
      service) PIXELPETS_SERVICE_SCENARIO=checkpoint node "$ROOT/chain/tests/service-e2e.mjs" ;;
      ownership) PIXELPETS_SERVICE_SCENARIO=ownership node "$ROOT/chain/tests/service-e2e.mjs" ;;
      journey) PIXELPETS_SERVICE_SCENARIO=journey node "$ROOT/chain/tests/service-e2e.mjs" ;;
      deployed) node "$ROOT/chain/tests/deployed-stack-smoke.mjs" ;;  # after: start --bare + tools/devnet-deploy.ts --network localnet --execute
      *) echo "test contract|service|ownership"; exit 2 ;;
    esac ;;
  *) echo "usage: $0 start|test <kind>|stop|status"; exit 2 ;;
esac
