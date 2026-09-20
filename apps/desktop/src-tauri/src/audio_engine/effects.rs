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

/// A direct-form-I biquad filter — the standard building block for EQ
/// bands, described by the well-known "Audio EQ Cookbook" formulas
/// (Robert Bristow-Johnson): a general, textbook DSP technique used
/// throughout the audio industry, not any one product's proprietary code.
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    /// A peaking (bell-curve) EQ band: boosts or cuts a `gain_db` range
    /// around `freq_hz`, with `q` controlling how narrow that range is.
    fn peaking_eq(sample_rate: u32, freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz / sample_rate as f32;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q.max(0.01));

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x0: f32) -> f32 {
        let y0 = self.b0 * x0 + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x0;
        self.y2 = self.y1;
        self.y1 = y0;
        y0
    }
}

/// A single peaking-EQ band, applied independently per channel so a
/// stereo signal's left/right balance isn't disturbed. `gain_db` positive
/// boosts, negative cuts; `q` (>0) sets how narrow the affected band is
/// (a common musical range is roughly 0.5–5).
pub fn eq_band(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    freq_hz: f32,
    gain_db: f32,
    q: f32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    if gain_db == 0.0 {
        return samples.to_vec();
    }
    let mut filters: Vec<Biquad> = (0..channels)
        .map(|_| Biquad::peaking_eq(sample_rate, freq_hz.max(1.0), gain_db, q))
        .collect();
    samples
        .iter()
        .enumerate()
        .map(|(i, &s)| filters[i % channels].process(s))
        .collect()
}

/// A classic feedforward dynamic-range compressor: samples above
/// `threshold_db` get their level pulled down by `ratio` (e.g. 4.0 means
/// a 4:1 ratio), with `attack_ms`/`release_ms` controlling how fast the
/// gain reduction engages/relaxes, and `makeup_gain_db` restoring overall
/// loudness afterward. This is the standard per-sample envelope-follower
/// algorithm found in DSP/audio-effects textbooks, not derived from any
/// specific commercial plugin's code.
#[allow(clippy::too_many_arguments)]
pub fn compress(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    threshold_db: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    makeup_gain_db: f32,
) -> Vec<f32> {
    let ratio = ratio.max(1.0);
    let attack_coeff = 1.0 - (-1.0 / (0.001 * attack_ms.max(0.1) * sample_rate as f32)).exp();
    let release_coeff = 1.0 - (-1.0 / (0.001 * release_ms.max(0.1) * sample_rate as f32)).exp();
    let makeup_gain = 10f32.powf(makeup_gain_db / 20.0);

    let channels = channels.max(1) as usize;
    let mut envelope_db = vec![0.0f32; channels];
    let mut output = Vec::with_capacity(samples.len());

    for (i, &x) in samples.iter().enumerate() {
        let ch = i % channels;
        let x_db = 20.0 * (x.abs() + 1e-9).log10();
        let target_gain_reduction_db = if x_db > threshold_db {
            (threshold_db + (x_db - threshold_db) / ratio) - x_db
        } else {
            0.0
        };
        let coeff = if target_gain_reduction_db < envelope_db[ch] {
            attack_coeff
        } else {
            release_coeff
        };
        envelope_db[ch] += (target_gain_reduction_db - envelope_db[ch]) * coeff;
        let gain = 10f32.powf(envelope_db[ch] / 20.0) * makeup_gain;
        output.push(x * gain);
    }
    output
}

