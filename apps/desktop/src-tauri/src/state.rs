use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use crate::audio_engine::{self, EngineConfig, SharedMixer};

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
/// report "audio engine unavailable" instead of panicking).
///
/// M3 adds the sidecar process/client here; M4-M5 add the in-memory Scene
/// Graph mirror backing the SQLite store.
#[derive(Default)]
pub struct AppState {
    pub audio: Mutex<Option<AudioEngineHandle>>,
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
}
