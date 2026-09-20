# Architecture

## Processes

```
React (WebView)  ──invoke()──>  Rust (Tauri backend)
                                    │              │
                          audio_engine/       sidecar/
                        (cpal + symphonia)   (spawn, health-check,
                          plays stems         supervise, HTTP client)
                                                    │
                                                    │ localhost HTTP
                                                    ▼
                                     Python AI sidecar (FastAPI)
                                     Demucs → librosa → custom chord/section detection
```

See [ADR 0001](adr/0001-ipc-and-data-ownership.md) for why Rust owns the
canonical Scene Graph and the sidecar stays stateless.

## Sidecar lifecycle

1. Rust spawns the sidecar (dev: `uvicorn` directly; packaged: a
   PyInstaller-frozen binary bundled as a Tauri sidecar binary — end users
   never need Python installed).
2. The sidecar binds an OS-assigned port and prints
   `{"status": "ready", "port": N}` as a single JSON line on stdout.
3. Rust reads that line, then polls `GET /health` (every ~200ms, 15s
   timeout) until it gets a 200. Only then does the UI enable
   AI-dependent actions.
4. Rust holds the child process handle and watches its exit status;
   unexpected exit triggers one restart attempt with backoff, then surfaces
   a `sidecar:crashed` event if that also fails.
5. On app quit, Rust calls `POST /shutdown` for a graceful uvicorn
   shutdown, waits up to ~3s, then force-kills if still alive.

## Analysis flow (Phase 1)

1. User uploads a file → `invoke('start_analysis', { filePath })`.
2. Rust calls the sidecar's `POST /analyze` with the file path and project
   id (same machine, so a path reference is used instead of re-uploading
   bytes over HTTP) → gets back `{ job_id }`, returns it to React
   immediately, and starts polling.
3. Rust polls `GET /analyze/{job_id}` until `status == "done" | "failed"`.
4. On success, the response is a Scene-Graph-shaped JSON fragment. Rust
   validates it against `packages/scene-graph-schema/schema/scene-graph.schema.json`,
   merges it into the project's Scene Graph, persists to SQLite, and emits
   `scene_graph:updated`.
5. React re-renders the Timeline and the AnalysisBreakdown view from the
   same store — both are reading the same graph, not separate data paths.
6. Stem playback: Rust's audio engine loads the separated stem files
   (paths recorded on each `Track`) via `symphonia`. Python never plays
   audio — it only produces files and JSON.

## Roadmap (milestones)

See the Phase 1 plan for the full ordered list (M1–M9): repo scaffold →
audio engine → sidecar supervision → stems playable → tempo/key/chords/
sections → timeline + text breakdown → weight download flow → packaging →
hardening. M6's concrete UI requirements (track add/remove/reorder, the
song-browser dropdown, confidence badges) and the new M6b (local-only
Voice Notes) are detailed in [`UX_DESIGN.md`](UX_DESIGN.md).

## License policy

Every dependency must be free to use in closed-source commercial software
at any scale — see [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)
for what's in, what's explicitly excluded, and why. Check a new
dependency's license against that policy *before* adding it, and add an
entry to that file in the same PR.
