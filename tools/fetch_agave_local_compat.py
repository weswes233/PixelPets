"""Pinned local-only Windows validator; avoids Agave 3+ directory unpack regression."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'v2.3.13'
NAME = 'solana-release-x86_64-pc-windows-msvc.tar.bz2'
EXPECTED = '9d68b2434b9b1857514893f2fed273e727c51f1cc107701f2b66128eb69ad318'
URL = f'https://github.com/anza-xyz/agave/releases/download/{VERSION}/{NAME}'

def main():
    proxy = os.environ.get('HTTPS_PROXY')
    if proxy:
        urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy, 'http': proxy})))
    destination = ROOT / 'runtime' / 'agave-2.3.13'
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / NAME
    if not archive.exists():
        partial = archive.with_suffix('.part')
        with urllib.request.urlopen(URL, timeout=90) as response, partial.open('wb') as output:
            size = 0
            while chunk := response.read(2 * 1024 * 1024):
                output.write(chunk)
                size += len(chunk)
                if size % (10 * 1024 * 1024) == 0:
                    print(f'Downloaded {size // 1024 // 1024} MiB', flush=True)
        partial.replace(archive)
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != EXPECTED:
        raise RuntimeError('Archive digest mismatch; archive not extracted')
    with tarfile.open(archive, 'r:bz2') as package:
        package.extractall(destination, filter='data')
    (destination / 'provenance.json').write_text(json.dumps({'version': VERSION, 'url': URL, 'sha256': actual, 'purpose': 'isolated local integration tests only'}, indent=2), encoding='utf-8')
    print('Verified local compatibility validator extracted.', flush=True)

if __name__ == '__main__':
    main()
