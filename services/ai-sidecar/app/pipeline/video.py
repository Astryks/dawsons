"""Video-container input support.

The analysis pipeline (stems.py / tempo_key.py / chords.py / sections.py)
expects a plain audio file. Desktop app users sometimes point "Upload
song…" at a video file instead (e.g. gameplay/vlog footage with a music or
vocal track mixed in) — rather than rejecting that outright, we extract
the audio track with `ffmpeg` into a WAV first and feed that into the
existing, unmodified pipeline.

No ffmpeg Python binding is a project dependency (see pyproject.toml) —
torchcodec/demucs link ffmpeg's codec *libraries* internally but don't
expose a general "extract audio track" call, and nothing else in this
repo already shells out to the `ffmpeg` CLI. This module is a deliberately
small, isolated subprocess wrapper rather than adding a new dependency for
one call.
"""

import shutil
import subprocess
from pathlib import Path

# Containers routed through ffmpeg extraction before the rest of the
# pipeline sees them. Kept in sync with the desktop app's upload dialog
# filter (apps/desktop/src/App.tsx's handleUploadSong).
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v"}


def is_video_container(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def extract_audio(input_path: Path, out_dir: Path) -> Path:
    """Extracts `input_path`'s audio track to a WAV file under `out_dir`
    via the system `ffmpeg` binary. Raises `RuntimeError` with a clear
    message if `ffmpeg` isn't installed/on PATH or if extraction fails
    (e.g. the container has no audio track) — callers should let this
    surface as a failed analysis job, not a crash.
    """
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin is None:
        raise RuntimeError(
            "ffmpeg not found on PATH — required to extract audio from a "
            f"video file ({input_path.name}). Install ffmpeg (e.g. `brew "
            "install ffmpeg`) and try again."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    extracted_path = out_dir / "extracted_audio.wav"

    result = subprocess.run(
        [
            ffmpeg_bin,
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "44100",
            "-ac",
            "2",
            str(extracted_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not extracted_path.exists():
        raise RuntimeError(
            f"ffmpeg failed to extract audio from {input_path.name}: "
            f"{result.stderr.strip()[-2000:]}"
        )
    return extracted_path
