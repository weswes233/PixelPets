#!/usr/bin/env bash
# Linux build of the Anchor program with the pinned Anchor 0.32.1 CLI.
# The default platform-tools (v1.51, cargo 1.84) cannot parse edition2024 crates in chain/Cargo.lock,
# so the SBF build uses platform-tools v1.57. The IDL is generated separately and must equal chain/idl.
set -euo pipefail
cd "$(dirname "$0")/../chain"
TOOLS_VERSION="${PIXELPETS_SBF_TOOLS_VERSION:-v1.57}"
anchor build --no-idl -- --tools-version "$TOOLS_VERSION"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
anchor idl build -o "$tmp/pixel_pets.json" -t "$tmp/pixel_pets.ts" >/dev/null
node -e "const a=require('$tmp/pixel_pets.json'),b=require('./idl/pixel_pets.json');if(JSON.stringify(a)!==JSON.stringify(b)){console.error('IDL differs from chain/idl/pixel_pets.json');process.exit(1)}"
sha256sum target/deploy/pixel_pets.so
echo "program id (IDL): $(node -p "require('./idl/pixel_pets.json').address")"
if [ -f target/deploy/pixel_pets-keypair.json ]; then echo "deploy key pubkey: $(solana-keygen pubkey target/deploy/pixel_pets-keypair.json)"; fi