/// A feedback delay line ("echo"): each repeat is `delay_ms` after the
/// last, scaled by `feedback` (0..1, how much of each echo feeds the
/// next), blended with the dry signal by `wet_mix` (0..1). The output is
/// extended so the echoes have room to ring out past the input's end,
/// the same approach used by `reverb`.
pub fn delay(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    delay_ms: f32,
    feedback: f32,
    wet_mix: f32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let frame_count = samples.len() / channels;
    let feedback = feedback.clamp(0.0, 0.98);
    let wet_mix = wet_mix.clamp(0.0, 1.0);
    let delay_frames = ((delay_ms.max(1.0) / 1000.0) * sample_rate as f32)
        .round()
        .max(1.0) as usize;
    let tail_frames = delay_frames * 4;
    let total_frames = frame_count + tail_frames;

    let mut output = vec![0.0f32; total_frames * channels];
    for ch in 0..channels {
        let mut buffer = vec![0.0f32; delay_frames];
        let mut pos = 0usize;
        for frame in 0..total_frames {
            let dry = if frame < frame_count {
                samples[frame * channels + ch]
            } else {
                0.0
            };
            let delayed = buffer[pos];
            output[frame * channels + ch] = dry + delayed * wet_mix;
            buffer[pos] = dry + delayed * feedback;
            pos = (pos + 1) % buffer.len();
        }
    }
    output
}

/// Ring modulation: multiplies the signal by a sine carrier wave — the
/// classic analog technique (used in everything from vocoders to Doctor
/// Who's Daleks) behind the "robotic"/metallic voice effect. A pure sine
/// carrier at a fixed frequency is generic public DSP, not derived from
/// any specific product's implementation.
pub fn ring_modulate(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    carrier_hz: f32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let angular_step = 2.0 * std::f32::consts::PI * carrier_hz.max(0.0) / sample_rate as f32;
    samples
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let frame = (i / channels) as f32;
            s * (angular_step * frame).sin()
        })
        .collect()
}

/// A single-pole IIR lowpass filter — the simplest possible way to roll
/// off high frequencies, giving the "muffled"/lo-fi, filtered-through-a-
/// wall vocal effect. `cutoff_hz` sets where the rolloff begins; lower
/// values sound more muffled. Standard textbook DSP (a one-pole/RC
/// lowpass), not derived from any specific product's code.
pub fn lowpass_muffle(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
    cutoff_hz: f32,
) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    let dt = 1.0 / sample_rate as f32;
    let rc = 1.0 / (2.0 * std::f32::consts::PI * cutoff_hz.max(1.0));
    let alpha = dt / (rc + dt);

    let mut state = vec![0.0f32; channels];
    samples
        .iter()
        .enumerate()
        .map(|(i, &x)| {
            let ch = i % channels;
            state[ch] += alpha * (x - state[ch]);
            state[ch]
        })
        .collect()
}

/// The full clip-tools effect chain in one place, so callers (a Tauri
/// command, a test) configure what they want and don't have to know the
/// application order or thread five-plus optional parameters through
/// every layer. Every field defaults to a no-op value via `Default`, so
/// `EffectChain::default()` really does nothing.
#[derive(Debug, Clone, Default)]
pub struct EffectChain {
    pub reverse: bool,
    pub semitones: f32,
    pub eq_freq_hz: f32,
    pub eq_gain_db: f32,
    pub eq_q: f32,
    pub compress_threshold_db: f32,
    pub compress_ratio: f32,
    pub compress_attack_ms: f32,
    pub compress_release_ms: f32,
    pub compress_makeup_db: f32,
    /// Compression only engages when this is set — a ratio of 0 (the
    /// `Default` value) would otherwise divide by a meaningless number.
    pub compress_enabled: bool,
    pub delay_ms: f32,
    pub delay_feedback: f32,
    pub delay_wet: f32,
    pub reverb_wet: f32,
    pub reverb_room: f32,
    /// Ring-modulation carrier frequency for the "robotic" voice effect;
    /// 0 (the `Default`) disables it, since a 0 Hz carrier is meaningless.
    pub robotic_hz: f32,
    /// Lowpass cutoff for the "muffled" voice effect; 0 (the `Default`)
    /// disables it, since a 0 Hz cutoff would silence everything.
    pub muffle_cutoff_hz: f32,
}

