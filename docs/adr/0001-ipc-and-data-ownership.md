# ADR 0001: IPC and Scene Graph data ownership

## Status
Accepted (Phase 1)

## Context
Three processes need to cooperate: the Tauri/Rust desktop backend, the React
frontend (running in Tauri's WebView), and a Python FastAPI sidecar running
the ML pipeline (Demucs, librosa, custom chord/section detection). We need
to decide (a) how the frontend reaches each backend, and (b) which process
owns the canonical Musical Scene Graph and its persistence.

## Decision

**Frontend → Rust only.** React never calls the sidecar's HTTP API directly;
it only calls Tauri `invoke()` commands. Rust proxies to the sidecar
internally. This keeps a single trust boundary and means the sidecar's
address is never exposed to WebView JavaScript.

**Rust owns the canonical Scene Graph.** The Python sidecar is stateless
with respect to long-term storage: `POST /analyze` triggers a job, and
`GET /analyze/{id}` eventually returns a Scene-Graph-shaped JSON fragment.
Rust validates that fragment, merges it into the current project's Scene
Graph, persists it to SQLite, and broadcasts a `scene_graph:updated` event
to the frontend. The sidecar never touches SQLite.

## Alternatives considered

- **Python writes directly to SQLite.** Rejected: creates two writers to the
  same database file from two separate processes/runtimes, forcing
  cross-process file-locking/WAL discipline, and would make Rust's UI state
  (undo/redo, autosave) dependent on polling a database another process
  might be mid-write to.
- **Frontend calls the sidecar directly over HTTP.** Rejected: exposes the
  sidecar's local address to arbitrary WebView JS, and splits "what the UI
  can do" across two backends instead of one.

## Consequences

- The sidecar can be restarted, replaced, or tested in isolation with zero
  coupling to how projects are stored.
- Rust is the single source of truth for what's rendered — the timeline and
  the text/JSON breakdown both read from the same in-memory graph.
- The sidecar needs filesystem access to a working directory shared with
  Rust (for Demucs output files, etc.) — passed explicitly per-request
  rather than hardcoded, so both processes agree on where files live without
  either owning the other's storage.
