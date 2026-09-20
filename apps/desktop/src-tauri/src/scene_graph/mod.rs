//! The canonical Musical Scene Graph: Rust owns this model and its SQLite
//! persistence (see docs/adr/0001-ipc-and-data-ownership.md for why). The
//! Python sidecar only ever returns analysis results for Rust to merge in.

pub mod model;
pub mod store;

pub use model::{Project, VoiceNote};
