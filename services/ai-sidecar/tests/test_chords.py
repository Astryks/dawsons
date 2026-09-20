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
from app.pipeline.chords import _QUALITY_INTERVALS

SR = 22050

_NOTE_FREQS = {
    "C": 261.63, "C#": 277.18, "D": 293.66, "D#": 311.13, "E": 329.63,
    "F": 349.23, "F#": 369.99, "G": 392.00, "G#": 415.30, "A": 440.00,
    "A#": 466.16, "B": 493.88,
}
_PITCH_ORDER = list(_NOTE_FREQS.keys())


def _triad_freqs(root: str, quality: str) -> list[float]:
    return _chord_freqs(root, quality)


def _chord_freqs(root: str, quality: str) -> list[float]:
    """Builds the frequencies for any quality the detector itself knows
    about (see `_QUALITY_INTERVALS` in chords.py), or an arbitrary
    explicit interval list for qualities it doesn't (e.g. a compound
    "7sus4" chord) — reusing the detector's own interval math means the
    test's ground truth is exactly what music theory says that chord is,
    not a hand-copied guess that could quietly drift out of sync."""
    idx = _PITCH_ORDER.index(root)
    intervals = _QUALITY_INTERVALS[quality] if isinstance(quality, str) else quality
    return [_NOTE_FREQS[_PITCH_ORDER[(idx + i) % 12]] * (2 ** ((idx + i) // 12)) for i in intervals]


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


def test_recognizes_a_published_seventh_and_sus_progression():
    """A widely-published guitar-tutorial voicing for a well-known song
    uses the chords Em7, G, Dsus4, and A7sus4 (capo-2 shapes) — factual,
    uncopyrightable information about which chords a song uses (chord
    *names* aren't the song's protected expression), not a reproduction
    of the song itself. Three of those four qualities (min7, maj, sus4)
    are now in the detector's vocabulary and should come back verbatim.
    """
    progression: list[tuple[str, str | list[int]]] = [
        ("E", "min7"),
        ("G", "maj"),
        ("D", "sus4"),
    ]
    audio = _render_progression(progression, seconds_each=2.0)
    path = _write(Path("/tmp"), "seventh_sus_progression.wav", audio)
    segments = chords.detect(path)

    detected_order = [s.symbol for s in segments]
    collapsed = [detected_order[0]] + [
        s for i, s in enumerate(detected_order[1:], 1) if s != detected_order[i - 1]
    ]
    assert collapsed == ["Em7", "G", "Dsus4"]


def test_a_compound_seventh_sus_chord_is_still_only_approximated():
    """A7sus4 (root, 4th, 5th, minor 7th) combines two qualities at once
    and isn't in the detector's 8-quality vocabulary (`_QUALITY_INTERVALS`
    has "sus4" and "dom7" separately, never combined) — this documents
    that known, real gap so it stays a tracked fact instead of a silent
    surprise, the same way the plain-sus4/min7 case above documents what
    *does* now work.
    """
    a7sus4 = _chord_freqs("A", [0, 5, 7, 10])
    audio = _render_chord(a7sus4, seconds=3.0)
    path = _write(Path("/tmp"), "a7sus4.wav", audio)
    segments = chords.detect(path)

    detected_symbols = {s.symbol for s in segments}
    assert "A7sus4" not in detected_symbols  # structurally impossible today
    # It lands on Dsus2 (D-E-A, three of A7sus4's four notes: A-D-E-G) —
    # a real, plausible-sounding substitution, not something unrelated to
    # the chord's actual pitch classes, even though it's still the wrong
    # answer. Several other 3-of-4 substitutions score similarly close
    # (Asus4, Dsus4, A7, Am7 are all subsets of the same four notes);
    # which one wins is decided by real harmonic energy in the rendered
    # audio, not by this test's guess, so this asserts the actual
    # measured behavior rather than a hand-derived prediction.
    assert detected_symbols == {"Dsus2"}, detected_symbols
