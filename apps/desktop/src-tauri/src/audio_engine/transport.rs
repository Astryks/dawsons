//! Play/pause/stop and file loading on top of a shared `MixerState`.
//! Thin on purpose: all real state lives in `MixerState` so the audio
//! callback and these command-side mutations agree on one source of truth.

use std::path::Path;
use std::sync::Arc;

use super::decode;
use super::device::EngineConfig;
use super::effects;
use super::mixer::{SharedMixer, TrackBuffer};

pub fn load_test_track(
    mixer: &SharedMixer,
    config: &EngineConfig,
    path: &Path,
) -> Result<(), String> {
    let decoded = decode::decode_file(path)?;
    let converted = decode::to_engine_format(&decoded, config.sample_rate, config.channels);
    load_samples(mixer, converted);
    Ok(())
}

/// Loads a file with reverse and/or pitch shift applied — the "reverse a
/// clip and re-pitch it to find a new sound" tool.
pub fn load_test_track_with_effects(
    mixer: &SharedMixer,
    config: &EngineConfig,
    path: &Path,
    reverse: bool,
    semitones: f32,
) -> Result<(), String> {
    let decoded = decode::decode_file(path)?;
    let mut converted = decode::to_engine_format(&decoded, config.sample_rate, config.channels);
    if reverse {
        converted = effects::reverse(&converted, config.channels);
    }
    if semitones != 0.0 {
        converted = effects::pitch_shift_by_resampling(
            &converted,
            config.channels,
            config.sample_rate,
            semitones,
        );
    }
    load_samples(mixer, converted);
    Ok(())
}

fn load_samples(mixer: &SharedMixer, samples: Vec<f32>) {
    if let Ok(mut state) = mixer.lock() {
        state.tracks = vec![TrackBuffer {
            samples: Arc::new(samples),
            gain: 1.0,
            muted: false,
        }];
        state.position = 0;
        state.playing = false;
    }
}

pub fn play(mixer: &SharedMixer) -> Result<(), String> {
    mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?
        .playing = true;
    Ok(())
}

pub fn pause(mixer: &SharedMixer) -> Result<(), String> {
    mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?
        .playing = false;
    Ok(())
}

pub fn stop(mixer: &SharedMixer) -> Result<(), String> {
    let mut state = mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    state.playing = false;
    state.position = 0;
    Ok(())
}
