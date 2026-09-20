"""High-accuracy pitch detection via CREPE (torchcrepe — a PyTorch port
of the original CREPE model, MIT license verified directly against the
LICENSE file, code and weights both) for voice-to-instrument's optional
"high accuracy" mode.

The default voice-to-instrument path stays the existing pure-Rust YIN
implementation (audio_engine/pitch.rs) — fast, no model download, no
sidecar round-trip. This is for when a quiet/breathy/noisy recording
trips up YIN and someone is willing to pay a slower, sidecar-routed cost
for CREPE's better accuracy.
"""

from pathlib import Path

import librosa
import numpy as np
import torch
import torchcrepe

_SAMPLE_RATE = 16000  # what torchcrepe's pretrained model expects
_HOP_MS = 5.0
_FMIN, _FMAX = 50.0, 1100.0  # covers typical singing/humming, not just speech
_VOICED_THRESHOLD = 0.21  # torchcrepe's own suggested periodicity cutoff
_FILTER_WINDOW = 3  # ~15ms at a 5ms hop, torchcrepe's own suggested window


def detect_notes(input_path: Path, device: str = "cpu") -> list[dict]:
    """Returns time-synced notes: [{"note": midi_number, "start_sec",
    "duration_sec"}, ...] — the same shape as pitch.rs's DetectedNote,
    so the frontend/Rust side can treat either source interchangeably.
    """
    audio_np, sr = librosa.load(str(input_path), sr=_SAMPLE_RATE, mono=True)
    audio = torch.from_numpy(audio_np).unsqueeze(0).float()

    hop_length = int(sr / (1000.0 / _HOP_MS))
    # "full" is meaningfully more accurate than "tiny" but heavier; only
    # worth it when there's a real accelerator, which is the whole point
    # of this being the *optional*, slower, higher-accuracy path.
    model_capacity = "full" if device in ("cuda", "mps") else "tiny"
    torch_device = device if device == "cuda" else "cpu"  # torchcrepe has no MPS backend

    pitch, periodicity = torchcrepe.predict(
        audio,
        sr,
        hop_length,
        _FMIN,
        _FMAX,
        model_capacity,
        batch_size=2048,
        device=torch_device,
        return_periodicity=True,
    )
    periodicity = torchcrepe.filter.median(periodicity, _FILTER_WINDOW)
    pitch = torchcrepe.filter.mean(pitch, _FILTER_WINDOW)

    pitch = pitch.squeeze(0).numpy()
    periodicity = periodicity.squeeze(0).numpy()
    frame_sec = hop_length / sr

    raw_notes: list[int | None] = []
    for i in range(len(pitch)):
        voiced = periodicity[i] >= _VOICED_THRESHOLD and pitch[i] > 0
        raw_notes.append(round(69 + 12 * np.log2(pitch[i] / 440.0)) if voiced else None)

    # Real recordings (and even the synthesized test tones used to verify
    # this) produce a couple of single-frame "in-between" notes right at
    # a pitch transition, purely from how the frequency glides across the
    # boundary — not a real, intended note. Dropping runs shorter than
    # ~30ms (a handful of frames at this hop length) into the preceding
    # note removes that transient noise the same way chords.py's Viterbi
    # decoder removes drum-transient noise from chord decisions.
    min_run_frames = max(1, round(0.03 / frame_sec))
    smoothed = list(raw_notes)
    i = 0
    while i < len(smoothed):
        j = i
        while j < len(smoothed) and smoothed[j] == smoothed[i]:
            j += 1
        if (j - i) < min_run_frames and i > 0:
            for k in range(i, j):
                smoothed[k] = smoothed[i - 1]
        i = j

    notes: list[dict] = []
    current_note: int | None = None
    current_start = 0.0

    def flush(end_sec: float) -> None:
        if current_note is not None:
            notes.append(
                {
                    "note": current_note,
                    "start_sec": round(current_start, 3),
                    "duration_sec": round(end_sec - current_start, 3),
                }
            )

    for i, midi_note in enumerate(smoothed):
        if midi_note != current_note:
            flush(i * frame_sec)
            current_note = midi_note
            current_start = i * frame_sec
    flush(len(smoothed) * frame_sec)

    return [n for n in notes if n["note"] is not None and n["duration_sec"] > 0]
