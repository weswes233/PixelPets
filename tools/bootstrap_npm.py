"""Install a project-local npm from the official registry with integrity verification.
No global installation and no package lifecycle scripts are executed here.
"""
from __future__ import annotations
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "11.6.2"

def main() -> None:
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy, "http": proxy})))
    metadata = json.load(urllib.request.urlopen(f"https://registry.npmjs.org/npm/{VERSION}", timeout=30))
    source = metadata["dist"]["tarball"]
    if not source.startswith("https://registry.npmjs.org/npm/-/"):
        raise RuntimeError("Unexpected npm archive origin")
    archive = urllib.request.urlopen(source, timeout=60).read()
    expected = metadata["dist"]["integrity"]
    actual = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode()
    if actual != expected:
        raise RuntimeError("npm integrity mismatch")
    destination = ROOT / "runtime" / "npm"
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        tar.extractall(destination, filter="data")
    (destination / "provenance.json").write_text(json.dumps({"version": VERSION, "source": source, "integrity": actual}, indent=2), encoding="utf-8")
    print(f"Verified project-local npm {VERSION}; {len(archive)} bytes")

if __name__ == "__main__":
    main()
