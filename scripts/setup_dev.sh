#!/usr/bin/env bash
# Installs frontend dependencies and sets up the Python sidecar venv.
# Rust toolchain / platform Tauri prerequisites are not installed here —
# see https://tauri.app/start/prerequisites/ for your OS.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing desktop frontend dependencies"
(cd apps/desktop && npm install)

echo "==> Setting up Python sidecar virtualenv"
(
  cd services/ai-sidecar
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt -e ".[dev]"
)

echo "==> Done. Next: ./scripts/download_models.sh, then cd apps/desktop && npm run tauri dev"
