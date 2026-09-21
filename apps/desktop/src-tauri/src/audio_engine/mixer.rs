//! Sample-accurate multi-track mixing, called from the cpal output callback.
//!
//! `MixerState` lives behind a `Mutex` shared between the audio thread (which
//! only ever calls `render`) and command handlers (which load tracks and
//! toggle transport state). Kept lock-hold-time minimal since `render` runs
//! on the real-time audio callback thread.

use std::sync::{Arc, Mutex};

pub struct TrackBuffer {
    pub name: String,
    /// Interleaved samples already converted to the engine's output
    /// sample rate and channel count (see decode::to_engine_format).
    pub samples: Arc<Vec<f32>>,
    pub gain: f32,
    pub muted: bool,
    /// Interleaved-sample delay before this track's audio starts,
    /// relative to the shared timeline position 0 — the backing for
    /// dragging a region to a different point on the timeline. Silence
    /// plays until the shared playhead reaches this offset.
    pub start_offset: usize,
}

#[derive(Default)]
pub struct MixerState {
    pub tracks: Vec<TrackBuffer>,
    /// Shared interleaved-sample playhead across all tracks.
    pub position: usize,
    pub playing: bool,
}

pub type SharedMixer = Arc<Mutex<MixerState>>;

#[derive(Clone, Debug, serde::Serialize)]
pub struct TrackInfo {
    pub name: String,
    pub muted: bool,
    /// Interleaved sample count — left as raw samples here since
    /// `MixerState` doesn't know the engine's sample rate/channel count;
    /// callers with an `EngineConfig` convert this to seconds.
    pub len_samples: usize,
    pub start_offset_samples: usize,
}

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
                let global_pos = self.position + i;
                if global_pos < track.start_offset {
                    continue; // silence before this track's dragged-to start point
                }
                if let Some(&s) = track.samples.get(global_pos - track.start_offset) {
                    *sample += s * track.gain;
                }
            }
        }
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
        self.position += out.len();
        if self
            .tracks
            .iter()
            .all(|t| self.position >= t.start_offset + t.samples.len())
        {
            self.playing = false;
            self.position = 0;
        }
    }

    pub fn track_info(&self) -> Vec<TrackInfo> {
        self.tracks
            .iter()
            .map(|t| TrackInfo {
                name: t.name.clone(),
                muted: t.muted,
                len_samples: t.samples.len(),
                start_offset_samples: t.start_offset,
            })
            .collect()
    }

    /// Moves a track's region to start at `offset_samples` on the shared
    /// timeline instead of wherever it currently starts — the backing
    /// for dragging a region left/right in the timeline UI.
    pub fn set_track_offset(&mut self, index: usize, offset_samples: usize) -> Result<(), String> {
        let track = self
            .tracks
            .get_mut(index)
            .ok_or_else(|| format!("no track at index {index}"))?;
        track.start_offset = offset_samples;
        Ok(())
    }

    pub fn set_muted(&mut self, index: usize, muted: bool) -> Result<(), String> {
        let track = self
            .tracks
            .get_mut(index)
            .ok_or_else(|| format!("no track at index {index}"))?;
        track.muted = muted;
        Ok(())
    }

    /// Moves the track at `from` to sit at `to` in the layer order — the
    /// backing for a "reorder layers" UI (up/down, or a future drag).
    pub fn move_track(&mut self, from: usize, to: usize) -> Result<(), String> {
        if from >= self.tracks.len() || to >= self.tracks.len() {
            return Err(format!(
                "track index out of range (from={from}, to={to}, len={})",
                self.tracks.len()
            ));
        }
        let track = self.tracks.remove(from);
        self.tracks.insert(to, track);
        Ok(())
    }

    /// Removes a layer entirely — the backing for a "delete this layer"
    /// button, resetting playback since sample positions may no longer
    /// line up meaningfully once a layer's gone.
    pub fn remove_track(&mut self, index: usize) -> Result<(), String> {
        if index >= self.tracks.len() {
            return Err(format!("no track at index {index}"));
        }
        self.tracks.remove(index);
        self.playing = false;
        self.position = 0;
        Ok(())
    }

    /// Offline (non-realtime) bounce of every unmuted track, summed across
    /// the full length of the longest track — for export, not playback.
    pub fn render_full_mix(&self) -> Vec<f32> {
        let len = self
            .tracks
            .iter()
            .map(|t| t.start_offset + t.samples.len())
            .max()
            .unwrap_or(0);
        let mut out = vec![0.0f32; len];
        for track in &self.tracks {
            if track.muted {
                continue;
            }
            for (i, sample) in track.samples.iter().enumerate() {
                out[track.start_offset + i] += sample * track.gain;
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
            name: "test".into(),
            samples: Arc::new(samples),
            gain: 1.0,
            muted: false,
            start_offset: 0,
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

    fn named_track(name: &str) -> TrackBuffer {
        TrackBuffer {
            name: name.to_string(),
            samples: Arc::new(vec![0.0]),
            gain: 1.0,
            muted: false,
            start_offset: 0,
        }
    }

    #[test]
    fn move_track_reorders_layers() {
        let mut state = MixerState {
            tracks: vec![named_track("a"), named_track("b"), named_track("c")],
            position: 0,
            playing: false,
        };
        state.move_track(0, 2).unwrap();
        let names: Vec<_> = state.tracks.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["b", "c", "a"]);
    }

    #[test]
    fn move_track_out_of_range_errors() {
        let mut state = MixerState {
            tracks: vec![named_track("a")],
            position: 0,
            playing: false,
        };
        assert!(state.move_track(0, 5).is_err());
    }

    #[test]
    fn remove_track_drops_it_and_resets_playback() {
        let mut state = MixerState {
            tracks: vec![named_track("a"), named_track("b")],
            position: 10,
            playing: true,
        };
        state.remove_track(0).unwrap();
        let names: Vec<_> = state.tracks.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["b"]);
        assert!(!state.playing);
        assert_eq!(state.position, 0);
    }

    #[test]
    fn remove_track_out_of_range_errors() {
        let mut state = MixerState {
            tracks: vec![named_track("a")],
            position: 0,
            playing: false,
        };
        assert!(state.remove_track(5).is_err());
    }

    #[test]
    fn track_info_reports_sample_length() {
        let state = MixerState {
            tracks: vec![track(vec![0.1, 0.2, 0.3])],
            position: 0,
            playing: false,
        };
        assert_eq!(state.track_info()[0].len_samples, 3);
    }

    #[test]
    fn a_track_is_silent_before_its_start_offset() {
        let mut delayed = track(vec![1.0, 1.0]);
        delayed.start_offset = 2;
        let mut state = MixerState {
            tracks: vec![delayed],
            position: 0,
            playing: true,
        };
        let mut out = [0.0; 2];
        state.render(&mut out);
        assert_eq!(
            out,
            [0.0, 0.0],
            "region hasn't started yet — must be silent"
        );
    }

    #[test]
    fn a_track_plays_its_own_samples_once_the_shared_position_reaches_its_offset() {
        let mut delayed = track(vec![0.5, 0.5]);
        delayed.start_offset = 2;
        let mut state = MixerState {
            tracks: vec![delayed],
            position: 2,
            playing: true,
        };
        let mut out = [0.0; 2];
        state.render(&mut out);
        assert_eq!(out, [0.5, 0.5]);
    }

    #[test]
    fn set_track_offset_updates_the_track_and_is_reflected_in_track_info() {
        let mut state = MixerState {
            tracks: vec![track(vec![1.0, 1.0])],
            position: 0,
            playing: false,
        };
        state.set_track_offset(0, 500).unwrap();
        assert_eq!(state.track_info()[0].start_offset_samples, 500);
    }

    #[test]
    fn set_track_offset_out_of_range_errors() {
        let mut state = MixerState {
            tracks: vec![track(vec![1.0])],
            position: 0,
            playing: false,
        };
        assert!(state.set_track_offset(5, 100).is_err());
    }

    #[test]
    fn playback_only_stops_once_every_track_finishes_including_its_offset() {
        let mut delayed = track(vec![1.0]);
        delayed.start_offset = 10;
        let mut state = MixerState {
            tracks: vec![delayed],
            position: 9,
            playing: true,
        };
        let mut out = [0.0; 1];
        state.render(&mut out);
        // Position is now 10 (== offset), the track's one sample hasn't
        // played yet — must still be playing, not wrongly stopped early.
        assert!(
            state.playing,
            "must not stop before a delayed track has actually played"
        );
    }

    #[test]
    fn render_full_mix_places_a_delayed_track_at_its_offset_not_at_zero() {
        let mut delayed = track(vec![0.4, 0.4]);
        delayed.start_offset = 2;
        let state = MixerState {
            tracks: vec![track(vec![0.1, 0.1]), delayed],
            position: 0,
            playing: false,
        };
        let mix = state.render_full_mix();
        assert_eq!(mix.len(), 4);
        assert!((mix[0] - 0.1).abs() < 1e-6);
        assert!((mix[1] - 0.1).abs() < 1e-6);
        assert!((mix[2] - 0.4).abs() < 1e-6);
        assert!((mix[3] - 0.4).abs() < 1e-6);
    }
}
