"""Fetches pretrained model weights into a local cache directory.

Weights are never committed to git (multi-GB, and every model here has its
own official distribution point). This script reads manifest.json and
downloads anything missing, verifying a SHA-256 hash before trusting it.

Usage:
    python models/download_weights.py [--cache-dir PATH]

Implemented starting at M7 (Phase 1 milestone: real weight-download flow).
Until then, contributors download weights by hand for dev speed; this file
establishes the manifest format and cache-dir convention up front so M4/M5
pipeline code can already assume weights live under a stable path.
"""

import argparse
import hashlib
import json
from pathlib import Path

DEFAULT_CACHE_DIR = Path.home() / ".cache" / "dawsons" / "models"


def load_manifest() -> list[dict]:
    manifest_path = Path(__file__).parent / "manifest.json"
    return json.loads(manifest_path.read_text())


def verify_sha256(path: Path, expected: str) -> bool:
    if expected.startswith("TODO"):
        return True  # placeholder entries in manifest.json, not yet backfilled
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest == expected


def download_all(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    for entry in load_manifest():
        dest = cache_dir / entry["dest_path"]
        if dest.exists() and verify_sha256(dest, entry["expected_sha256"]):
            print(f"[skip] {entry['name']} already cached at {dest}")
            continue
        # Actual download (torch.hub / httpx streaming) lands with M7; for now
        # this documents the expected interface so pipeline code can be
        # written against it ahead of time.
        raise NotImplementedError(
            f"Download logic for {entry['name']} not yet implemented (M7). "
            f"For now, place the weight file at {dest} by hand."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    args = parser.parse_args()
    download_all(args.cache_dir)
