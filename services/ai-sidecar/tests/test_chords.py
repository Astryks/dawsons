"""Tests for the custom chord detector (app/pipeline/chords.py).

Ground truth here is always a *synthesized* signal we build ourselves from
publicly documented chord names/progressions (chord progressions aren't
copyrightable expression — only a specific melodic/lyrical realization
is), never an actual commercial recording. That gives us exact, known-
correct answers to grade the detector against, which is both the
copyright-safe way to test this and, for accuracy purposes, a *more*
rigorous test than a real recording: we know precisely what's "right"
instead of relying on a chord chart someone else transcribed by ear.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

from app.pipeline import chords

SR = 22050

_NOTE_FREQS = {
    "C": 261.63, "C#": 277.18, "D": 293.66, "D#": 311.13, "E": 329.63,
    "F": 349.23, "F#": 369.99, "G": 392.00, "G#": 415.30, "A": 440.00,
    "A#": 466.16, "B": 493.88,
}
_PITCH_ORDER = list(_NOTE_FREQS.keys())


def _triad_freqs(root: str, quality: str) -> list[float]:
    idx = _PITCH_ORDER.index(root)
    third = 3 if quality == "min" else 4
    tones = [idx, idx + third, idx + 7]
    return [_NOTE_FREQS[_PITCH_ORDER[t % 12]] * (2 ** (t // 12)) for t in tones]


def _render_chord(freqs: list[float], seconds: float, sr: int = SR) -> np.ndarray:
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    return sum(0.2 * np.sin(2 * np.pi * f * t) for f in freqs)


def _render_progression(chord_specs: list[tuple[str, str]], seconds_each: float, sr: int = SR) -> np.ndarray:
    return np.concatenate([_render_chord(_triad_freqs(root, quality), seconds_each, sr) for root, quality in chord_specs])


def _write(tmp_path: Path, name: str, audio: np.ndarray, sr: int = SR) -> Path:
    path = tmp_path / name
    sf.write(path, audio.astype("float32"), sr)
    return path


def test_detects_a_single_sustained_major_chord():
    audio = _render_chord(_triad_freqs("C", "maj"), seconds=3.0)
    path = _write(Path("/tmp"), "c_major.wav", audio)
    segments = chords.detect(path)
    assert len(segments) == 1
    assert segments[0].symbol == "C"
    assert segments[0].quality == "maj"


def test_detects_a_single_sustained_minor_chord():
    audio = _render_chord(_triad_freqs("A", "min"), seconds=3.0)
    path = _write(Path("/tmp"), "a_minor.wav", audio)
    segments = chords.detect(path)
    assert len(segments) == 1
    assert segments[0].symbol == "Am"


def test_tracks_a_four_chord_progression_in_order():
    # A generic I-V-vi-IV pop progression (C-G-Am-F) — the same
    # uncopyrightable chord skeleton used throughout demo_songs.rs.
    progression = [("C", "maj"), ("G", "maj"), ("A", "min"), ("F", "maj")]
    audio = _render_progression(progression, seconds_each=2.0)
    path = _write(Path("/tmp"), "progression.wav", audio)
    segments = chords.detect(path)

    detected_order = [s.symbol for s in segments]
    expected_order = ["C", "G", "Am", "F"]
    # Allow the detector to merge/split slightly at boundaries, but the
    # sequence of *distinct* chords it settles on should match exactly.
    collapsed = [detected_order[0]] + [
        s for i, s in enumerate(detected_order[1:], 1) if s != detected_order[i - 1]
    ]
    assert collapsed == expected_order


def test_percussive_noise_does_not_fragment_a_sustained_chord():
    # Regression test for the over-segmentation bug found while validating
    # against real screen-recording audio: drum-like broadband transients
    # were flipping the per-frame chord decision on nearly every hit,
    # producing dozens of spurious chord changes per second on a chord
    # that never actually changed. Simulates "drums" as periodic noise
    # bursts under a sustained chord.
    chord_audio = _render_chord(_triad_freqs("D", "maj"), seconds=4.0)
    t = np.arange(len(chord_audio)) / SR
    noise = np.random.default_rng(0).normal(0, 1, size=len(chord_audio))
    # A short burst of noise every 0.5s, like a kick/snare hit.
    envelope = np.zeros_like(chord_audio)
    for hit_time in np.arange(0, 4.0, 0.5):
        mask = (t >= hit_time) & (t < hit_time + 0.05)
        envelope[mask] = 1.0
    audio = chord_audio + 0.5 * noise * envelope
    path = _write(Path("/tmp"), "chord_with_drums.wav", audio)
    segments = chords.detect(path)

    # However it segments the boundaries, it should not report more than a
    # small handful of segments for one sustained chord plus periodic
    # drum hits — dozens would mean the transients are still winning.
    assert len(segments) <= 5, f"expected a few segments, got {len(segments)}: {[s.symbol for s in segments]}"
    # And the chord it lands on should actually be D major.
    longest = max(segments, key=lambda s: s.end_sec - s.start_sec)
    assert longest.symbol == "D"


def test_wonderwall_style_progression_reveals_the_triad_only_limitation():
    """Oasis's "Wonderwall" is widely published (guitar tutorials, chord
    sites) as using capo-2 shapes commonly voiced as Em7-G-Dsus4-A7sus4 —
    factual, uncopyrightable information about which chords a song uses,
    not a reproduction of the song itself. Our detector only classifies
    major/minor *triads* (see `_templates`), so it can't return "Em7" or
    "Dsus4" verbatim — this documents what it does instead, so that
    limitation is a known, tested fact rather than a surprise in
    production. It should at least get the chord *roots* broadly in the
    neighborhood of the real progression.
    """
    # Approximate each documented chord with the closest sound our
    # triad-only vocabulary could ever match: Em7 -> E minor triad,
    # G -> G major (exact), Dsus4 -> approximated as D, A7sus4 -> A.
    progression = [("E", "min"), ("G", "maj"), ("D", "maj"), ("A", "maj")]
    audio = _render_progression(progression, seconds_each=2.0)
    path = _write(Path("/tmp"), "wonderwall_style.wav", audio)
    segments = chords.detect(path)

    detected_symbols = {s.symbol for s in segments}
    # The detector has no 7th/sus vocabulary at all, so "Em7" and
    # "Dsus4" are structurally impossible outputs — that's the point
    # being documented, not a bug to fix here.
    assert "Em7" not in detected_symbols
    assert "Dsus4" not in detected_symbols
    # But on the closest-triad approximation, it should still recover
    # something in the right neighborhood for the unambiguous chords.
    detected_order = [s.symbol for s in segments]
    collapsed = [detected_order[0]] + [
        s for i, s in enumerate(detected_order[1:], 1) if s != detected_order[i - 1]
    ]
    assert "G" in collapsed
