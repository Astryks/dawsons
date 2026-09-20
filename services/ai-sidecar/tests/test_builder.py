from pathlib import Path

from app.pipeline.chords import ChordSegment
from app.pipeline.sections import Section
from app.pipeline.tempo_key import TempoKeyResult
from app.scene_graph.builder import build_fragment


def _tempo_key() -> TempoKeyResult:
    return TempoKeyResult(bpm=120.0, bpm_confidence=0.9, key_tonic="C", key_mode="major", key_confidence=0.9)


def test_build_fragment_keeps_every_real_chord_quality():
    """Regression test: build_fragment used to filter chords down to only
    ("maj", "min") — silently dropping every 7th/sus/dim/aug chord the
    detector could actually find, in the real end-to-end pipeline output,
    even though the detector itself correctly identified them. Only the
    internal "other" (no-chord/"N") marker should ever be excluded.
    """
    chords = [
        ChordSegment(symbol="C", root="C", quality="maj", start_sec=0.0, end_sec=1.0, confidence=0.9),
        ChordSegment(symbol="Am", root="A", quality="min", start_sec=1.0, end_sec=2.0, confidence=0.9),
        ChordSegment(symbol="G7", root="G", quality="dom7", start_sec=2.0, end_sec=3.0, confidence=0.9),
        ChordSegment(symbol="Fmaj7", root="F", quality="maj7", start_sec=3.0, end_sec=4.0, confidence=0.9),
        ChordSegment(symbol="Dsus4", root="D", quality="sus4", start_sec=4.0, end_sec=5.0, confidence=0.9),
        ChordSegment(symbol="Bdim", root="B", quality="dim", start_sec=5.0, end_sec=6.0, confidence=0.9),
        ChordSegment(symbol="Caug", root="C", quality="aug", start_sec=6.0, end_sec=7.0, confidence=0.9),
        ChordSegment(symbol="N", root="C", quality="other", start_sec=7.0, end_sec=8.0, confidence=0.0),
    ]
    fragment = build_fragment(
        title="test",
        duration_sec=8.0,
        source_file="test.wav",
        stem_paths={"vocals": Path("/tmp/vocals.wav")},
        tempo_key=_tempo_key(),
        chords=chords,
        sections=[Section(id="s-1", label="section-1", start_sec=0.0, end_sec=8.0)],
    )

    symbols = {c["symbol"] for c in fragment["song"]["chords"]}
    assert symbols == {"C", "Am", "G7", "Fmaj7", "Dsus4", "Bdim", "Caug"}
    assert "N" not in symbols
