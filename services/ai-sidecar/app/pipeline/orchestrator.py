"""Runs the full analysis stage sequence for a job: stems -> tempo/key ->
chords -> sections -> Scene Graph fragment, schema-validated before
returning.
"""

from collections.abc import Callable
from pathlib import Path

import librosa

from app.pipeline import chords, lyrics, sections, stems, tempo_key
from app.scene_graph.builder import build_fragment
from app.scene_graph.validate import validate


def run_analysis(
    input_path: Path,
    out_dir: Path,
    device: str = "cpu",
    on_progress: Callable[[str, float], None] | None = None,
) -> dict:
    def progress(stage: str, value: float) -> None:
        if on_progress:
            on_progress(stage, value)

    progress("separating_stems", 0.0)
    stem_paths = stems.separate(input_path, out_dir, device=device, on_progress=progress)
    progress("separating_stems", 1.0)

    progress("detecting_tempo_key", 0.0)
    tk = tempo_key.analyze(input_path)
    progress("detecting_tempo_key", 1.0)

    progress("detecting_chords", 0.0)
    chord_segments = chords.detect(input_path)
    progress("detecting_chords", 1.0)

    progress("segmenting_sections", 0.0)
    section_list = sections.segment(input_path)
    progress("segmenting_sections", 1.0)

    progress("transcribing_lyrics", 0.0)
    vocals_path = stem_paths.get("vocals")
    lyric_lines = lyrics.transcribe(vocals_path) if vocals_path else []
    progress("transcribing_lyrics", 1.0)

    duration_sec = float(librosa.get_duration(path=str(input_path)))

    fragment = build_fragment(
        title=input_path.stem,
        duration_sec=duration_sec,
        source_file=str(input_path),
        stem_paths=stem_paths,
        tempo_key=tk,
        chords=chord_segments,
        sections=section_list,
        lyric_lines=lyric_lines,
    )
    validate(fragment)
    return fragment
