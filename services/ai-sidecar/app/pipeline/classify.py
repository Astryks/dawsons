"""Clip classification for the "smart upload" feature: given an arbitrary
audio clip, figure out which instrument layer it belongs in (or that it
needs a brand new layer), so a user can just drop a sound in without
knowing anything about tracks or stems themselves.

Approach: run the same Demucs separation used for full song analysis on
the clip, then compare each stem's RMS energy. Demucs was trained to
separate a *mix* into vocals/drums/bass/guitar/piano/other, so when the
input is already a single, mostly-isolated sound, almost all of the
energy should land in whichever stem matches it — a clean drum hit comes
back overwhelmingly in the "drums" stem, a solo guitar line in "guitar",
and so on. That energy ratio doubles as a confidence score for free,
without training or bundling a separate classifier model.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

from app.pipeline.stems import separate

# Demucs' catch-all bucket for anything that isn't voice/drums/bass/
# guitar/piano — a clip landing here mostly by itself doesn't map cleanly
# onto an existing layer, so it's treated as "make a new layer" rather
# than mislabeling it.
_CATCH_ALL_STEM = "other"

# Below this dominant-stem energy share, the clip's energy is too spread
# out across stems to trust a single-layer suggestion.
_CONFIDENCE_FLOOR = 0.45


def _rms(path: Path) -> float:
    data, _sr = sf.read(path, dtype="float32", always_2d=True)
    if data.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(data))))


def classify_clip(input_path: Path, out_dir: Path, device: str = "cpu") -> dict:
    """Separates `input_path` and scores which stem dominates it.

    Returns a dict shaped for direct JSON/Tauri consumption:
    `{"suggested_layer": str | None, "confidence": float,
      "energies": {stem: share}, "stem_paths": {stem: path},
      "new_layer": bool}`.
    `suggested_layer` is None (and `new_layer` True) when nothing clearly
    dominates, or the dominant stem is Demucs' generic "other" bucket.
    """
    stem_paths = separate(input_path, out_dir, device=device)

    energies = {name: _rms(path) for name, path in stem_paths.items()}
    total = sum(energies.values())
    shares = {name: (e / total if total > 0 else 0.0) for name, e in energies.items()}

    dominant_stem: str | None = max(shares, key=shares.get) if shares else None
    dominant_share = shares.get(dominant_stem, 0.0) if dominant_stem else 0.0

    suggests_new_layer = (
        dominant_stem is None
        or dominant_share < _CONFIDENCE_FLOOR
        or dominant_stem == _CATCH_ALL_STEM
    )

    return {
        "suggested_layer": None if suggests_new_layer else dominant_stem,
        "confidence": round(dominant_share, 3),
        "energies": {name: round(share, 3) for name, share in shares.items()},
        "stem_paths": {name: str(path) for name, path in stem_paths.items()},
        "new_layer": suggests_new_layer,
    }
