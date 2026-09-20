# Dawsons AI Sidecar

Local FastAPI service that runs the analysis pipeline (stem separation,
tempo/key/chord/section detection). Normally spawned and supervised
automatically by the desktop app's Rust backend — see
`apps/desktop/src-tauri/src/sidecar/`. Stateless with respect to long-term
storage: it returns analysis results per job, and the desktop app's Rust
backend owns persisting them into the canonical Scene Graph.

## Running standalone (for sidecar development)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8420
```

Then `curl http://127.0.0.1:8420/health` should return `{"status": "ok", ...}`.

## Endpoints (see docs/ARCHITECTURE.md for the full contract)

- `GET /health` — liveness + readiness, polled by Rust on startup
- `POST /analyze` — starts an analysis job, returns `{"job_id": ...}`
- `GET /analyze/{job_id}` — job status; on completion, a Scene-Graph-shaped
  JSON fragment
- `POST /shutdown` — graceful shutdown, called by Rust on app quit

## Model weights

Never committed to this repo. Run `../../scripts/download_models.sh` (or
`python models/download_weights.py` directly) to fetch pretrained weights
into a local cache directory per `models/manifest.json`.
