use tauri::State;

use crate::audio_engine::mixer::TrackInfo;
use crate::audio_engine::{synth, transport};
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

/// "Reverse & re-pitch" tool: applies reverse and/or a pitch shift (the
/// vari-speed tape technique) to the bundled test tone and plays it.
/// Real user-supplied clips land once file import (M4) exists; this proves
/// the effect chain end to end first.
#[tauri::command]
pub fn debug_play_reversed_pitched_tone(
    state: State<AppState>,
    reverse: bool,
    semitones: f64,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let asset_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-assets/test-tone.wav");
    transport::load_test_track_with_effects(
        &handle.mixer,
        &handle.engine_config,
        &asset_path,
        reverse,
        semitones as f32,
    )?;
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

#[tauri::command]
pub fn list_tracks(state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    Ok(mixer.track_info())
}

#[tauri::command]
pub fn set_track_muted(state: State<AppState>, index: usize, muted: bool) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.set_muted(index, muted)
}

#[tauri::command]
pub fn soundfont_available() -> bool {
    synth::is_soundfont_available()
}

/// Instrument library demo: renders a single note with the chosen GM
/// program via the SoundFont synth and plays it — proves the instrument
/// picker end to end before it's wired into real track editing.
#[tauri::command]
pub fn play_instrument_note(state: State<AppState>, program: u8, note: i32) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let samples = synth::render_note(&handle.engine_config, program, note, 100, 1.5)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![crate::audio_engine::mixer::TrackBuffer {
        name: format!("instrument-{program}"),
        samples: std::sync::Arc::new(samples),
        gain: 1.0,
        muted: false,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
