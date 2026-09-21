use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::audio_engine::{
    capture, decode, effects, mixer::TrackBuffer, pitch, synth, transport, wav_writer,
};
use crate::commands::transport::chord_intervals;
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
///
/// `auto_tune_tonic`/`auto_tune_scale` (pitch class 0-11 + `"major"`/
/// `"minor"`) are optional: when both are given, every detected note is
/// snapped to the nearest pitch in that key before rendering — the
/// "can't sing in tune? auto-tune it" option. `robotic_hz`/
/// `muffle_cutoff_hz` are optional voice-effect dials applied to the
/// rendered audio afterward (0 or absent disables each).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn play_voice_note_as_instrument(
    state: State<AppState>,
    file_path: String,
    program: u8,
    auto_tune_tonic: Option<u8>,
    auto_tune_scale: Option<String>,
    robotic_hz: Option<f32>,
    muffle_cutoff_hz: Option<f32>,
) -> Result<(), String> {
    let decoded = decode::decode_file(std::path::Path::new(&file_path))?;
    let mut notes = pitch::extract_notes(&decoded.samples, decoded.channels, decoded.sample_rate);

    if let Some(tonic) = auto_tune_tonic {
        let scale: &[u8] = if auto_tune_scale.as_deref() == Some("minor") {
            &pitch::MINOR_SCALE
        } else {
            &pitch::MAJOR_SCALE
        };
        notes = pitch::snap_notes_to_scale(&notes, tonic, scale);
    }

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let mut rendered = synth::render_melody(&handle.engine_config, program, &notes)?;

    let voice_effects = effects::EffectChain {
        robotic_hz: robotic_hz.unwrap_or(0.0),
        muffle_cutoff_hz: muffle_cutoff_hz.unwrap_or(0.0),
        ..Default::default()
    };
    if voice_effects.robotic_hz > 0.0 || voice_effects.muffle_cutoff_hz > 0.0 {
        rendered = voice_effects.apply(
            &rendered,
            handle.engine_config.channels,
            handle.engine_config.sample_rate,
        );
    }

    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![TrackBuffer {
        name: format!("voice-as-instrument-{program}"),
        samples: std::sync::Arc::new(rendered),
        gain: 1.0,
        muted: false,
        start_offset: 0,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}

/// Sing (or hum) one note, hear a full chord — the same "easy-start"
/// trick as `play_instrument_chord`'s chord-shape tables, but the root
/// comes from your own voice instead of a dropdown. Picks the longest
/// sustained note from the recording as the root (the note you actually
/// held, not a brief transient), optionally auto-tuned into a key first,
/// then plays the full chord through the chosen GM instrument.
#[tauri::command]
pub fn play_voice_note_as_chord(
    state: State<AppState>,
    file_path: String,
    program: u8,
    quality: String,
    auto_tune_tonic: Option<u8>,
    auto_tune_scale: Option<String>,
) -> Result<(), String> {
    let decoded = decode::decode_file(std::path::Path::new(&file_path))?;
    let notes = pitch::extract_notes(&decoded.samples, decoded.channels, decoded.sample_rate);
    let root = notes
        .iter()
        .max_by(|a, b| a.duration_sec.total_cmp(&b.duration_sec))
        .ok_or_else(|| "no clear pitch detected in this recording".to_string())?
        .note;

    let root_note = match auto_tune_tonic {
        Some(tonic) => {
            let scale: &[u8] = if auto_tune_scale.as_deref() == Some("minor") {
                &pitch::MINOR_SCALE
            } else {
                &pitch::MAJOR_SCALE
            };
            pitch::snap_to_scale(root, tonic, scale)
        }
        None => root,
    };

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let pitches: Vec<i32> = chord_intervals(&quality)
        .iter()
        .map(|offset| root_note as i32 + offset)
        .collect();
    let samples = synth::render_chord(&handle.engine_config, program, &pitches, 100, 1.5)?;

    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![TrackBuffer {
        name: format!("voice-as-chord-{program}-{quality}"),
        samples: std::sync::Arc::new(samples),
        gain: 1.0,
        muted: false,
        start_offset: 0,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
