"""Sidecar runtime configuration.

The desktop app spawns this process and reads its bound port from the single
JSON status line it prints to stdout on startup (see app/main.py) — no
config file is needed for that handshake. This module just centralizes the
few knobs the sidecar itself needs.
"""

import os
from pathlib import Path

# Working directory shared with the Rust backend for a given project's
# analysis jobs (input copies, Demucs output stems, etc). Passed by the
# parent process; falls back to a local temp dir for standalone dev runs.
WORK_DIR = Path(os.environ.get("DAWSONS_WORK_DIR", Path.cwd() / ".dawsons-work"))

SIDECAR_VERSION = "0.1.0"


def detect_device() -> str:
    """Best available torch device — Demucs inference time varies a lot by
    device, so both /health and /analyze want to know this."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
