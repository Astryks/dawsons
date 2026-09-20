//! Microphone capture for Voice Notes — the mirror of device.rs's output
//! path: a cpal *input* stream instead of output, appending into a shared
//! buffer instead of reading from the mixer. Same "own the Stream on a
//! dedicated thread" constraint applies (cpal::Stream isn't Send).

use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use super::device::EngineConfig;

pub type CapturedSamples = Arc<Mutex<Vec<f32>>>;

pub struct RecordingHandle {
    buffer: CapturedSamples,
    pub engine_config: EngineConfig,
    stop_tx: mpsc::Sender<()>,
}

impl RecordingHandle {
    /// Stops capture and returns everything recorded (interleaved, at
    /// `engine_config`'s sample rate/channel count).
    pub fn stop(self) -> Vec<f32> {
        let _ = self.stop_tx.send(());
        // Give the capture thread a moment to receive the stop signal and
        // drop the input stream before reading the final buffer.
        std::thread::sleep(std::time::Duration::from_millis(50));
        self.buffer.lock().map(|b| b.clone()).unwrap_or_default()
    }
}

fn build_input_stream(buffer: CapturedSamples) -> Result<(cpal::Stream, EngineConfig), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no default input audio device".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("failed to get default input config: {e}"))?;

    let config = supported.config();
    let engine_config = EngineConfig {
        sample_rate: config.sample_rate.0,
        channels: config.channels,
    };

    let err_fn = |err| tracing::error!("audio input stream error: {err}");

    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = buffer.lock() {
                    buf.extend_from_slice(data);
                }
            },
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported input sample format: {other:?}")),
    }
    .map_err(|e| format!("failed to build input stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("failed to start input stream: {e}"))?;
    Ok((stream, engine_config))
}

/// Spawns a dedicated thread owning the input stream, recording into a
/// shared buffer until `RecordingHandle::stop` is called.
pub fn start_recording() -> Result<RecordingHandle, String> {
    let buffer: CapturedSamples = Arc::new(Mutex::new(Vec::new()));
    let (config_tx, config_rx) = mpsc::channel::<Result<EngineConfig, String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let buffer_for_thread = buffer.clone();
    std::thread::Builder::new()
        .name("dawsons-capture".into())
        .spawn(move || match build_input_stream(buffer_for_thread) {
            Ok((stream, cfg)) => {
                let _ = config_tx.send(Ok(cfg));
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = config_tx.send(Err(e));
            }
        })
        .map_err(|e| format!("failed to spawn capture thread: {e}"))?;

    config_rx
        .recv()
        .map_err(|_| "capture thread exited before reporting its config".to_string())?
        .map(|cfg| RecordingHandle {
            buffer,
            engine_config: cfg,
            stop_tx,
        })
}