impl EffectChain {
    /// Applies every configured effect in a conventional mixing-chain
    /// order: structural edits (reverse, pitch) first, then tone (EQ),
    /// then dynamics (compression), then time-based effects last (delay,
    /// reverb) — each stage is skipped entirely when it's a no-op, so an
    /// all-default chain costs nothing beyond the initial decode.
    pub fn apply(&self, samples: &[f32], channels: u16, sample_rate: u32) -> Vec<f32> {
        let mut out = samples.to_vec();
        if self.reverse {
            out = reverse(&out, channels);
        }
        if self.semitones != 0.0 {
            out = pitch_shift_by_resampling(&out, channels, sample_rate, self.semitones);
        }
        if self.eq_gain_db != 0.0 {
            out = eq_band(
                &out,
                channels,
                sample_rate,
                self.eq_freq_hz,
                self.eq_gain_db,
                self.eq_q,
            );
        }
        if self.robotic_hz > 0.0 {
            out = ring_modulate(&out, channels, sample_rate, self.robotic_hz);
        }
        if self.muffle_cutoff_hz > 0.0 {
            out = lowpass_muffle(&out, channels, sample_rate, self.muffle_cutoff_hz);
        }
        if self.compress_enabled {
            out = compress(
                &out,
                channels,
                sample_rate,
                self.compress_threshold_db,
                self.compress_ratio,
                self.compress_attack_ms,
                self.compress_release_ms,
                self.compress_makeup_db,
            );
        }
        if self.delay_wet > 0.0 {
            out = delay(
                &out,
                channels,
                sample_rate,
                self.delay_ms,
                self.delay_feedback,
                self.delay_wet,
            );
        }
        if self.reverb_wet > 0.0 {
            out = reverb(
                &out,
                channels,
                sample_rate,
                self.reverb_wet,
                self.reverb_room,
            );
        }
        out
    }
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

    fn sine_wave(freq: f32, seconds: f32, sample_rate: u32) -> Vec<f32> {
        let n = (sample_rate as f32 * seconds) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn eq_zero_gain_is_a_no_op() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(eq_band(&samples, 1, 44100, 1000.0, 0.0, 1.0), samples);
    }

    #[test]
    fn eq_boost_at_a_tones_frequency_increases_its_energy() {
        let tone = sine_wave(1000.0, 1.0, 44100);
        let boosted = eq_band(&tone, 1, 44100, 1000.0, 12.0, 1.0);
        // Skip the filter's brief settling transient at the very start.
        assert!(rms(&boosted[2000..]) > rms(&tone[2000..]));
    }

    #[test]
    fn eq_cut_at_a_tones_frequency_decreases_its_energy() {
        let tone = sine_wave(1000.0, 1.0, 44100);
        let cut = eq_band(&tone, 1, 44100, 1000.0, -12.0, 1.0);
        assert!(rms(&cut[2000..]) < rms(&tone[2000..]));
    }

    #[test]
    fn compress_reduces_peaks_above_threshold() {
        let loud = vec![0.9f32; 4410];
        let compressed = compress(&loud, 1, 44100, -12.0, 4.0, 5.0, 50.0, 0.0);
        // After the short attack settles, a steady loud signal should be
        // pulled down well below its original level.
        assert!(rms(&compressed[2000..]) < rms(&loud[2000..]));
    }

