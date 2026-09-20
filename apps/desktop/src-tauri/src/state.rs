/// Shared application state handed to Tauri commands via `tauri::State`.
///
/// M2 adds the audio engine handle here; M3 adds the sidecar process/client;
/// M4-M5 add the in-memory Scene Graph mirror backing the SQLite store.
#[derive(Default)]
pub struct AppState {}
