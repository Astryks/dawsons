"""Tempo (BPM) and key detection via librosa (ISC license) — replaces Essentia,
which requires a paid commercial license for closed-source use.

Implemented at M5:
    def analyze(input_path: Path) -> TempoKeyResult:
        # librosa.beat.beat_track for BPM.
        # librosa.feature.chroma_cqt + Krumhansl-Schmuckler key-profile
        # correlation for key/mode.
        #
        # Evaluate `madmom`'s beat/downbeat tracker against librosa's on a
        # handful of test tracks before locking this in — see the Phase 1
        # plan's note on this being the one accuracy-vs-simplicity tradeoff
        # worth testing empirically rather than assuming.
"""
