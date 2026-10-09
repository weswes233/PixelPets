#!/usr/bin/env bash
# Linux runner for the headless Godot suites (client, travel, session storage, HTTP).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; G="${PIXELPETS_GODOT_PATH:?set PIXELPETS_GODOT_PATH}"
cd "$ROOT/game"
"$G" --headless --path . --import >/dev/null 2>&1 || true
for t in client_test travel_test; do "$G" --headless --path . --script "tests/$t.gd" -- --client-test 2>&1 | grep -E "^PixelPets" ; done
"$G" --headless --path . --script tests/session_storage_test.gd -- --session-storage-test 2>&1 | grep -E "^PixelPets" || true
node "$ROOT/tools/test-godot-http.mjs" 2>&1 | grep -E "^PixelPets"
