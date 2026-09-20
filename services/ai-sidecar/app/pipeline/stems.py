"""Stem separation via Demucs (htdemucs model, MIT license).

Demucs manages its own pretrained-weight downloads internally (via
Hugging Face Hub, on first use, cached under ~/.cache) — no custom
download logic needed here for this specific dependency.
"""

from pathlib import Path
from typing import Optional

from demucs.api import Separator, save_audio

_separator: Optional[Separator] = None
_separator_device: Optional[str] = None


def _get_separator(device: str) -> Separator:
    global _separator, _separator_device
    if _separator is None or _separator_device != device:
        _separator = Separator(model="htdemucs", device=device)
        _separator_device = device
    return _separator


def separate(input_path: Path, out_dir: Path, device: str = "cpu") -> dict[str, Path]:
    """Separates `input_path` into stems (vocals, drums, bass, other),
    writing one WAV per stem into `out_dir`. Returns {stem_name: path}.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    separator = _get_separator(device)
    _origin, separated = separator.separate_audio_file(input_path)

    paths: dict[str, Path] = {}
    for name, wav in separated.items():
        stem_path = out_dir / f"{name}.wav"
        save_audio(wav, stem_path, samplerate=separator.samplerate)
        paths[name] = stem_path
    return paths
