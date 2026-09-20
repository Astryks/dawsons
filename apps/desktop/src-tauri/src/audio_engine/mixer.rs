//! Sample-accurate multi-track mixing, called from the cpal output callback.
//!
//! `MixerState` lives behind a `Mutex` shared between the audio thread (which
//! only ever calls `render`) and command handlers (which load tracks and
//! toggle transport state). Kept lock-hold-time minimal since `render` runs
//! on the real-time audio callback thread.

use std::sync::{Arc, Mutex};

pub struct TrackBuffer {
    /// Interleaved samples already converted to the engine's output
    /// sample rate and channel count (see decode::to_engine_format).
    pub samples: Arc<Vec<f32>>,
    pub gain: f32,
    pub muted: bool,
}

#[derive(Default)]
pub struct MixerState {
    pub tracks: Vec<TrackBuffer>,
    /// Shared interleaved-sample playhead across all tracks.
    pub position: usize,
    pub playing: bool,
}

pub type SharedMixer = Arc<Mutex<MixerState>>;

impl MixerState {
    /// Fills `out` (interleaved) by summing unmuted tracks at the current
    /// position, advances the shared position, and stops playback once
    /// every track is exhausted.
    pub fn render(&mut self, out: &mut [f32]) {
        for sample in out.iter_mut() {
            *sample = 0.0;
        }
        if !self.playing || self.tracks.is_empty() {
            return;
        }
        for track in &self.tracks {
            if track.muted {
                continue;
            }
            for (i, sample) in out.iter_mut().enumerate() {
                if let Some(&s) = track.samples.get(self.position + i) {
                    *sample += s * track.gain;
                }
            }
        }
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
        self.position += out.len();
        if self.tracks.iter().all(|t| self.position >= t.samples.len()) {
            self.playing = false;
            self.position = 0;
        }
    }

    /// Offline (non-realtime) bounce of every unmuted track, summed across
    /// the full length of the longest track — for export, not playback.
    pub fn render_full_mix(&self) -> Vec<f32> {
        let len = self
            .tracks
            .iter()
            .map(|t| t.samples.len())
            .max()
            .unwrap_or(0);
        let mut out = vec![0.0f32; len];
        for track in &self.tracks {
            if track.muted {
                continue;
            }
            for (i, sample) in track.samples.iter().enumerate() {
                out[i] += sample * track.gain;
            }
        }
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(samples: Vec<f32>) -> TrackBuffer {
        TrackBuffer {
            samples: Arc::new(samples),
            gain: 1.0,
            muted: false,
        }
    }

    #[test]
    fn silent_when_not_playing() {
        let mut state = MixerState {
            tracks: vec![track(vec![1.0, 1.0])],
            position: 0,
            playing: false,
        };
        let mut out = [0.5, 0.5];
        state.render(&mut out);
        assert_eq!(out, [0.0, 0.0]);
    }

    #[test]
    fn sums_unmuted_tracks_and_advances_position() {
        let mut state = MixerState {
            tracks: vec![
                track(vec![0.1, 0.2, 0.3, 0.4]),
                track(vec![0.1, 0.1, 0.1, 0.1]),
            ],
            position: 0,
            playing: true,
        };
        let mut out = [0.0, 0.0];
        state.render(&mut out);
        assert!((out[0] - 0.2).abs() < 1e-6);
        assert!((out[1] - 0.3).abs() < 1e-6);
        assert_eq!(state.position, 2);
    }

    #[test]
    fn muted_track_is_excluded() {
        let mut muted = track(vec![1.0, 1.0]);
        muted.muted = true;
        let mut state = MixerState {
            tracks: vec![track(vec![0.2, 0.2]), muted],
            position: 0,
            playing: true,
        };
        let mut out = [0.0, 0.0];
        state.render(&mut out);
        assert_eq!(out, [0.2, 0.2]);
    }

    #[test]
    fn stops_and_resets_once_exhausted() {
        let mut state = MixerState {
            tracks: vec![track(vec![1.0, 1.0])],
            position: 0,
            playing: true,
        };
        let mut out = [0.0, 0.0];
        state.render(&mut out); // consumes the only two samples
        assert!(!state.playing);
        assert_eq!(state.position, 0);
    }

    #[test]
    fn full_mix_sums_across_the_longest_track_length() {
        let state = MixerState {
            tracks: vec![track(vec![0.2, 0.2, 0.2, 0.2]), track(vec![0.1, 0.1])],
            position: 0,
            playing: false,
        };
        let mix = state.render_full_mix();
        assert_eq!(mix.len(), 4);
        assert!((mix[0] - 0.3).abs() < 1e-6);
        assert!((mix[2] - 0.2).abs() < 1e-6); // second track exhausted here
    }

    #[test]
    fn full_mix_excludes_muted_tracks() {
        let mut muted = track(vec![1.0, 1.0]);
        muted.muted = true;
        let state = MixerState {
            tracks: vec![track(vec![0.3, 0.3]), muted],
            position: 0,
            playing: false,
        };
        assert_eq!(state.render_full_mix(), vec![0.3, 0.3]);
    }
}
