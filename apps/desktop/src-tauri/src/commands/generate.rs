//! "Generate": type a style/mood prompt, get an original AI-generated
//! instrumental clip back via the sidecar's ACE-Step pipeline (Apache-2.0
//! code + weights — verified commercially usable, unlike MusicGen whose
//! weights are CC-BY-NC). Same async job pattern as analysis/classify:
//! Rust proxies to the sidecar's HTTP API, the frontend only ever calls
//! these commands (see ADR 0001).

use serde::{Deserialize, Serialize};
use tauri::State;

use super::analysis::{http_client, sidecar_port};
use crate::audio_engine::transport;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationStatus {
    pub job_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: f64,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn start_music_generation(
    state: State<AppState>,
    prompt: String,
    duration_sec: f64,
) -> Result<String, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    #[derive(Deserialize)]
    struct StartResponse {
        job_id: String,
    }

    let response = client
        .post(format!("http://127.0.0.1:{port}/generate"))
        .json(&serde_json::json!({ "prompt": prompt, "duration_sec": duration_sec }))
        .send()
        .map_err(|e| format!("failed to start generation: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "sidecar rejected generate request ({status}): {body}"
        ));
    }

    response
        .json::<StartResponse>()
        .map(|r| r.job_id)
        .map_err(|e| format!("failed to parse response: {e}"))
}

#[tauri::command]
pub fn music_generation_status(
    state: State<AppState>,
    job_id: String,
) -> Result<GenerationStatus, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    let response = client
        .get(format!("http://127.0.0.1:{port}/generate/{job_id}"))
        .send()
        .map_err(|e| format!("failed to poll generation status: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("sidecar returned {}", response.status()));
    }

    response
        .json()
        .map_err(|e| format!("failed to parse status: {e}"))
}

/// Loads the generated clip into the mixer as a new track — the
/// original AI-generated layer becomes an ordinary, editable track like
/// any other, not a special read-only thing.
#[tauri::command]
pub fn load_generated_clip(
    state: State<AppState>,
    file_path: String,
    name: String,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    transport::add_track(
        &handle.mixer,
        &handle.engine_config,
        std::path::Path::new(&file_path),
        name,
    )
}
