"""Validates a Scene-Graph fragment against the shared JSON Schema.

Loads packages/scene-graph-schema/schema/scene-graph.schema.json directly
from the shared package (read from disk, not duplicated), so Rust/TS/
Python all validate against the exact same file.
"""

import functools
import json
import sys
from pathlib import Path

import jsonschema


def _schema_path() -> Path:
    # A PyInstaller-frozen build (M8) has no `packages/` sibling directory
    # to walk up to — `__file__` resolves somewhere inside the bundle's
    # extracted _internal tree instead. The schema is bundled as a plain
    # data file at the bundle root instead (see the `pyinstaller
    # --add-data` invocation in scripts/build_sidecar.sh), reachable via
    # sys._MEIPASS, PyInstaller's own extraction-directory attribute.
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "scene-graph.schema.json"
    # Dev/test: app/scene_graph/validate.py -> app -> ai-sidecar -> services -> repo root
    return Path(__file__).resolve().parents[4] / "packages" / "scene-graph-schema" / "schema" / "scene-graph.schema.json"


_SCHEMA_PATH = _schema_path()


@functools.lru_cache(maxsize=1)
def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text())


def validate(fragment: dict) -> None:
    """Raises jsonschema.ValidationError if `fragment` doesn't match the
    Scene Graph schema."""
    jsonschema.validate(instance=fragment, schema=_load_schema())
