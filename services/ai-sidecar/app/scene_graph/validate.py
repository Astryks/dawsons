"""Validates a Scene-Graph fragment against the shared JSON Schema.

Loads packages/scene-graph-schema/schema/scene-graph.schema.json directly
from the shared package (read from disk, not duplicated), so Rust/TS/
Python all validate against the exact same file.
"""

import functools
import json
from pathlib import Path

import jsonschema

# app/scene_graph/validate.py -> app -> ai-sidecar -> services -> repo root
_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "packages" / "scene-graph-schema" / "schema" / "scene-graph.schema.json"
)


@functools.lru_cache(maxsize=1)
def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text())


def validate(fragment: dict) -> None:
    """Raises jsonschema.ValidationError if `fragment` doesn't match the
    Scene Graph schema."""
    jsonschema.validate(instance=fragment, schema=_load_schema())
