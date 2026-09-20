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
}
