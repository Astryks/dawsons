"""Stem separation via Demucs (htdemucs_6s model, MIT license).

htdemucs_6s is a distinct model checkpoint from the default 4-stem
htdemucs — trained to additionally split guitar and piano out of the
catch-all "other" bucket, giving 6 stems (vocals, drums, bass, guitar,
piano, other) instead of 4. More useful for instrument identification at
essentially the same integration cost.

Demucs manages its own pretrained-weight downloads internally (via
Hugging Face Hub, on first use, cached under ~/.cache) — no custom
download logic needed here for this specific dependency.
"""

from collections.abc import Callable
from pathlib import Path

from demucs.api import Separator, save_audio

from app.pipeline.hf_progress import report_hf_download_progress

_MODEL = "htdemucs_6s"

_separator: Separator | None = None
_separator_device: str | None = None


def _get_separator(device: str, on_progress: Callable[[str, float], None] | None = None) -> Separator:
    global _separator, _separator_device
    if _separator is None or _separator_device != device:
        if on_progress is None:
            _separator = Separator(model=_MODEL, device=device)
        else:
            # Only matters on a genuine first run — once Hugging Face Hub
            # has the weights cached, constructing this makes no network
            # calls at all and the callback simply never fires.
            def report(_downloaded: int, _total: int, fraction: float) -> None:
                on_progress("downloading_model", fraction)

            with report_hf_download_progress(report):
                _separator = Separator(model=_MODEL, device=device)
        _separator_device = device
    return _separator


def separate(
    input_path: Path,
    out_dir: Path,
    device: str = "cpu",
    on_progress: Callable[[str, float], None] | None = None,
) -> dict[str, Path]:
    """Separates `input_path` into stems (vocals, drums, bass, guitar,
    piano, other), writing one WAV per stem into `out_dir`. Returns
    {stem_name: path}.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    separator = _get_separator(device, on_progress)
    _origin, separated = separator.separate_audio_file(input_path)

    paths: dict[str, Path] = {}
    for name, wav in separated.items():
        stem_path = out_dir / f"{name}.wav"
        save_audio(wav, stem_path, samplerate=separator.samplerate)
        paths[name] = stem_path
    return paths
