#!/usr/bin/env bash
# DEV/TEMPORARY: pin deploy/metadata into a local kubo node and verify the CIDs match manifest.json.
set -euo pipefail
cd "$(dirname "$0")/.."
export IPFS_PATH="${IPFS_PATH:-/workspace/ipfs-repo}"
IPFS="${IPFS_BIN:-ipfs}"
added=$(for f in deploy/metadata/images/*.png deploy/metadata/json/*.json; do "$IPFS" add --cid-version=1 --pin -Q "$f"; done | sort)
expected=$(node -e 'const m=require("./deploy/metadata/manifest.json");const s=new Set();JSON.stringify(m,(k,v)=>{if(k==="cid")s.add(v);return v});console.log([...s].sort().join("\n"))')
if [ "$added" = "$expected" ]; then echo "PINNED_LOCAL_OK $(echo "$expected" | wc -l) files"; else echo "CID MISMATCH"; diff <(echo "$added") <(echo "$expected"); exit 1; fi
