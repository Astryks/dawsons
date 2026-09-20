//! Opens the default output audio device via cpal and drives it from a
//! shared `MixerState`.
//!
//! `cpal::Stream` is not `Send`, so it can never live in Tauri-managed
//! state directly (which requires `Send + Sync`). Instead, `spawn_audio_thread`
//! builds and owns the stream entirely on a dedicated OS thread that parks
//! until shutdown; only the `Arc<Mutex<MixerState>>` (which *is* `Send + Sync`)
//! is shared with the rest of the app.

use std::sync::mpsc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use super::mixer::SharedMixer;

#[derive(Clone, Copy, Debug)]
pub struct EngineConfig {
    pub sample_rate: u32,
    pub channels: u16,
}

fn build_output_stream(mixer: SharedMixer) -> Result<(cpal::Stream, EngineConfig), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output audio device".to_string())?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("failed to get default output config: {e}"))?;

    let config = supported.config();
    let engine_config = EngineConfig {
        sample_rate: config.sample_rate.0,
        channels: config.channels,
    };

    let err_fn = |err| tracing::error!("audio stream error: {err}");

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                if let Ok(mut mixer) = mixer.lock() {
                    mixer.render(data);
                }
            },
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported output sample format: {other:?}")),
    }
    .map_err(|e| format!("failed to build output stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("failed to start output stream: {e}"))?;

    Ok((stream, engine_config))
}

/// Spawns the dedicated audio thread, blocks until it reports its config
/// (or an error), and returns a shutdown handle. Dropping the returned
/// `Sender` lets the audio thread's blocking `recv()` return, after which
/// it drops the `cpal::Stream` and exits.
pub fn spawn_audio_thread(mixer: SharedMixer) -> Result<(EngineConfig, mpsc::Sender<()>), String> {
    let (config_tx, config_rx) = mpsc::channel::<Result<EngineConfig, String>>();
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

    std::thread::Builder::new()
        .name("dawsons-audio".into())
        .spawn(move || match build_output_stream(mixer) {
            Ok((stream, cfg)) => {
                let _ = config_tx.send(Ok(cfg));
                let _ = shutdown_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = config_tx.send(Err(e));
            }
        })
        .map_err(|e| format!("failed to spawn audio thread: {e}"))?;

    config_rx
        .recv()
        .map_err(|_| "audio thread exited before reporting its config".to_string())?
        .map(|cfg| (cfg, shutdown_tx))
}
