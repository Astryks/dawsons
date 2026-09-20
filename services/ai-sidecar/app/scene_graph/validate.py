"""Validates a Scene-Graph fragment against the shared JSON Schema.

Implemented at M5: loads
packages/scene-graph-schema/schema/scene-graph.schema.json (read directly
from the shared package rather than a duplicated copy, so Rust/TS/Python
stay in sync against one file) and validates via the `jsonschema` package.
"""
