//! Kicks off a sidecar analysis job, polls its status, and loads the
//! resulting stems into the audio engine once done. Rust proxies to the
//! sidecar's HTTP API rather than exposing it to the frontend directly
//! (see ADR 0001) — the frontend only ever calls these Tauri commands.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio_engine::transport;
use crate::sidecar::SidecarStatus;
use crate::state::AppState;

/// `result` is kept as a raw JSON `Value` rather than a fixed struct: it's
/// the full Scene-Graph-shaped fragment (see
/// packages/scene-graph-schema/schema/scene-graph.schema.json), which is
/// validated on the Python side already — Rust just needs to read a few
/// fields out of it (see `load_stems_from_result`) and persist the rest
/// verbatim into the project's `scene_graphs` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisStatus {
    pub job_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub progress: f64,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

pub(crate) fn sidecar_port(state: &State<AppState>) -> Result<u16, String> {
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

pub(crate) fn http_client() -> Result<reqwest::blocking::Client, String> {
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

/// Pulls `{name, audioFilePath}` out of each entry in `result.song.tracks`
/// and loads them into the audio engine as separate, independently
/// mutable tracks.
#[tauri::command]
pub fn load_stems_from_result(
    state: State<AppState>,
    result: serde_json::Value,
) -> Result<(), String> {
    let tracks = result
        .get("song")
        .and_then(|s| s.get("tracks"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| "analysis result has no song.tracks array".to_string())?;

    let mut paths: Vec<(String, PathBuf)> = Vec::with_capacity(tracks.len());
    for track in tracks {
        let name = track
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "track missing name".to_string())?
            .to_string();
        let path = track
            .get("audioFilePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("track {name} missing audioFilePath"))?;
        paths.push((name, PathBuf::from(path)));
    }

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    transport::load_stems(&handle.mixer, &handle.engine_config, &paths)
}
