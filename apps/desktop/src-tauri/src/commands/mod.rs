// #[tauri::command] handlers exposed to the React frontend via invoke().
// Split by concern as they're implemented: project.rs (M1/M5), transport.rs (M2),
// analysis.rs (M4), mixer.rs (M4).

pub mod analysis;
pub mod demo_songs;
pub mod export;
pub mod project;
pub mod sidecar;
pub mod smart_upload;
pub mod transport;
pub mod voice_notes;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! Dawsons desktop shell is running.")
}