    #[test]
    fn compress_leaves_signal_below_threshold_untouched() {
        let quiet = vec![0.01f32; 4410];
        let compressed = compress(&quiet, 1, 44100, -6.0, 4.0, 5.0, 50.0, 0.0);
        for (a, b) in quiet.iter().zip(compressed.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn compress_makeup_gain_boosts_output() {
        let quiet = vec![0.01f32; 100];
        let boosted = compress(&quiet, 1, 44100, -6.0, 1.0, 5.0, 50.0, 6.0);
        // Ratio 1:1 + no threshold crossing means only makeup gain applies.
        assert!(boosted[50] > quiet[50]);
    }

    #[test]
    fn delay_extends_length_for_the_echo_tail() {
        let samples = vec![1.0; 100];
        let echoed = delay(&samples, 1, 44100, 200.0, 0.5, 0.5);
        assert!(echoed.len() > samples.len());
    }

    #[test]
    fn delay_produces_an_echo_after_the_delay_time() {
        let sample_rate = 44100;
        let mut impulse = vec![0.0f32; 1000];
        impulse[0] = 1.0;
        let delay_ms = 10.0;
        let echoed = delay(&impulse, 1, sample_rate, delay_ms, 0.8, 1.0);
        let delay_frames = ((delay_ms / 1000.0) * sample_rate as f32).round() as usize;
        assert!(
            echoed[delay_frames].abs() > 0.1,
            "expected an echo at frame {delay_frames}"
        );
    }

    #[test]
    fn zero_wet_delay_is_dry_only() {
        let samples = vec![0.2, -0.3, 0.5];
        let echoed = delay(&samples, 1, 44100, 50.0, 0.5, 0.0);
        assert_eq!(&echoed[..samples.len()], &samples[..]);
    }

    #[test]
    fn ring_modulate_silences_a_zero_crossing_at_time_zero() {
        // At frame 0, sin(0) = 0, so the very first sample is always zeroed
        // by the carrier regardless of input.
        let samples = vec![1.0, 1.0, 1.0, 1.0];
        let modulated = ring_modulate(&samples, 1, 44100, 1000.0);
        assert!(modulated[0].abs() < 1e-6);
    }

    #[test]
    fn ring_modulate_zero_hz_carrier_silences_everything() {
        let samples = vec![0.5, -0.5, 0.3, -0.3];
        let modulated = ring_modulate(&samples, 1, 44100, 0.0);
        assert!(modulated.iter().all(|&s| s.abs() < 1e-6));
    }

    #[test]
    fn muffle_attenuates_high_frequency_content_more_than_low() {
        let low_tone = sine_wave(200.0, 0.5, 44100);
        let high_tone = sine_wave(8000.0, 0.5, 44100);
        let cutoff = 500.0;
        let muffled_low = lowpass_muffle(&low_tone, 1, 44100, cutoff);
        let muffled_high = lowpass_muffle(&high_tone, 1, 44100, cutoff);
        // Ratio of output energy to input energy should drop far more for
        // the frequency above the cutoff than the one below it.
        let low_ratio = rms(&muffled_low[2000..]) / rms(&low_tone[2000..]);
        let high_ratio = rms(&muffled_high[2000..]) / rms(&high_tone[2000..]);
        assert!(high_ratio < low_ratio);
    }

    #[test]
    fn effect_chain_robotic_and_muffle_are_off_by_default() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(EffectChain::default().apply(&samples, 1, 44100), samples);
    }

    #[test]
    fn effect_chain_applies_robotic_effect_when_set() {
        let samples = vec![1.0, 1.0, 1.0, 1.0];
        let chain = EffectChain {
            robotic_hz: 1000.0,
            ..Default::default()
        };
        let out = chain.apply(&samples, 1, 44100);
        assert_eq!(out, ring_modulate(&samples, 1, 44100, 1000.0));
    }

    #[test]
    fn effect_chain_applies_muffle_effect_when_set() {
        let samples = vec![0.5, -0.5, 0.3, -0.3];
        let chain = EffectChain {
            muffle_cutoff_hz: 500.0,
            ..Default::default()
        };
        let out = chain.apply(&samples, 1, 44100);
        assert_eq!(out, lowpass_muffle(&samples, 1, 44100, 500.0));
    }

    #[test]
    fn default_effect_chain_is_a_true_no_op() {
        let samples = vec![0.1, -0.2, 0.3, -0.4];
        let out = EffectChain::default().apply(&samples, 1, 44100);
        assert_eq!(out, samples);
    }

    #[test]
    fn effect_chain_applies_reverse_and_pitch_together() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        let chain = EffectChain {
            reverse: true,
            ..Default::default()
        };
        let out = chain.apply(&samples, 1, 44100);
        assert_eq!(out, reverse(&samples, 1));
    }

    #[test]
    fn effect_chain_compression_only_engages_when_enabled() {
        let loud = vec![0.9f32; 1000];
        let chain = EffectChain {
            compress_threshold_db: -12.0,
            compress_ratio: 4.0,
            compress_attack_ms: 5.0,
            compress_release_ms: 50.0,
            compress_enabled: false,
            ..Default::default()
        };
        assert_eq!(chain.apply(&loud, 1, 44100), loud);
    }
}
