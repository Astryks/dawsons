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
    "aug": [0, 4, 8],
    "dim7": [0, 3, 6, 9],
    "hdim7": [0, 3, 6, 10],  # half-diminished / min7(b5)
    "dom7sus4": [0, 5, 7, 10],
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
    "aug": "aug",
    "dim7": "dim7",
    "hdim7": "m7b5",
    "dom7sus4": "7sus4",
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


def _score_matrix(chroma: np.ndarray, templates: list[tuple[str, str, str, np.ndarray]]) -> np.ndarray:
    """Cosine similarity of every frame against *every* template (not just
    the best one) — the input a proper temporal decoder needs, versus the
    old frame-by-frame argmax approach which threw away everything except
    the single winner and had no way to reconsider it later.
    """
    template_matrix = np.stack([t for _, _, _, t in templates])  # (n_states, 12)
    template_norms = np.linalg.norm(template_matrix, axis=1)
    chroma_norms = np.linalg.norm(chroma, axis=0)  # (n_frames,)
    dots = template_matrix @ chroma  # (n_states, n_frames)
    denom = np.outer(template_norms, chroma_norms)
    denom[denom < 1e-9] = 1e-9
    scores = dots / denom
    return np.clip(scores, 0.0, 1.0).T  # (n_frames, n_states)


def _viterbi_decode(score_matrix: np.ndarray, self_transition: float = 0.985) -> np.ndarray:
    """Finds the most likely chord-label sequence across the whole clip,
    given per-frame template-match scores, favoring staying on the same
    chord over switching every frame. This is the standard, generic
    Viterbi dynamic-programming algorithm (textbook DSP/ML, used
    throughout speech recognition and far predating any specific chord-
    detection product) — it replaces this detector's previous ad hoc
    majority-vote window with the actual principled technique published
    academic chord detectors (including Chordino) use for temporal
    smoothing, without reusing any of their code. A high self-transition
    probability encodes "chords don't change every 50ms" as a real
    probabilistic prior instead of an arbitrary fixed window size.
    """
    n_frames, n_states = score_matrix.shape
    if n_frames == 0:
        return np.array([], dtype=int)

    log_emission = np.log(np.clip(score_matrix, 1e-9, 1.0))
    stay = np.log(self_transition)
    switch = np.log((1.0 - self_transition) / max(1, n_states - 1))

    log_prob = log_emission[0].copy()
    backpointer = np.zeros((n_frames, n_states), dtype=int)

    for t in range(1, n_frames):
        # candidate[i, j] = best log-prob of being in state i at t-1,
        # then transitioning to state j (stay if i == j, else switch).
        candidates = np.full((n_states, n_states), switch) + log_prob[:, None]
        candidates[np.arange(n_states), np.arange(n_states)] = log_prob + stay
        backpointer[t] = np.argmax(candidates, axis=0)
        log_prob = np.max(candidates, axis=0) + log_emission[t]

    path = np.zeros(n_frames, dtype=int)
    path[-1] = int(np.argmax(log_prob))
    for t in range(n_frames - 2, -1, -1):
        path[t] = backpointer[t + 1, path[t + 1]]
    return path


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

    if chroma.shape[1] == 0:
        return []

    scores = _score_matrix(chroma, templates)  # (n_frames, n_states)
    # With 96 possible chord states, the "neutral" (no bias either way)
    # self-transition probability is ~1/96 = 0.0104 — a value like 0.9
    # (correct intuition for a small state space) is actually a massive
    # bias toward never leaving the current chord once there, since the
    # switch probability gets divided across all 95 alternatives. 0.1
    # (~10x more likely to stay than to switch to any *one* specific
    # other chord) was tuned empirically against real chord-change cases
    # and a synthetic drum-transient regression case, and holds correctly
    # across the range 0.05-0.15.
    path = _viterbi_decode(scores, self_transition=0.1)

    chroma_norms = np.linalg.norm(chroma, axis=0)
    silence_threshold = 1e-3

    raw: list[tuple[float, str, str, str, float]] = []
    for i, t in enumerate(frame_times):
        if chroma_norms[i] < silence_threshold:
            raw.append((float(t), "N", "C", "other", 0.0))
            continue
        symbol, root, quality, _template = templates[path[i]]
        raw.append((float(t), symbol, root, quality, float(scores[i, path[i]])))

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
