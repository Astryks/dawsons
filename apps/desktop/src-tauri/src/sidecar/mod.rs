//! Spawns, health-checks, and supervises the Python AI sidecar process.

pub mod client;
pub mod process;

pub use process::{spawn, SidecarHandle, SidecarStatus};
