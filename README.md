# Dawsons

An AI-native desktop DAW. Upload a song and get it back as an editable
project — separated stems, tempo, key, chords, and structure. Sing or hum
an idea and turn it into any instrument's performance.

The DAW UI is the interface; a structured **Musical Scene Graph** (see
[`docs/SCENE_GRAPH.md`](docs/SCENE_GRAPH.md)) is the source of truth that
every analysis, edit, and render operates on — never raw waveforms.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system
design and the current phase roadmap.

## Architecture at a glance

```
React (desktop UI) ──invoke()──> Rust (Tauri backend)
                                   │        │
                          audio engine   HTTP (localhost)
                        (cpal + symphonia)  │
                                            ▼
                                  Python AI sidecar (FastAPI)
                                  Demucs · librosa · custom chord/section detection
```

Rust owns the canonical Scene Graph (persisted to SQLite). The Python
sidecar is a stateless local compute service: it returns analysis results,
Rust validates/merges/persists them, and the UI renders from Rust's state.

## Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 20+ and npm
- [Python](https://www.python.org/) 3.10+
- Platform build tools for Tauri — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS (on macOS: Xcode Command Line Tools)

## Getting started

```bash
./scripts/setup_dev.sh      # installs frontend deps, sets up the Python venv
./scripts/download_models.sh  # fetches AI model weights into a local cache (not in git)
cd apps/desktop && npm run tauri dev
```

The AI sidecar is spawned and supervised automatically by the desktop app —
you don't need to start it separately in normal use. To run it standalone
for sidecar development: see [`services/ai-sidecar/README.md`](services/ai-sidecar/README.md).

## Repo layout

- `apps/desktop/` — Tauri + React desktop app (the DAW shell, real-time audio engine, Scene Graph persistence)
- `services/ai-sidecar/` — Python FastAPI service running the analysis pipeline (stem separation, tempo/key/chord/section detection)
- `packages/scene-graph-schema/` — the versioned Scene Graph JSON Schema and its generated TypeScript/Rust/Python types — the contract every other package depends on
- `scripts/` — dev setup and model-download scripts
- `docs/` — architecture docs and architecture decision records (ADRs)

## Development workflow

The initial scaffold was pushed directly to `main`. From here on, work
happens on feature branches with PRs (`feat/<milestone-name>`), even for
solo development, so each change is independently reviewable and CI-gated.

## License

Proprietary — see [`LICENSE`](LICENSE). Third-party open-source dependencies
are used under their own licenses — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
Only dependencies that are free to use in closed-source commercial software
are used; see that file for what was deliberately excluded and why.
