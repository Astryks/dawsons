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
    load_file_with_effects(
        mixer,
        config,
        path,
        &effects::EffectChain {
            reverse,
            semitones,
            ..Default::default()
        },
    )
}

/// Loads a file with the given effect chain applied — the full "isolate a
/// sound, then reshape it" clip-tools pipeline (reverse, pitch, EQ,
/// compression, delay, reverb). See `EffectChain::apply` for the order
/// and for why each stage is free when left at its default.
pub fn load_file_with_effects(
    mixer: &SharedMixer,
    config: &EngineConfig,
    path: &Path,
    chain: &effects::EffectChain,
) -> Result<(), String> {
    let decoded = decode::decode_file(path)?;
    let converted = decode::to_engine_format(&decoded, config.sample_rate, config.channels);
    let processed = chain.apply(&converted, config.channels, config.sample_rate);
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track")
        .to_string();
    load_samples(mixer, vec![(name, processed)]);
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
        start_offset: 0,
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
                start_offset: 0,
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

/// Jumps the shared playhead to `position_sec` — the backing for
/// rewind/fast-forward and a clickable/draggable timeline scrubber.
/// Works whether currently playing or paused (matching the browser
/// DAW's seek behavior): playback, if active, continues from the new
/// position on the very next render callback. Clamped to the longest
/// loaded track's length so seeking past the end doesn't immediately
/// trigger `render`'s "every track exhausted" stop-and-reset.
pub fn seek(mixer: &SharedMixer, position_sec: f64, config: &EngineConfig) -> Result<(), String> {
    let mut state = mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    let channels = config.channels.max(1) as f64;
    let sample_rate = config.sample_rate.max(1) as f64;
    let max_samples = state
        .tracks
        .iter()
        .map(|t| t.samples.len())
        .max()
        .unwrap_or(0);
    let target_samples = (position_sec.max(0.0) * sample_rate * channels).round() as usize;
    state.position = target_samples.min(max_samples);
    Ok(())
}

#[cfg(test)]
mod add_track_tests {
    use super::*;
    use crate::audio_engine::mixer::MixerState;
    use std::sync::Mutex;

    fn empty_mixer() -> SharedMixer {
        Arc::new(Mutex::new(MixerState {
            tracks: vec![],
            position: 0,
            playing: false,
        }))
    }

    fn stereo_config() -> EngineConfig {
        EngineConfig {
            sample_rate: 44100,
            channels: 2,
        }
    }

    /// The "add audio track (no separation)" fallback (item 76) is this
    /// exact function called directly from the `load_clip_into_layer`
    /// Tauri command — confirms it loads a plain audio file as one clean
    /// track with no sidecar/Demucs involvement (there's nothing here to
    /// call it with: no HTTP client, no job id, just decode + push).
    #[test]
    fn add_track_loads_a_plain_wav_as_a_single_named_track() {
        let sample_rate = 44100u32;
        let mut samples = Vec::new();
        for i in 0..sample_rate {
            let t = i as f32 / sample_rate as f32;
            samples.push((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.4);
        }
        let dir = std::env::temp_dir();
        let path = dir.join("dawsons-test-add-track-tone.wav");
        crate::audio_engine::wav_writer::write_wav(&path, &samples, sample_rate, 1).unwrap();

        let mixer = empty_mixer();
        let result = add_track(&mixer, &stereo_config(), &path, "my-tone".to_string());
        let _ = std::fs::remove_file(&path);

        result.expect("plain audio file should load with no sidecar/analysis involved");
        let state = mixer.lock().unwrap();
        assert_eq!(state.tracks.len(), 1);
        assert_eq!(state.tracks[0].name, "my-tone");
        assert!(!state.tracks[0].samples.is_empty());
    }

    /// Same path, but for a video container — confirms the raw-track
    /// fallback also works for a video upload (per item 75's video-upload
    /// fix, now reused here) by decoding just the audio track directly,
    /// alongside whatever track(s) are already loaded (doesn't replace
    /// them, unlike `load_stems`/full-analysis loading).
    #[test]
    fn add_track_loads_an_mp4s_audio_track_alongside_an_existing_track() {
        let path = std::path::Path::new("/Users/sidmehta/Downloads/fortnite.mp4");
        if !path.exists() {
            eprintln!("skipping: fortnite.mp4 not present on this machine");
            return;
        }
        let mixer = empty_mixer();
        add_track(&mixer, &stereo_config(), path, "existing".to_string()).unwrap();
        add_track(&mixer, &stereo_config(), path, "fortnite".to_string()).unwrap();

        let state = mixer.lock().unwrap();
        assert_eq!(
            state.tracks.len(),
            2,
            "add_track must not replace existing tracks"
        );
        assert_eq!(state.tracks[1].name, "fortnite");
        assert!(!state.tracks[1].samples.is_empty());
    }
}

#[cfg(test)]
mod seek_tests {
    use super::*;
    use crate::audio_engine::mixer::{MixerState, TrackBuffer};
    use std::sync::Mutex;

    fn mixer_with_track(len_samples: usize) -> SharedMixer {
        Arc::new(Mutex::new(MixerState {
            tracks: vec![TrackBuffer {
                name: "test".into(),
                samples: Arc::new(vec![0.0; len_samples]),
                gain: 1.0,
                muted: false,
                start_offset: 0,
            }],
            position: 0,
            playing: true,
        }))
    }

    fn stereo_config() -> EngineConfig {
        EngineConfig {
            sample_rate: 44100,
            channels: 2,
        }
    }

    #[test]
    fn seeks_to_the_exact_sample_accurate_position() {
        let mixer = mixer_with_track(44100 * 2 * 10); // 10s stereo track
        seek(&mixer, 2.5, &stereo_config()).unwrap();
        let position = mixer.lock().unwrap().position;
        // 2.5s * 44100 * 2 channels
        assert_eq!(position, 220_500);
    }

    #[test]
    fn seeking_past_the_end_clamps_instead_of_stopping_playback() {
        let mixer = mixer_with_track(1000);
        seek(&mixer, 9999.0, &stereo_config()).unwrap();
        let state = mixer.lock().unwrap();
        assert_eq!(state.position, 1000);
        assert!(state.playing, "seeking must not itself stop playback");
    }

    #[test]
    fn negative_positions_clamp_to_zero() {
        let mixer = mixer_with_track(1000);
        seek(&mixer, -5.0, &stereo_config()).unwrap();
        assert_eq!(mixer.lock().unwrap().position, 0);
    }

    #[test]
    fn seeking_does_not_disturb_the_playing_flag() {
        let mixer = mixer_with_track(1000);
        mixer.lock().unwrap().playing = false;
        seek(&mixer, 0.001, &stereo_config()).unwrap();
        assert!(
            !mixer.lock().unwrap().playing,
            "seek while paused must stay paused"
        );
    }
}
