use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::audio_engine::{
    capture, decode, mixer::TrackBuffer, pitch, synth, transport, wav_writer,
};
use crate::scene_graph::{store, VoiceNote};
use crate::state::AppState;

#[tauri::command]
pub fn start_voice_recording(state: State<AppState>) -> Result<(), String> {
    let handle = capture::start_recording()?;
    *state
        .voice_recording
        .lock()
        .map_err(|_| "voice recording state poisoned".to_string())? = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_voice_recording(
    state: State<AppState>,
    app: AppHandle,
    title: String,
) -> Result<VoiceNote, String> {
    let handle = state
        .voice_recording
        .lock()
        .map_err(|_| "voice recording state poisoned".to_string())?
        .take()
        .ok_or_else(|| "no recording in progress".to_string())?;

    let engine_config = handle.engine_config;
    let samples = handle.stop();
    if samples.is_empty() {
        return Err("recording captured no audio".to_string());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("voice_notes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create {dir:?}: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let file_path = dir.join(format!("{id}.wav"));
    wav_writer::write_wav(
        &file_path,
        &samples,
        engine_config.sample_rate,
        engine_config.channels,
    )?;

    let duration_sec = samples.len() as f64
        / (engine_config.sample_rate as f64 * engine_config.channels.max(1) as f64);

    let db = state
        .db
        .lock()
        .map_err(|_| "database state poisoned".to_string())?;
    let conn = db
        .as_ref()
        .ok_or_else(|| "project database unavailable".to_string())?;
    store::create_voice_note(
        conn,
        &id,
        &title,
        duration_sec,
        &file_path.to_string_lossy(),
    )
}

#[tauri::command]
pub fn list_voice_notes(state: State<AppState>) -> Result<Vec<VoiceNote>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "database state poisoned".to_string())?;
    let conn = db
        .as_ref()
        .ok_or_else(|| "project database unavailable".to_string())?;
    store::list_voice_notes(conn)
}

#[tauri::command]
pub fn delete_voice_note(state: State<AppState>, id: String) -> Result<(), String> {
    let file_path = {
        let db = state
            .db
            .lock()
            .map_err(|_| "database state poisoned".to_string())?;
        let conn = db
            .as_ref()
            .ok_or_else(|| "project database unavailable".to_string())?;
        store::delete_voice_note(conn, &id)?
    };
    // Best-effort: the DB row is already gone even if the file can't be
    // removed (e.g. already missing) — don't fail the command over that.
    let _ = std::fs::remove_file(file_path);
    Ok(())
}

#[tauri::command]
pub fn play_voice_note(state: State<AppState>, file_path: String) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    transport::load_test_track(
        &handle.mixer,
        &handle.engine_config,
        std::path::Path::new(&file_path),
    )?;
    transport::play(&handle.mixer)
}

/// Voice-to-instrument: pitch-tracks a recorded voice note (YIN — fast,
/// local, no model download) and re-renders the detected melody through
/// the chosen GM instrument. The "sing it, hear any instrument" flagship
/// feature.
#[tauri::command]
pub fn play_voice_note_as_instrument(
    state: State<AppState>,
    file_path: String,
    program: u8,
) -> Result<(), String> {
    let decoded = decode::decode_file(std::path::Path::new(&file_path))?;
    let notes = pitch::extract_notes(&decoded.samples, decoded.channels, decoded.sample_rate);

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let rendered = synth::render_melody(&handle.engine_config, program, &notes)?;

    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![TrackBuffer {
        name: format!("voice-as-instrument-{program}"),
        samples: std::sync::Arc::new(rendered),
        gain: 1.0,
        muted: false,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
