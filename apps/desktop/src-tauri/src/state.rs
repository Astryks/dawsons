use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::AppHandle;

use crate::audio_engine::{self, capture::RecordingHandle, EngineConfig, SharedMixer};
use crate::scene_graph::store;
use crate::sidecar;

/// Handle to a running audio engine: the shared mixer state plus a
/// shutdown sender for the dedicated audio thread that owns the actual
/// `cpal::Stream` (which can't live in this struct directly — see
/// audio_engine::device).
pub struct AudioEngineHandle {
    pub mixer: SharedMixer,
    pub engine_config: EngineConfig,
    _shutdown: Sender<()>,
}

/// Shared application state handed to Tauri commands via `tauri::State`.
///
/// `audio` is `None` until `init_audio` succeeds (or if no output device
/// is available at all — the shell still boots, playback commands just
/// report "audio engine unavailable" instead of panicking). `sidecar_handle`
/// is set as soon as the supervisor thread is spawned; its `status` field
/// tracks whether the Python process is actually up yet.
///
/// M4-M5 add the in-memory Scene Graph mirror backing the SQLite store.
#[derive(Default)]
pub struct AppState {
    pub audio: Mutex<Option<AudioEngineHandle>>,
    pub sidecar_handle: Mutex<Option<sidecar::SidecarHandle>>,
    pub db: Mutex<Option<Connection>>,
    pub voice_recording: Mutex<Option<RecordingHandle>>,
}

impl AppState {
    pub fn init_audio(&self) {
        let mixer: SharedMixer = Arc::new(Mutex::new(Default::default()));
        match audio_engine::spawn_audio_thread(mixer.clone()) {
            Ok((engine_config, shutdown)) => {
                tracing::info!(
                    "audio engine ready: {} Hz, {} channel(s)",
                    engine_config.sample_rate,
                    engine_config.channels
                );
                *self.audio.lock().expect("audio state poisoned") = Some(AudioEngineHandle {
                    mixer,
                    engine_config,
                    _shutdown: shutdown,
                });
            }
            Err(e) => {
                tracing::error!("audio engine unavailable: {e}");
            }
        }
    }

    pub fn init_sidecar(&self, app: AppHandle) {
        let handle = sidecar::spawn(app);
        *self.sidecar_handle.lock().expect("sidecar state poisoned") = Some(handle);
    }

    pub fn init_db(&self, app: &AppHandle) {
        match store::open_db(app) {
            Ok(conn) => {
                tracing::info!("project database ready");
                *self.db.lock().expect("db state poisoned") = Some(conn);
            }
            Err(e) => tracing::error!("failed to open project database: {e}"),
        }
    }
}
