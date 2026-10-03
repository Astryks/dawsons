"""Tests for video-container input support (app/pipeline/video.py).

Covers the extension classification used by orchestrator.run_analysis to
decide whether to route a file through ffmpeg extraction first, the clean
failure path when ffmpeg isn't installed, and (when a real `ffmpeg` binary
is available on PATH) a real extraction from an actual MP4 built from our
own synthesized tone fixture — no real video asset needed.
"""

import shutil
import subprocess
from pathlib import Path

import pytest
import soundfile as sf

from app.pipeline import video

FIXTURE = Path(__file__).parent / "fixtures" / "tiny-tone.wav"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("song.mp4", True),
        ("clip.MOV", True),
        ("video.m4v", True),
        ("song.mp3", False),
        ("song.wav", False),
        ("noextension", False),
    ],
)
def test_is_video_container(name, expected):
    assert video.is_video_container(Path(name)) is expected


def test_extract_audio_raises_clearly_when_ffmpeg_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError, match="ffmpeg not found"):
        video.extract_audio(tmp_path / "input.mp4", tmp_path / "out")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="requires a real ffmpeg binary on PATH")
def test_extract_audio_real_extraction_from_a_real_mp4(tmp_path):
    # Build a tiny real MP4 (silent video frame + our synthesized tone as
    # the audio track) from the existing WAV fixture, so this is a real
    # ffmpeg extraction end-to-end rather than a mock.
    mp4_path = tmp_path / "tiny.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=1",
            "-i",
            str(FIXTURE),
            "-shortest",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(mp4_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert mp4_path.exists()

    out_dir = tmp_path / "out"
    extracted = video.extract_audio(mp4_path, out_dir)

    assert extracted.exists()
    data, sr = sf.read(extracted)
    assert sr == 44100
    assert len(data) > 0
