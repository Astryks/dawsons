//! The canonical Musical Scene Graph: Rust owns this model and its SQLite
//! persistence (see docs/adr/0001-ipc-and-data-ownership.md for why). The
//! Python sidecar only ever returns analysis results for Rust to merge in.
//!
//! Implemented starting at M4/M5: `model.rs` (serde structs mirroring
//! packages/scene-graph-schema), `store.rs` (SQLite read/write via rusqlite),
//! `migrations/` (schema version upgrades), `events.rs` (emits
//! `scene_graph:updated` to the frontend on mutation).
