//! Spawns, health-checks, and supervises the Python AI sidecar on a
//! dedicated OS thread — the same "own it on one thread, share only plain
//! state" shape as audio_engine::device, since `Child` and its pipes have
//! similar cross-thread-handle issues.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::client;

#[derive(Debug, Deserialize)]
struct ReadyMessage {
    status: String,
    port: Option<u16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SidecarStatus {
    Starting,
    Ready { port: u16 },
    Error { message: String },
}

pub struct SidecarHandle {
    pub status: Arc<Mutex<SidecarStatus>>,
    shutdown_tx: mpsc::Sender<()>,
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(());
    }
}

fn sidecar_dir() -> PathBuf {
    // apps/desktop/src-tauri -> apps/desktop -> apps -> repo root -> services/ai-sidecar
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../services/ai-sidecar")
}

fn python_binary(dir: &Path) -> PathBuf {
    // Dev: the venv created by scripts/setup_dev.sh. Packaged builds swap
    // this for a PyInstaller-frozen sidecar binary bundled via Tauri's
    // external-binary mechanism instead of spawning a system Python (M8).
    dir.join(".venv/bin/python")
}

fn spawn_child(dir: &Path) -> Result<(Child, u16), String> {
    let python = python_binary(dir);
    if !python.exists() {
        return Err(format!(
            "sidecar venv not found at {python:?} — run ./scripts/setup_dev.sh first"
        ));
    }

    let mut child = Command::new(&python)
        .args(["-m", "app.main"])
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let stdout = child.stdout.take().ok_or("sidecar stdout not captured")?;
    let mut lines = BufReader::new(stdout).lines();

    let line = lines
        .next()
        .ok_or_else(|| "sidecar exited before printing a ready line".to_string())?
        .map_err(|e| format!("failed to read sidecar stdout: {e}"))?;

    let msg: ReadyMessage = serde_json::from_str(&line)
        .map_err(|e| format!("unexpected sidecar startup line {line:?}: {e}"))?;
    if msg.status != "ready" {
        return Err(format!("sidecar reported non-ready status: {}", msg.status));
    }
    let port = msg
        .port
        .ok_or_else(|| "sidecar ready message missing port".to_string())?;

    drain_log(lines, "sidecar[stdout]");
    if let Some(stderr) = child.stderr.take() {
        drain_log(BufReader::new(stderr).lines(), "sidecar[stderr]");
    }

    Ok((child, port))
}

fn drain_log<R: BufRead + Send + 'static>(mut lines: std::io::Lines<R>, label: &'static str) {
    std::thread::spawn(move || {
        while let Some(Ok(line)) = lines.next() {
            tracing::info!("{label}: {line}");
        }
    });
}

fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = "health check never attempted".to_string();
    while Instant::now() < deadline {
        match client::health_check(port) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e,
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "sidecar did not become healthy within {timeout:?}: {last_err}"
    ))
}

fn set_status(status: &Arc<Mutex<SidecarStatus>>, app: &AppHandle, new_status: SidecarStatus) {
    if let Ok(mut guard) = status.lock() {
        *guard = new_status.clone();
    }
    let _ = app.emit("sidecar:status", new_status);
}

/// Spawns the sidecar, health-checks it, and hands back a handle whose
/// `status` reflects the current state (also pushed to the frontend as
/// `sidecar:status` events). Supervision (restart-once on crash, graceful
/// shutdown) runs on the dedicated thread for the handle's lifetime.
pub fn spawn(app: AppHandle) -> SidecarHandle {
    let status = Arc::new(Mutex::new(SidecarStatus::Starting));
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

    let status_for_thread = status.clone();
    std::thread::Builder::new()
        .name("dawsons-sidecar".into())
        .spawn(move || supervise(app, status_for_thread, shutdown_rx))
        .expect("failed to spawn sidecar supervisor thread");

    SidecarHandle {
        status,
        shutdown_tx,
    }
}

fn supervise(app: AppHandle, status: Arc<Mutex<SidecarStatus>>, shutdown_rx: mpsc::Receiver<()>) {
    let dir = sidecar_dir();

    let mut child = match start_and_confirm(&dir, &app, &status) {
        Some(child) => child,
        None => return, // spawn/health-check failed; status already set to Error
    };

    let mut restarted_once = false;
    loop {
        if shutdown_rx.recv_timeout(Duration::from_millis(500)).is_ok() {
            let current = status
                .lock()
                .map(|s| s.clone())
                .unwrap_or(SidecarStatus::Starting);
            if let SidecarStatus::Ready { port } = current {
                client::request_shutdown(port);
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline && !matches!(child.try_wait(), Ok(Some(_))) {
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            return;
        }

        match child.try_wait() {
            Ok(Some(exit_status)) => {
                tracing::error!("sidecar exited unexpectedly: {exit_status}");
                if restarted_once {
                    set_status(
                        &status,
                        &app,
                        SidecarStatus::Error {
                            message: "sidecar crashed twice, giving up".into(),
                        },
                    );
                    return;
                }
                restarted_once = true;
                set_status(&status, &app, SidecarStatus::Starting);
                match start_and_confirm(&dir, &app, &status) {
                    Some(new_child) => child = new_child,
                    None => return,
                }
            }
            Ok(None) => continue, // still running
            Err(e) => tracing::error!("failed to poll sidecar status: {e}"),
        }
    }
}

fn start_and_confirm(
    dir: &Path,
    app: &AppHandle,
    status: &Arc<Mutex<SidecarStatus>>,
) -> Option<Child> {
    let (child, port) = match spawn_child(dir) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("sidecar spawn failed: {e}");
            set_status(status, app, SidecarStatus::Error { message: e });
            return None;
        }
    };
    if let Err(e) = wait_for_health(port, Duration::from_secs(15)) {
        tracing::error!("sidecar health check failed: {e}");
        set_status(status, app, SidecarStatus::Error { message: e });
        return None;
    }
    tracing::info!("sidecar ready on port {port}");
    set_status(status, app, SidecarStatus::Ready { port });
    Some(child)
}
