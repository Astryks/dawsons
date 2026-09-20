//! Voice-to-instrument's optional "high accuracy" pitch mode via the
//! sidecar's CREPE-based /pitch endpoint. The default path
//! (`commands::voice_notes::play_voice_note_as_instrument`) stays the
//! pure-Rust YIN implementation — fast, no model, no sidecar round-trip.
//! This is for when a quiet/breathy/noisy recording trips up YIN and
//! someone is willing to pay a slower, sidecar-routed cost for CREPE's
//! better accuracy.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::analysis::{http_client, sidecar_port};
use crate::audio_engine::synth::{self, ScoreNote};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrepePitchStatus {
    pub job_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: f64,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn start_high_accuracy_pitch_detection(
    state: State<AppState>,
    file_path: String,
) -> Result<String, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    #[derive(Deserialize)]
    struct StartResponse {
        job_id: String,
    }

    let response = client
        .post(format!("http://127.0.0.1:{port}/pitch"))
        .json(&serde_json::json!({ "file_path": file_path }))
        .send()
        .map_err(|e| format!("failed to start pitch detection: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("sidecar rejected pitch request ({status}): {body}"));
    }

    response
        .json::<StartResponse>()
        .map(|r| r.job_id)
        .map_err(|e| format!("failed to parse response: {e}"))
}

#[tauri::command]
pub fn high_accuracy_pitch_detection_status(
    state: State<AppState>,
    job_id: String,
) -> Result<CrepePitchStatus, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    let response = client
        .get(format!("http://127.0.0.1:{port}/pitch/{job_id}"))
        .send()
        .map_err(|e| format!("failed to poll pitch status: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("sidecar returned {}", response.status()));
    }

    response
        .json()
        .map_err(|e| format!("failed to parse status: {e}"))
}

/// Renders CREPE's detected notes (JSON: `[{note, start_sec,
/// duration_sec}, ...]`) through the chosen GM instrument and loads the
/// result as a new mixer track — the CREPE-path equivalent of
/// `play_voice_note_as_instrument`'s YIN-based rendering.
#[tauri::command]
pub fn play_crepe_notes_as_instrument(
    state: State<AppState>,
    notes: serde_json::Value,
    program: u8,
) -> Result<(), String> {
    let note_array = notes
        .as_array()
        .ok_or_else(|| "expected an array of notes".to_string())?;

    let score_notes: Vec<ScoreNote> = note_array
        .iter()
        .map(|n| {
            let pitch =
                n.get("note")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| "note missing 'note' field".to_string())? as u8;
            let duration_sec = n
                .get("duration_sec")
                .and_then(|v| v.as_f64())
                .ok_or_else(|| "note missing 'duration_sec' field".to_string())?
                as f32;
            Ok(ScoreNote::note(pitch, duration_sec))
        })
        .collect::<Result<_, String>>()?;

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let rendered = synth::render_part(&handle.engine_config, program, &score_notes)?;

    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![crate::audio_engine::mixer::TrackBuffer {
        name: format!("voice-as-instrument-crepe-{program}"),
        samples: std::sync::Arc::new(rendered),
        gain: 1.0,
        muted: false,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
