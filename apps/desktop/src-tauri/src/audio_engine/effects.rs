//! Sample-level audio effects: reverse and pitch shift.
//!
//! Pitch shift here is the classic "vari-speed" tape technique — pitch and
//! duration change together, the same trick behind a reversed, slowed-down
//! sample turning into a texture that wasn't in the original recording.
//! A formant-preserving/time-stretch-independent pitch shifter is a
//! plausible later upgrade, but vari-speed is the authentic effect for
//! this specific creative use case, not a limitation to work around.

use super::decode::resample_linear;

/// Reverses frame order (interleaved samples), preserving channel order
/// within each frame.
pub fn reverse(samples: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let mut frames: Vec<&[f32]> = samples.chunks(channels).collect();
    frames.reverse();
    frames.concat()
}

/// Shifts pitch by `semitones` (positive = up, negative = down) by
/// resampling — the buffer's duration changes with it, matching real
/// tape/turntable vari-speed behavior.
pub fn pitch_shift_by_resampling(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    semitones: f32,
) -> Vec<f32> {
    let rate = 2f32.powf(semitones / 12.0);
    if (rate - 1.0).abs() < 1e-6 {
        return samples.to_vec();
    }
    let virtual_rate = ((sample_rate as f32) * rate).round().max(1.0) as u32;
    resample_linear(samples, channels, virtual_rate, sample_rate)
}

/// A single feedback comb filter — the building block of a Schroeder
/// reverberator (Schroeder, 1962): a delay line with feedback that turns a
/// single impulse into a decaying series of echoes.
struct CombFilter {
    buffer: Vec<f32>,
    pos: usize,
    feedback: f32,
}

impl CombFilter {
    fn new(delay_samples: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples.max(1)],
            pos: 0,
            feedback,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let out = self.buffer[self.pos];
        self.buffer[self.pos] = input + out * self.feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        out
    }
}

/// An all-pass filter — passes all frequencies through unchanged in
/// magnitude but smears their phase, which is what keeps a Schroeder
/// reverb's echoes from sounding like discrete comb-filter "pings".
struct AllPassFilter {
    buffer: Vec<f32>,
    pos: usize,
    feedback: f32,
}

impl AllPassFilter {
    fn new(delay_samples: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples.max(1)],
            pos: 0,
            feedback,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let buffered = self.buffer[self.pos];
        let out = -input * self.feedback + buffered;
        self.buffer[self.pos] = input + buffered * self.feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        out
    }
}

/// Classic Schroeder reverb: four parallel comb filters summed and fed
/// through two series all-pass filters, per channel. `room_size` (0..1)
/// controls comb feedback and how long the tail rings out; `wet_mix`
/// (0..1) is how much of the reverberated signal is blended back in.
/// The output is longer than the input by the tail length, so the
/// reverb has room to decay naturally instead of being cut off.
pub fn reverb(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    wet_mix: f32,
    room_size: f32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let frame_count = samples.len() / channels;
    let room_size = room_size.clamp(0.0, 1.0);
    let wet_mix = wet_mix.clamp(0.0, 1.0);
    let tail_frames = ((sample_rate as f32) * (0.5 + room_size * 1.5)) as usize;
    let total_frames = frame_count + tail_frames;

    const COMB_DELAYS_MS: [f32; 4] = [29.7, 37.1, 41.1, 43.7];
    const ALLPASS_DELAYS_MS: [f32; 2] = [5.0, 1.7];
    let feedback = 0.28 + room_size * 0.68;

    let mut output = vec![0.0f32; total_frames * channels];

    for ch in 0..channels {
        let mut combs: Vec<CombFilter> = COMB_DELAYS_MS
            .iter()
            .map(|ms| {
                CombFilter::new(
                    (((ms / 1000.0) * sample_rate as f32) as usize).max(1),
                    feedback,
                )
            })
            .collect();
        let mut allpasses: Vec<AllPassFilter> = ALLPASS_DELAYS_MS
            .iter()
            .map(|ms| {
                AllPassFilter::new((((ms / 1000.0) * sample_rate as f32) as usize).max(1), 0.5)
            })
            .collect();

        for frame in 0..total_frames {
            let dry = if frame < frame_count {
                samples[frame * channels + ch]
            } else {
                0.0
            };
            let mut wet = 0.0;
            for comb in combs.iter_mut() {
                wet += comb.process(dry);
            }
            wet /= combs.len() as f32;
            for ap in allpasses.iter_mut() {
                wet = ap.process(wet);
            }
            output[frame * channels + ch] = dry * (1.0 - wet_mix) + wet * wet_mix;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reverse_mono_flips_sample_order() {
        let samples = vec![1.0, 2.0, 3.0, 4.0];
        assert_eq!(reverse(&samples, 1), vec![4.0, 3.0, 2.0, 1.0]);
    }

    #[test]
    fn reverse_stereo_flips_frames_not_channels() {
        // frames: (L0,R0)=(1,2) (L1,R1)=(3,4) (L2,R2)=(5,6)
        let samples = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        assert_eq!(reverse(&samples, 2), vec![5.0, 6.0, 3.0, 4.0, 1.0, 2.0]);
    }

    #[test]
    fn reverse_is_its_own_inverse() {
        let samples = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let twice = reverse(&reverse(&samples, 2), 2);
        assert_eq!(twice, samples);
    }

    #[test]
    fn pitch_up_an_octave_roughly_halves_length() {
        let samples: Vec<f32> = (0..1000).map(|i| (i as f32).sin()).collect();
        let shifted = pitch_shift_by_resampling(&samples, 1, 44100, 12.0);
        let expected = samples.len() / 2;
        assert!((shifted.len() as i64 - expected as i64).abs() < 5);
    }

    #[test]
    fn pitch_down_an_octave_roughly_doubles_length() {
        let samples: Vec<f32> = (0..1000).map(|i| (i as f32).sin()).collect();
        let shifted = pitch_shift_by_resampling(&samples, 1, 44100, -12.0);
        let expected = samples.len() * 2;
        assert!((shifted.len() as i64 - expected as i64).abs() < 5);
    }

    #[test]
    fn zero_semitones_is_a_no_op() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(pitch_shift_by_resampling(&samples, 1, 44100, 0.0), samples);
    }

    #[test]
    fn reverb_of_silence_is_silence() {
        let samples = vec![0.0; 4410];
        let wet = reverb(&samples, 1, 44100, 0.5, 0.5);
        assert!(wet.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn reverb_extends_signal_length_for_the_tail() {
        let samples = vec![1.0; 100];
        let wet = reverb(&samples, 1, 44100, 0.5, 0.5);
        assert!(wet.len() > samples.len());
    }

    #[test]
    fn zero_wet_mix_leaves_the_dry_portion_unchanged() {
        let samples = vec![0.2, -0.3, 0.5, -0.1];
        let wet = reverb(&samples, 1, 44100, 0.0, 0.5);
        assert_eq!(&wet[..samples.len()], &samples[..]);
    }

    #[test]
    fn reverb_respects_stereo_frame_boundaries() {
        let samples = vec![1.0, -1.0, 0.5, -0.5];
        let wet = reverb(&samples, 2, 44100, 0.3, 0.3);
        assert_eq!(wet.len() % 2, 0);
    }
}
