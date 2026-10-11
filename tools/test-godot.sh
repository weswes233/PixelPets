#!/usr/bin/env bash
# Compatibility entrypoint; the portable runner propagates every suite's failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; G="${PIXELPETS_GODOT_PATH:?set PIXELPETS_GODOT_PATH}"
export PIXELPETS_GODOT_PATH="$G"
node "$ROOT/tools/test-godot.mjs"
