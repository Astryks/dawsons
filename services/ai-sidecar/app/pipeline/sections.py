"""Coarse structural segmentation (section boundaries).

Phase 1 labels are generic ("section-1", "section-2", ...) — semantic
labeling (intro/verse/chorus) is a later-phase upgrade, not required for
the MVP's timeline + text-breakdown output.
"""

from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np


@dataclass
class Section:
    id: str
    label: str
    start_sec: float
    end_sec: float


def segment(input_path: Path, min_section_sec: float = 8.0) -> list[Section]:
    y, sr = librosa.load(str(input_path), sr=None, mono=True)
    hop_length = 2048
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop_length)
    features = np.vstack([chroma, mfcc])

    # Self-similarity + novelty curve: a checkerboard kernel peak means the
    # music on either side of that frame is dissimilar — a plausible
    # section boundary. Standard librosa recipe.
    similarity = librosa.segment.recurrence_matrix(features, mode="affinity", sym=True)
    novelty = np.sum(np.abs(np.diff(similarity, axis=1)), axis=0)

    duration = float(len(y) / sr)
    frame_times = librosa.frames_to_time(np.arange(len(novelty)), sr=sr, hop_length=hop_length)
    min_frames = int(min_section_sec / (frame_times[1] - frame_times[0])) if len(frame_times) > 1 else 1

    peaks = librosa.util.peak_pick(
        novelty, pre_max=min_frames, post_max=min_frames, pre_avg=min_frames, post_avg=min_frames, delta=0.1, wait=min_frames
    )
    boundaries = [0.0] + [float(frame_times[p]) for p in peaks] + [duration]
    boundaries = sorted(set(round(b, 3) for b in boundaries))

    sections = []
    for i in range(len(boundaries) - 1):
        start, end = boundaries[i], boundaries[i + 1]
        if end - start < 1.0:  # drop degenerate near-zero-length slivers
            continue
        sections.append(Section(id=f"section-{len(sections) + 1}", label=f"section-{len(sections) + 1}", start_sec=start, end_sec=end))
    return sections
