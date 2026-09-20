"""Custom chord detection: chroma features + template matching.

Built ourselves rather than depending on Chordino (GPL-2.0, copyleft).
"""

from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
from scipy.ndimage import median_filter

_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Binary chroma templates for the 24 major/minor triads: 1 where a chord
# tone falls, 0 elsewhere, rotated per root across all 12 pitch classes.
_MAJOR_TRIAD = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0])
_MINOR_TRIAD = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0])


@dataclass
class ChordSegment:
    symbol: str
    root: str
    quality: str
    start_sec: float
    end_sec: float
    confidence: float


def _templates() -> list[tuple[str, str, str, np.ndarray]]:
    templates = []
    for shift, root in enumerate(_PITCH_CLASSES):
        templates.append((f"{root}", root, "maj", np.roll(_MAJOR_TRIAD, shift)))
        templates.append((f"{root}m", root, "min", np.roll(_MINOR_TRIAD, shift)))
    return templates


def _best_match(chroma_vector: np.ndarray, templates: list[tuple[str, str, str, np.ndarray]]) -> tuple[str, str, str, float]:
    norm = np.linalg.norm(chroma_vector)
    if norm < 1e-6:
        return "N", "C", "other", 0.0
    best_score = -1.0
    best = templates[0]
    for symbol, root, quality, template in templates:
        score = float(np.dot(chroma_vector, template) / (norm * np.linalg.norm(template)))
        if score > best_score:
            best_score = score
            best = (symbol, root, quality, template)
    return best[0], best[1], best[2], max(0.0, min(1.0, best_score))


def detect(input_path: Path, frame_hop_sec: float = 0.5) -> list[ChordSegment]:
    y, sr = librosa.load(str(input_path), sr=None, mono=True)
    hop_length = 2048
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    # Smooth over a beat-ish window to reduce frame-to-frame chord flicker
    # from transients (drum hits, note attacks) before template matching.
    chroma = median_filter(chroma, size=(1, 9))

    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop_length)
    templates = _templates()

    raw: list[tuple[float, str, str, str, float]] = []
    for i, t in enumerate(frame_times):
        symbol, root, quality, confidence = _best_match(chroma[:, i], templates)
        raw.append((float(t), symbol, root, quality, confidence))

    if not raw:
        return []

    # Collapse consecutive frames with the same chord into one segment,
    # averaging confidence across the run.
    segments: list[ChordSegment] = []
    seg_start, seg_symbol, seg_root, seg_quality = raw[0][0], raw[0][1], raw[0][2], raw[0][3]
    seg_confidences = [raw[0][4]]
    duration = float(len(y) / sr)

    for t, symbol, root, quality, confidence in raw[1:]:
        if symbol == seg_symbol:
            seg_confidences.append(confidence)
            continue
        segments.append(
            ChordSegment(
                symbol=seg_symbol,
                root=seg_root,
                quality=seg_quality,
                start_sec=round(seg_start, 3),
                end_sec=round(t, 3),
                confidence=round(float(np.mean(seg_confidences)), 3),
            )
        )
        seg_start, seg_symbol, seg_root, seg_quality = t, symbol, root, quality
        seg_confidences = [confidence]

    segments.append(
        ChordSegment(
            symbol=seg_symbol,
            root=seg_root,
            quality=seg_quality,
            start_sec=round(seg_start, 3),
            end_sec=round(duration, 3),
            confidence=round(float(np.mean(seg_confidences)), 3),
        )
    )
    return segments
