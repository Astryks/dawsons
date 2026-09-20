#!/usr/bin/env bash
# Thin wrapper around services/ai-sidecar/models/download_weights.py.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d services/ai-sidecar/.venv ]; then
  echo "Python venv not found — run ./scripts/setup_dev.sh first." >&2
  exit 1
fi

source services/ai-sidecar/.venv/bin/activate
python services/ai-sidecar/models/download_weights.py "$@"
