"""Custom chord detection: chroma features + template matching.

Built ourselves rather than depending on Chordino (GPL-2.0, copyleft).

Implemented at M5:
    def detect(input_path: Path, tempo_key: TempoKeyResult) -> list[ChordSegment]:
        # 1. librosa.feature.chroma_cqt frame-by-frame chroma vectors
        # 2. median-filter smoothing over a beat-length window
        # 3. cosine-similarity match against 24 major/minor (+ 7th) chord
        #    templates
        # 4. collapse into contiguous segments; confidence = template match score

Flagged in the Phase 1 plan as the piece most worth upgrading in Phase 2 —
a trained chord-recognition model will beat template matching on accuracy.
"""
