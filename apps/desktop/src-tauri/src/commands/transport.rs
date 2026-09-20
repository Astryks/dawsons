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

/// The real "reverse & re-pitch" tool: applies reverse, pitch shift, and
/// reverb to *any* file the user points at — including a stem Demucs just
/// isolated from an uploaded clip — not just the bundled demo tone. This
/// is what actually makes the "isolate a sound, clean it up, then reshape
/// it" workflow usable end to end. `reverb_wet`/`reverb_room` default to 0
/// (no reverb) when omitted.
#[tauri::command]
pub fn apply_reverse_pitch_to_file(
    state: State<AppState>,
    file_path: String,
    reverse: bool,
    semitones: f64,
    reverb_wet: Option<f64>,
    reverb_room: Option<f64>,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    transport::load_file_with_effects(
        &handle.mixer,
        &handle.engine_config,
        std::path::Path::new(&file_path),
        reverse,
        semitones as f32,
        reverb_wet.unwrap_or(0.0) as f32,
        reverb_room.unwrap_or(0.0) as f32,
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

/// Semitone offsets from the root for each supported chord quality — the
/// same idea as a guitar's open chord shapes (a C shape always plays a C
/// major triad no matter the instrument), generalized to any of the 128
/// GM instruments. Unrecognized qualities fall back to major so the
/// easy-start feature never silently does nothing.
fn chord_intervals(quality: &str) -> &'static [i32] {
    match quality {
        "minor" => &[0, 3, 7],
        "dominant7" => &[0, 4, 7, 10],
        "major7" => &[0, 4, 7, 11],
        "minor7" => &[0, 3, 7, 10],
        "sus4" => &[0, 5, 7],
        "diminished" => &[0, 3, 6],
        _ => &[0, 4, 7], // major
    }
}

/// The easy-start "press a note, hear a chord" tool: builds the chord for
/// `root_note` + `quality` and plays it through the chosen GM instrument —
/// so a brand new user gets a full, in-key chord out of piano, sax, synth,
/// or anything else, the same way pressing C on a guitar always gives a
/// full C major chord.
#[tauri::command]
pub fn play_instrument_chord(
    state: State<AppState>,
    program: u8,
    root_note: i32,
    quality: String,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let pitches: Vec<i32> = chord_intervals(&quality)
        .iter()
        .map(|offset| root_note + offset)
        .collect();
    let samples = synth::render_chord(&handle.engine_config, program, &pitches, 100, 1.5)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![crate::audio_engine::mixer::TrackBuffer {
        name: format!("chord-{program}-{quality}"),
        samples: std::sync::Arc::new(samples),
        gain: 1.0,
        muted: false,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
