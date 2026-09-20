//! "Smart upload": the user drops in any sound file, and the app figures
//! out where it belongs — an existing instrument layer, or a new one —
//! by running it through the sidecar's Demucs-based clip classifier
//! instead of asking the user to know what a "stem" or "track" is.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::analysis::{http_client, sidecar_port};
use crate::audio_engine::transport;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipClassification {
    pub job_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: f64,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn start_clip_classification(
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
        .post(format!("http://127.0.0.1:{port}/classify"))
        .json(&serde_json::json!({ "file_path": file_path }))
        .send()
        .map_err(|e| format!("failed to start classification: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "sidecar rejected classify request ({status}): {body}"
        ));
    }

    response
        .json::<StartResponse>()
        .map(|r| r.job_id)
        .map_err(|e| format!("failed to parse response: {e}"))
}

#[tauri::command]
pub fn clip_classification_status(
    state: State<AppState>,
    job_id: String,
) -> Result<ClipClassification, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    let response = client
        .get(format!("http://127.0.0.1:{port}/classify/{job_id}"))
        .send()
        .map_err(|e| format!("failed to poll classification status: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("sidecar returned {}", response.status()));
    }

    response
        .json()
        .map_err(|e| format!("failed to parse status: {e}"))
}

/// Loads the *original* uploaded clip (not the isolated stem the
/// classifier produced internally — that's only used to make the
/// suggestion) into the mixer as a new track under `layer_name`, which
/// the frontend fills in from the classifier's suggestion or lets the
/// user override.
#[tauri::command]
pub fn load_clip_into_layer(
    state: State<AppState>,
    file_path: String,
    layer_name: String,
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
        layer_name,
    )
}
