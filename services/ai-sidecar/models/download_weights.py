"""Manual weight-download entry point, for any future model that does NOT
manage its own download/cache.

When this manifest format was first written (before M4), it wasn't yet
clear whether every model would need a hand-rolled URL+sha256 downloader.
Now that M4/M5 have landed, it turns out none currently do: Demucs
(app/pipeline/stems.py), ACE-Step, faster-whisper, and torchcrepe all
resolve and cache their own pretrained weights internally (mostly via the
Hugging Face Hub, which already does real content-addressed, resumable
downloads — reimplementing that here would be strictly worse, not a
missing feature). The manifest below is empty because there is currently
nothing that needs this path.

`manifest.json` originally listed a `demucs-htdemucs` entry pointing at a
guessed direct URL — confirmed wrong (a live request returns HTTP 403;
modern Demucs actually resolves `htdemucs_6s` from the Hugging Face Hub
by default, not a fixed fbaipublicfiles.com URL at all) and never
reachable from any real code path, so it was removed rather than fixed:
fixing it would have re-implemented a mechanism Demucs's own library
already does correctly.

If a future model genuinely ships only as a bare file with no
download/caching of its own, add an entry here — `{name, source_url,
expected_sha256, license, dest_path}` — and this script will fetch it
with real streaming progress and hash verification, using the same
`report_hf_download_progress`-style approach (adapted for a plain HTTP
GET rather than the Hub client) as the models that already report first-
run download progress through `/analyze`'s job status
(see app/pipeline/hf_progress.py and stems.py).

Usage:
    python models/download_weights.py [--cache-dir PATH]
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
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest == expected


def download_all(cache_dir: Path) -> None:
    manifest = load_manifest()
    if not manifest:
        print("Nothing to download — every model currently used manages its own "
              "weight download and caching. See this file's module docstring.")
        return

    import httpx  # imported lazily: not a hard dependency when the manifest is empty

    cache_dir.mkdir(parents=True, exist_ok=True)
    for entry in manifest:
        dest = cache_dir / entry["dest_path"]
        if dest.exists() and verify_sha256(dest, entry["expected_sha256"]):
            print(f"[skip] {entry['name']} already cached at {dest}")
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"[download] {entry['name']} <- {entry['source_url']}")
        with httpx.stream("GET", entry["source_url"], follow_redirects=True) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            downloaded = 0
            tmp_dest = dest.with_suffix(dest.suffix + ".part")
            with tmp_dest.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    downloaded += len(chunk)
                    fraction = (downloaded / total) if total else 0.0
                    print(
                        json.dumps({
                            "event": "model_download_progress",
                            "name": entry["name"],
                            "downloaded": downloaded,
                            "total": total,
                            "fraction": fraction,
                        }),
                        flush=True,
                    )

        if not verify_sha256(tmp_dest, entry["expected_sha256"]):
            tmp_dest.unlink(missing_ok=True)
            raise ValueError(f"{entry['name']}: downloaded file failed sha256 verification")
        tmp_dest.rename(dest)
        print(f"[done] {entry['name']} -> {dest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    args = parser.parse_args()
    download_all(args.cache_dir)
