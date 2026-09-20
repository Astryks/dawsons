//! Thin HTTP client to the sidecar's endpoints. Health-check and shutdown
//! for now; `/analyze` client calls land with M4.

use std::time::Duration;

pub fn health_check(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|e| format!("failed to build health-check client: {e}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("health check request failed: {e}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "health check returned status {}",
            response.status()
        ))
    }
}

/// Best-effort graceful shutdown request. The supervisor force-kills the
/// process afterward if it hasn't exited within a few seconds, so a failed
/// request here (e.g. the sidecar already died) is not itself an error.
pub fn request_shutdown(port: u16) {
    let url = format!("http://127.0.0.1:{port}/shutdown");
    if let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
    {
        let _ = client.post(url).send();
    }
}
