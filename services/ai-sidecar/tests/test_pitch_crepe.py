"""Tests for the CREPE-based high-accuracy pitch detector
(app/pipeline/pitch_crepe.py). Ground truth is always a synthesized sine
wave at a known, named frequency (A4 = 440Hz is a universal tuning
reference, not anyone's copyrightable expression) — never a real
recording.
"""

from pathlib import Path

import numpy as np
import soundfile as sf

from app.pipeline import pitch_crepe

SR = 16000


def _tone(freq: float, seconds: float) -> np.ndarray:
    t = np.linspace(0, seconds, int(SR * seconds), endpoint=False)
    return 0.3 * np.sin(2 * np.pi * freq * t)


def _write(tmp_path: Path, name: str, audio: np.ndarray) -> Path:
    path = tmp_path / name
    sf.write(path, audio.astype("float32"), SR)
    return path


def test_detects_a_single_sustained_note():
    # A4 = 440Hz = MIDI note 69, the standard tuning reference pitch.
    audio = _tone(440.0, seconds=1.5)
    path = _write(Path("/tmp"), "a4.wav", audio)
    notes = pitch_crepe.detect_notes(path, device="cpu")

    assert len(notes) == 1
    assert notes[0]["note"] == 69
    assert notes[0]["duration_sec"] > 1.0


def test_detects_a_two_note_melody_in_order():
    # A4 (440Hz, MIDI 69) then C5 (523.25Hz, MIDI 72).
    audio = np.concatenate([_tone(440.0, 1.0), _tone(523.25, 1.0)])
    path = _write(Path("/tmp"), "a4_c5.wav", audio)
    notes = pitch_crepe.detect_notes(path, device="cpu")

    assert [n["note"] for n in notes] == [69, 72]
    # Both halves should be close to their real 1-second duration, not
    # fragmented by transient pitch-transition noise at the boundary.
    assert all(0.9 < n["duration_sec"] < 1.1 for n in notes)


def test_silence_produces_no_notes():
    audio = np.zeros(SR)
    path = _write(Path("/tmp"), "silence.wav", audio)
    notes = pitch_crepe.detect_notes(path, device="cpu")
    assert notes == []
