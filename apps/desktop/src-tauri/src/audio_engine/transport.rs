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
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track")
        .to_string();
    load_samples(mixer, vec![(name, converted)]);
    Ok(())
}

/// Loads several files as separate simultaneous tracks — e.g. the stems a
/// Demucs analysis job produced — replacing whatever was previously loaded.
pub fn load_stems(
    mixer: &SharedMixer,
    config: &EngineConfig,
    stems: &[(String, std::path::PathBuf)],
) -> Result<(), String> {
    let mut loaded = Vec::with_capacity(stems.len());
    for (name, path) in stems {
        let decoded = decode::decode_file(path)?;
        let converted = decode::to_engine_format(&decoded, config.sample_rate, config.channels);
        loaded.push((name.clone(), converted));
    }
    load_samples(mixer, loaded);
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
    load_file_with_effects(mixer, config, path, reverse, semitones, 0.0, 0.0)
}

/// Loads a file with reverse, pitch shift, and/or reverb applied — the
/// full "isolate a sound, then reshape it" clip-tools chain. `reverb_wet`
/// and `reverb_room` are both 0..1; `reverb_wet` of 0 skips reverb
/// entirely (no cost paid for an effect that isn't in use).
#[allow(clippy::too_many_arguments)]
pub fn load_file_with_effects(
    mixer: &SharedMixer,
    config: &EngineConfig,
    path: &Path,
    reverse: bool,
    semitones: f32,
    reverb_wet: f32,
    reverb_room: f32,
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
    if reverb_wet > 0.0 {
        converted = effects::reverb(
            &converted,
            config.channels,
            config.sample_rate,
            reverb_wet,
            reverb_room,
        );
    }
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track")
        .to_string();
    load_samples(mixer, vec![(name, converted)]);
    Ok(())
}

/// Adds one file as a new track alongside whatever's already loaded,
/// rather than replacing the whole mixer state — the "smart upload" tool
/// drops a classified clip into its own layer without disturbing the
/// tracks already on the timeline.
pub fn add_track(
    mixer: &SharedMixer,
    config: &EngineConfig,
    path: &Path,
    name: String,
) -> Result<(), String> {
    let decoded = decode::decode_file(path)?;
    let converted = decode::to_engine_format(&decoded, config.sample_rate, config.channels);
    let mut state = mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    state.tracks.push(TrackBuffer {
        name,
        samples: Arc::new(converted),
        gain: 1.0,
        muted: false,
    });
    Ok(())
}

fn load_samples(mixer: &SharedMixer, tracks: Vec<(String, Vec<f32>)>) {
    if let Ok(mut state) = mixer.lock() {
        state.tracks = tracks
            .into_iter()
            .map(|(name, samples)| TrackBuffer {
                name,
                samples: Arc::new(samples),
                gain: 1.0,
                muted: false,
            })
            .collect();
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
