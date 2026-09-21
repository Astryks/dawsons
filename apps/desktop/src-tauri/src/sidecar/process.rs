//! Spawns, health-checks, and supervises the Python AI sidecar on a
//! dedicated OS thread — the same "own it on one thread, share only plain
//! state" shape as audio_engine::device, since `Child` and its pipes have
//! similar cross-thread-handle issues.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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

/// How to actually launch the sidecar process — resolved once per spawn
/// attempt rather than baked into a single hardcoded path, since dev and
/// packaged builds genuinely run a different thing (M8): dev spawns the
/// repo's own venv Python (scripts/setup_dev.sh); a packaged build runs
/// the PyInstaller-frozen binary bundled as a Tauri resource (see
/// scripts/build_sidecar.sh and tauri.conf.json's `bundle.resources`) —
/// a real end user's machine has no Python at all.
enum SidecarLaunch {
    Frozen {
        executable: PathBuf,
        working_dir: PathBuf,
    },
    DevPython {
        python: PathBuf,
        working_dir: PathBuf,
    },
}

fn resolve_launch(app: &AppHandle) -> Result<SidecarLaunch, String> {
    // A --onedir PyInstaller build is a directory of files, not a single
    // relocatable binary — bundled under Resources/dawsons-sidecar/ (see
    // tauri.conf.json), with the actual executable of the same name
    // nested one level inside that directory.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let executable = resource_dir.join("dawsons-sidecar").join("dawsons-sidecar");
        if executable.exists() {
            let working_dir = executable
                .parent()
                .expect("executable path always has a parent")
                .to_path_buf();
            return Ok(SidecarLaunch::Frozen {
                executable,
                working_dir,
            });
        }
    }

    let dir = sidecar_dir();
    let python = dir.join(".venv/bin/python");
    if !python.exists() {
        return Err(format!(
            "no frozen sidecar bundled and no dev venv found at {python:?} — run ./scripts/setup_dev.sh first"
        ));
    }
    Ok(SidecarLaunch::DevPython {
        python,
        working_dir: dir,
    })
}

fn spawn_child(app: &AppHandle) -> Result<(Child, u16), String> {
    let launch = resolve_launch(app)?;
    let mut command = match &launch {
        SidecarLaunch::Frozen {
            executable,
            working_dir,
        } => {
            let mut c = Command::new(executable);
            c.current_dir(working_dir);
            c
        }
        SidecarLaunch::DevPython {
            python,
            working_dir,
        } => {
            let mut c = Command::new(python);
            c.args(["-m", "app.main"]).current_dir(working_dir);
            c
        }
    };

    let mut child = command
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

/// Whether an unexpected sidecar exit should trigger a restart — restart
/// exactly once, then give up. Pulled out of `supervise()`'s loop as its
/// own pure state machine (no process/IO involved) specifically so this
/// decision is unit-testable on its own: the actual spawn/health-check
/// path is heavy (a real child process, a real AppHandle) and is instead
/// covered by actually launching the app end-to-end (see STATUS.md), not
/// a unit test — but the *decision logic* had no coverage at all before,
/// which is the gap this closes.
#[derive(Default)]
struct RestartPolicy {
    already_restarted: bool,
}

enum RestartDecision {
    Restart,
    GiveUp,
}

impl RestartPolicy {
    fn on_crash(&mut self) -> RestartDecision {
        if self.already_restarted {
            RestartDecision::GiveUp
        } else {
            self.already_restarted = true;
            RestartDecision::Restart
        }
    }
}

fn supervise(app: AppHandle, status: Arc<Mutex<SidecarStatus>>, shutdown_rx: mpsc::Receiver<()>) {
    let mut child = match start_and_confirm(&app, &status) {
        Some(child) => child,
        None => return, // spawn/health-check failed; status already set to Error
    };

    let mut restart_policy = RestartPolicy::default();
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
                match restart_policy.on_crash() {
                    RestartDecision::GiveUp => {
                        set_status(
                            &status,
                            &app,
                            SidecarStatus::Error {
                                message: "sidecar crashed twice, giving up".into(),
                            },
                        );
                        return;
                    }
                    RestartDecision::Restart => {
                        set_status(&status, &app, SidecarStatus::Starting);
                        match start_and_confirm(&app, &status) {
                            Some(new_child) => child = new_child,
                            None => return,
                        }
                    }
                }
            }
            Ok(None) => continue, // still running
            Err(e) => tracing::error!("failed to poll sidecar status: {e}"),
        }
    }
}

fn start_and_confirm(app: &AppHandle, status: &Arc<Mutex<SidecarStatus>>) -> Option<Child> {
    let (child, port) = match spawn_child(app) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("sidecar spawn failed: {e}");
            set_status(status, app, SidecarStatus::Error { message: e });
            return None;
        }
    };
    // 60s, not 15s: a packaged build's frozen sidecar has a real,
    // measured cold-start of up to ~45s (loading ~1.2GB of bundled
    // shared libraries on first launch) — confirmed by actually timing
    // it, not assumed. The dev venv path is near-instant regardless, so
    // this only affects how long a genuinely broken startup takes to
    // report an error, not the common case.
    if let Err(e) = wait_for_health(port, Duration::from_secs(60)) {
        tracing::error!("sidecar health check failed: {e}");
        set_status(status, app, SidecarStatus::Error { message: e });
        return None;
    }
    tracing::info!("sidecar ready on port {port}");
    set_status(status, app, SidecarStatus::Ready { port });
    Some(child)
}

#[cfg(test)]
mod restart_policy_tests {
    use super::*;

    #[test]
    fn first_crash_triggers_a_restart() {
        let mut policy = RestartPolicy::default();
        assert!(matches!(policy.on_crash(), RestartDecision::Restart));
    }

    #[test]
    fn second_crash_gives_up_rather_than_restarting_indefinitely() {
        let mut policy = RestartPolicy::default();
        let _ = policy.on_crash();
        assert!(matches!(policy.on_crash(), RestartDecision::GiveUp));
    }

    #[test]
    fn giving_up_is_sticky_for_any_further_crashes() {
        let mut policy = RestartPolicy::default();
        let _ = policy.on_crash();
        let _ = policy.on_crash();
        assert!(matches!(policy.on_crash(), RestartDecision::GiveUp));
    }
}
