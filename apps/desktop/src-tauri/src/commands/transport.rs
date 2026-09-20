use tauri::State;

use crate::audio_engine::transport;
use crate::state::AppState;

fn require_audio(
    state: &Option<crate::state::AudioEngineHandle>,
) -> Result<&crate::state::AudioEngineHandle, String> {
    state
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())
}

/// M2 debug command: loads and plays the bundled synthetic test tone,
/// proving the full decode -> mix -> cpal output path end to end. Real
/// file loading (via `load_track`, with a user-chosen path) lands with M4.
#[tauri::command]
pub fn debug_play_test_tone(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let asset_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-assets/test-tone.wav");
    transport::load_test_track(&handle.mixer, &handle.engine_config, &asset_path)?;
    transport::play(&handle.mixer)
}

#[tauri::command]
pub fn transport_play(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::play(&require_audio(&audio)?.mixer)
}

#[tauri::command]
pub fn transport_pause(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::pause(&require_audio(&audio)?.mixer)
}

#[tauri::command]
pub fn transport_stop(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::stop(&require_audio(&audio)?.mixer)
}
