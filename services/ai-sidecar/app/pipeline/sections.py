"""Coarse structural segmentation (section boundaries).

Implemented at M5:
    def segment(input_path: Path) -> list[Section]:
        # Novelty-curve peak-picking on a self-similarity matrix of
        # chroma/MFCC features (standard librosa recipe).
        #
        # Phase 1 labels are generic ("section-1", "section-2", ...) —
        # semantic labeling (intro/verse/chorus) is a later-phase upgrade,
        # not required for the MVP's timeline + text-breakdown output.
"""
