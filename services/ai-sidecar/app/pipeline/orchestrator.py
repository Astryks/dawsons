"""Runs the analysis stage sequence for a job.

Phase 1 / M4 scope: stems only. Tempo/key/chords/sections (M5) will
extend this to assemble a full Scene-Graph fragment via
app/scene_graph/builder.py; until then this returns a simpler
stems-only result — Rust just needs stem file paths to load as tracks,
not the full schema.
"""

from pathlib import Path
from typing import Callable, Optional

from app.pipeline import stems


def run_analysis(
    input_path: Path,
    out_dir: Path,
    device: str = "cpu",
    on_progress: Optional[Callable[[str, float], None]] = None,
) -> dict:
    if on_progress:
        on_progress("separating_stems", 0.0)

    stem_paths = stems.separate(input_path, out_dir, device=device)

    if on_progress:
        on_progress("separating_stems", 1.0)

    return {"stems": {name: str(path) for name, path in stem_paths.items()}}
