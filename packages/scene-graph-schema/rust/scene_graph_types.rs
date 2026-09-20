//! Hand-authored serde structs mirroring `../schema/scene-graph.schema.json`.
//!
//! JSON Schema -> Rust codegen is less mature than the TS/Python equivalents,
//! so these are hand-written and unit-tested against a sample fixture JSON
//! validated by the schema, rather than generated. Implemented at M4/M5
//! alongside `apps/desktop/src-tauri/src/scene_graph/model.rs`, which will
//! `pub use` these types.
