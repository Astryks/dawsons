"""Time-synced lyric transcription via faster-whisper (MIT license,
verified directly against the LICENSE file — a CTranslate2-based
reimplementation of OpenAI's Whisper, whose own code and weights are
separately verified MIT).

Runs on the isolated vocals stem Demucs already produces, not the full
mix — much more accurate transcription with the instrumental backing
removed, and it naturally lines up with the vocals track already on the
timeline.

Only ever transcribes what's actually in the user's own uploaded audio —
this produces a transcription of *that specific recording*, not a
lookup of published lyrics from anywhere else.
"""

import math
from pathlib import Path

from faster_whisper import WhisperModel

_model: WhisperModel | None = None

# CTranslate2 (faster-whisper's backend) supports CPU and CUDA, but not
# Apple's MPS — unlike the PyTorch-based Demucs/ACE-Step pipelines
# elsewhere in this sidecar, "device" here can't just forward whatever
# detect_device() returns. "auto" picks CUDA when available and CPU
# otherwise, which is the correct (and only sensible) choice on a Mac.


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel("base", device="auto", compute_type="int8")
    return _model


def transcribe(input_path: Path) -> list[dict]:
    """Returns time-synced segments: [{"text", "start_sec", "end_sec",
    "confidence"}, ...]. `confidence` is derived from Whisper's own
    per-segment `avg_logprob` (average per-token log-probability,
    converted to a 0..1 scale) discounted by `no_speech_prob` (how
    likely this segment is just silence/noise rather than actual
    speech) — a real signal, not a hardcoded placeholder.
    """
    model = _get_model()
    segments, _info = model.transcribe(str(input_path), word_timestamps=False)
    results = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        token_confidence = max(0.0, min(1.0, math.exp(seg.avg_logprob)))
        speech_confidence = 1.0 - seg.no_speech_prob
        results.append(
            {
                "text": text,
                "start_sec": float(seg.start),
                "end_sec": float(seg.end),
                "confidence": round(token_confidence * speech_confidence, 3),
            }
        )
    return results
