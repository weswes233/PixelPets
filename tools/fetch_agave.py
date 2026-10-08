"""Fetch the pinned official Windows Agave archive into this project only."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "v4.3.0"
NAME = "solana-release-x86_64-pc-windows-msvc.tar.bz2"
EXPECTED = "27d598632589970a0516a631aae6f91dcba2a072bdc2a32f9a7f547eae7d726e"
URL = f"https://github.com/anza-xyz/agave/releases/download/{VERSION}/{NAME}"

def main():
    proxy = os.environ.get("HTTPS_PROXY")
    if proxy:
        urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy, "http": proxy})))
    destination = ROOT / "runtime" / "agave"
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / NAME
    if not archive.exists():
        partial = archive.with_suffix('.part')
        with urllib.request.urlopen(URL, timeout=90) as response, partial.open('wb') as output:
            size = 0
            while chunk := response.read(2 * 1024 * 1024):
                output.write(chunk); size += len(chunk)
                if size % (20 * 1024 * 1024) == 0: print(f"Downloaded {size // 1024 // 1024} MiB", flush=True)
        partial.replace(archive)
    actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if actual != EXPECTED: raise RuntimeError('Archive digest mismatch; archive not extracted')
    print('SHA-256 verified. Extracting project-local tools.', flush=True)
    with tarfile.open(archive, 'r:bz2') as package:
        package.extractall(destination, filter='data')
    (destination / 'provenance.json').write_text(json.dumps({'version': VERSION, 'url': URL, 'sha256': actual}, indent=2), encoding='utf-8')
    print('Agave extraction complete.', flush=True)

if __name__ == '__main__': main()
