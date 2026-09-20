//! Kicks off a sidecar analysis job, polls its status, and loads the
//! resulting stems into the audio engine once done. Rust proxies to the
//! sidecar's HTTP API rather than exposing it to the frontend directly
//! (see ADR 0001) — the frontend only ever calls these Tauri commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio_engine::transport;
use crate::sidecar::SidecarStatus;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub stems: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisStatus {
    pub job_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: f64,
    pub result: Option<AnalysisResult>,
    pub error: Option<String>,
}

fn sidecar_port(state: &State<AppState>) -> Result<u16, String> {
    let handle = state
        .sidecar_handle
        .lock()
        .map_err(|_| "sidecar state poisoned".to_string())?;
    let handle = handle
        .as_ref()
        .ok_or_else(|| "sidecar not running".to_string())?;
    let status = handle
        .status
        .lock()
        .map_err(|_| "sidecar status poisoned".to_string())?;
    match &*status {
        SidecarStatus::Ready { port } => Ok(*port),
        SidecarStatus::Starting => Err("sidecar is still starting".to_string()),
        SidecarStatus::Error { message } => Err(format!("sidecar unavailable: {message}")),
    }
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

#[tauri::command]
pub fn start_analysis(state: State<AppState>, file_path: String) -> Result<String, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    #[derive(Deserialize)]
    struct StartResponse {
        job_id: String,
    }

    let response = client
        .post(format!("http://127.0.0.1:{port}/analyze"))
        .json(&serde_json::json!({ "file_path": file_path }))
        .send()
        .map_err(|e| format!("failed to start analysis: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "sidecar rejected analysis request ({status}): {body}"
        ));
    }

    response
        .json::<StartResponse>()
        .map(|r| r.job_id)
        .map_err(|e| format!("failed to parse response: {e}"))
}

#[tauri::command]
pub fn analysis_status(state: State<AppState>, job_id: String) -> Result<AnalysisStatus, String> {
    let port = sidecar_port(&state)?;
    let client = http_client()?;

    let response = client
        .get(format!("http://127.0.0.1:{port}/analyze/{job_id}"))
        .send()
        .map_err(|e| format!("failed to poll analysis status: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("sidecar returned {}", response.status()));
    }

    response
        .json()
        .map_err(|e| format!("failed to parse status: {e}"))
}

/// Loads a completed job's stems into the audio engine as separate,
/// independently mutable tracks.
#[tauri::command]
pub fn load_stems(state: State<AppState>, stems: HashMap<String, String>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let paths: Vec<(String, PathBuf)> = stems
        .into_iter()
        .map(|(name, path)| (name, PathBuf::from(path)))
        .collect();
    transport::load_stems(&handle.mixer, &handle.engine_config, &paths)
}
