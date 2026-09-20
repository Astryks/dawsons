"""Tempo (BPM) and key detection via librosa (ISC license) — replaces
Essentia, which requires a paid commercial license for closed-source use.
"""

from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np

# Krumhansl-Schmuckler key profiles (relative pitch-class weights for major
# and minor tonality judgments), rotated to test all 12 possible tonics.
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


@dataclass
class TempoKeyResult:
    bpm: float
    bpm_confidence: float
    key_tonic: str
    key_mode: str
    key_confidence: float


def _correlate_key(chroma_mean: np.ndarray) -> tuple[str, str, float]:
    best_score = -2.0
    best_tonic = _PITCH_CLASSES[0]
    best_mode = "major"
    for shift in range(12):
        major_corr = np.corrcoef(chroma_mean, np.roll(_MAJOR_PROFILE, shift))[0, 1]
        minor_corr = np.corrcoef(chroma_mean, np.roll(_MINOR_PROFILE, shift))[0, 1]
        if major_corr > best_score:
            best_score, best_tonic, best_mode = major_corr, _PITCH_CLASSES[shift], "major"
        if minor_corr > best_score:
            best_score, best_tonic, best_mode = minor_corr, _PITCH_CLASSES[shift], "minor"
    # Pearson correlation is in [-1, 1]; map to a rough [0, 1] confidence.
    confidence = max(0.0, min(1.0, (best_score + 1) / 2))
    return best_tonic, best_mode, confidence


def analyze(input_path: Path) -> TempoKeyResult:
    y, sr = librosa.load(str(input_path), sr=None, mono=True)

    tempo, _beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(tempo if np.isscalar(tempo) else tempo[0])
    # librosa doesn't expose a beat-tracking confidence score directly;
    # onset-envelope strength at the detected tempo's autocorrelation peak
    # is a reasonable proxy — clamp to keep this an honest "we're not sure"
    # signal rather than a manufactured-precision number.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempogram = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr)
    bpm_confidence = float(np.clip(np.max(np.mean(tempogram, axis=1)) / (np.mean(tempogram) + 1e-9) / 10, 0.0, 1.0))

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    tonic, mode, key_confidence = _correlate_key(np.mean(chroma, axis=1))

    return TempoKeyResult(
        bpm=round(bpm, 2),
        bpm_confidence=round(bpm_confidence, 3),
        key_tonic=tonic,
        key_mode=mode,
        key_confidence=round(key_confidence, 3),
    )
