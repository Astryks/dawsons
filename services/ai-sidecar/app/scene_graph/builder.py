"""Assembles pipeline stage outputs into a Scene-Graph-shaped JSON fragment.

Implemented at M5: takes the outputs of stems/tempo_key/chords/sections,
stamps each field's `source` (e.g. "demucs", "librosa-tempo",
"chord-detector-v1") and `confidence`, and returns a dict matching
packages/scene-graph-schema/schema/scene-graph.schema.json — validated by
validate.py before being returned to the Rust caller.
"""
