"""Tests for lyric transcription (app/pipeline/lyrics.py).

Test audio here is always synthesized locally via macOS's built-in `say`
command, speaking original sentences written for this test — never a
real recording of anyone's copyrighted lyrics or speech. This produces
genuine speech audio to validate real transcription accuracy, the same
"synthesize our own ground truth" approach used in test_chords.py.
"""

import shutil
import subprocess
from itertools import pairwise

import pytest

from app.pipeline import lyrics

pytestmark = pytest.mark.skipif(shutil.which("say") is None, reason="macOS 'say' not available in this environment")


def _synthesize_speech(tmp_path, text: str):
    path = tmp_path / "speech.aiff"
    subprocess.run(["say", "-o", str(path), text], check=True)
    return path


def test_transcribes_original_synthesized_speech(tmp_path):
    text = "Dawsons turns a hummed melody into a full instrument performance."
    path = _synthesize_speech(tmp_path, text)

    segments = lyrics.transcribe(path)

    assert len(segments) >= 1
    full_text = " ".join(s["text"] for s in segments).lower()
    assert "dawsons" in full_text or "melody" in full_text or "instrument" in full_text
    assert all(0.0 <= s["confidence"] <= 1.0 for s in segments)
    assert all(s["end_sec"] > s["start_sec"] for s in segments)


def test_transcribes_a_longer_original_passage_with_correct_timing(tmp_path):
    text = (
        "The first verse talks about morning light. The second verse talks about the open road. "
        "The chorus repeats a simple, hopeful line."
    )
    path = _synthesize_speech(tmp_path, text)

    segments = lyrics.transcribe(path)

    assert len(segments) >= 1
    # Segments should be in chronological order and non-overlapping.
    for a, b in pairwise(segments):
        assert b["start_sec"] >= a["start_sec"]
