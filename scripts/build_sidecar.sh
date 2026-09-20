#!/usr/bin/env bash
# Freezes the Python AI sidecar into a standalone executable with
# PyInstaller (M8), so a packaged Dawsons build never needs a system
# Python or a manually-created venv on the end user's machine. Output
# lands in services/ai-sidecar/dist/dawsons-sidecar/ as a --onedir
# bundle (a directory of files, not a single binary) — onedir starts
# noticeably faster than --onefile for a bundle this size, since
# --onefile re-extracts everything into a temp dir on every launch.
#
# pyinstaller itself is not a hard runtime dependency of the sidecar —
# install it only when you need to build a package:
#   services/ai-sidecar/.venv/bin/pip install pyinstaller
set -euo pipefail
cd "$(dirname "$0")/.."

SIDECAR_DIR="services/ai-sidecar"
SCHEMA_FILE="packages/scene-graph-schema/schema/scene-graph.schema.json"

if [ ! -x "$SIDECAR_DIR/.venv/bin/pyinstaller" ]; then
  echo "pyinstaller not found in $SIDECAR_DIR/.venv — installing it now"
  "$SIDECAR_DIR/.venv/bin/pip" install pyinstaller
fi

echo "==> Freezing the sidecar (this genuinely takes several minutes — torch/demucs/ace-step is a large dependency tree)"
(
  cd "$SIDECAR_DIR"
  .venv/bin/pyinstaller \
    --onedir \
    --noconfirm \
    --name dawsons-sidecar \
    --add-data "../../$SCHEMA_FILE:." \
    app/main.py
)

echo "==> Done: $SIDECAR_DIR/dist/dawsons-sidecar/dawsons-sidecar"
echo "    Smoke-test it directly: $SIDECAR_DIR/dist/dawsons-sidecar/dawsons-sidecar"
echo "    (first launch is slower than a dev venv's 'python -m app.main' —"
echo "    give it ~30-45s before assuming something's wrong)"
