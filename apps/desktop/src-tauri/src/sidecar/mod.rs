//! Spawns, health-checks, and supervises the Python AI sidecar process.
//!
//! Implemented starting at M3: `process.rs` (spawn/restart/shutdown) and
//! `client.rs` (thin HTTP client to the sidecar's `/analyze` and `/health`
//! endpoints). Left as a stub module through M1/M2 so the desktop shell and
//! audio engine can be built and verified independently first.
