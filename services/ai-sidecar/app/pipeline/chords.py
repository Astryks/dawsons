"""Custom chord detection: chroma features + template matching.

Built ourselves rather than depending on Chordino (GPL-2.0, copyleft).
"""

from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
from scipy.ndimage import median_filter

_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Semitone intervals from the root for each chord quality this detector
# recognizes, and the symbol suffix each one gets. These are music-theory
# definitions (e.g. a major 7th chord is always root+4+7+11 semitones),
# not anyone's copyrightable expression — the same reasoning that lets
# demo_songs.rs use chord progressions freely.
_QUALITY_INTERVALS: dict[str, list[int]] = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "dom7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "min7": [0, 3, 7, 10],
    "sus4": [0, 5, 7],
    "sus2": [0, 2, 7],
    "dim": [0, 3, 6],
}
_QUALITY_SUFFIX: dict[str, str] = {
    "maj": "",
    "min": "m",
    "dom7": "7",
    "maj7": "maj7",
    "min7": "m7",
    "sus4": "sus4",
    "sus2": "sus2",
    "dim": "dim",
}


@dataclass
class ChordSegment:
    symbol: str
    root: str
    quality: str
    start_sec: float
    end_sec: float
    confidence: float


def _template_for(intervals: list[int]) -> np.ndarray:
    vec = np.zeros(12)
    for interval in intervals:
        vec[interval % 12] = 1
    return vec


def _templates() -> list[tuple[str, str, str, np.ndarray]]:
    templates = []
    for shift, root in enumerate(_PITCH_CLASSES):
        for quality, intervals in _QUALITY_INTERVALS.items():
            symbol = f"{root}{_QUALITY_SUFFIX[quality]}"
            templates.append((symbol, root, quality, np.roll(_template_for(intervals), shift)))
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


def _mode_smooth(symbols: list[str], window: int) -> list[str]:
    """Replaces each symbol with the most common one in a centered window
    around it — a majority vote that erases isolated one-frame flips
    (e.g. a drum hit briefly outvoting the real chord) without merging
    genuinely different, sustained chords. `chroma`'s own median filter
    smooths the continuous features going *into* template matching; this
    smooths the discrete *decisions* coming out of it, which is a
    different failure mode (a decision can still flip near a template
    boundary even when the underlying chroma barely moved).
    """
    if window <= 1 or len(symbols) <= 1:
        return symbols
    half = window // 2
    smoothed = []
    for i in range(len(symbols)):
        lo, hi = max(0, i - half), min(len(symbols), i + half + 1)
        window_slice = symbols[lo:hi]
        smoothed.append(max(set(window_slice), key=window_slice.count))
    return smoothed


def detect(input_path: Path, frame_hop_sec: float = 0.5) -> list[ChordSegment]:
    y, sr = librosa.load(str(input_path), sr=None, mono=True)
    # Chord *tones* live in the harmonic component; drum hits and other
    # percussive transients spread broadband energy across every chroma
    # bin more or less at random, which otherwise makes template matching
    # flicker between unrelated chords on every hit. HPSS (a standard,
    # general DSP technique — not derived from any particular chord-
    # detection product) isolates the harmonic part first.
    harmonic, _percussive = librosa.effects.hpss(y)
    hop_length = 2048
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr, hop_length=hop_length)
    # Smooth over a beat-ish window to reduce frame-to-frame chord flicker
    # from transients (drum hits, note attacks) before template matching.
    chroma = median_filter(chroma, size=(1, 9))

    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop_length)
    templates = _templates()
    symbol_to_root_quality: dict[str, tuple[str, str]] = {
        symbol: (root, quality) for symbol, root, quality, _ in templates
    }
    symbol_to_root_quality["N"] = ("C", "other")

    raw_matches: list[tuple[str, str, str, float]] = [
        _best_match(chroma[:, i], templates) for i in range(chroma.shape[1])
    ]
    # ~1 second of majority-vote smoothing on the discrete chord decisions
    # (frame_hop_sec is the caller's *segment* granularity hint, not this
    # frame rate — this window is sized off the actual chroma frame rate).
    frame_sec = hop_length / sr
    smoothed_symbols = _mode_smooth([m[0] for m in raw_matches], window=max(1, round(1.0 / frame_sec)))

    raw: list[tuple[float, str, str, str, float]] = []
    for i, t in enumerate(frame_times):
        symbol = smoothed_symbols[i]
        _orig_symbol, root, quality, confidence = raw_matches[i]
        if symbol != _orig_symbol:
            # The vote overruled this frame's own best match — root/quality
            # need to come from *a* frame that actually voted for `symbol`,
            # not the outvoted original match.
            root, quality = symbol_to_root_quality[symbol]
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
