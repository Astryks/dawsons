"""Runs the Phase 1 analysis stage sequence and assembles a Scene Graph fragment.

Stage order (M4/M5): stems.separate -> tempo_key.analyze -> chords.detect
-> sections.segment -> scene_graph.builder.build_fragment. Each stage is a
plain function so it can be unit-tested independently of the job/HTTP layer.
"""
