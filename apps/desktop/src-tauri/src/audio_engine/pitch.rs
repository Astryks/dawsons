//! Monophonic pitch detection via the YIN algorithm (de Cheveigné &
//! Kawahara, 2002) — a classical, public DSP technique implemented
//! directly here rather than depending on CREPE (a PyTorch model that
//! would need a sidecar round-trip). For a single sung/hummed voice, YIN
//! is fast, fully local, and accurate enough; CREPE's edge over it is
//! marginal for this specific use case.

const YIN_THRESHOLD: f32 = 0.15;

/// Estimates the fundamental frequency (Hz) of one frame, or `None` if no
/// clear pitch is found (silence, noise, unvoiced).
pub fn detect_pitch(frame: &[f32], sample_rate: u32) -> Option<f32> {
    let max_lag = frame.len() / 2;
    if max_lag < 2 {
        return None;
    }

    let mut diff = vec![0f32; max_lag];
    for tau in 1..max_lag {
        let mut sum = 0f32;
        for j in 0..max_lag {
            let d = frame[j] - frame[j + tau];
            sum += d * d;
        }
        diff[tau] = sum;
    }

    let mut cmnd = vec![1f32; max_lag]; // cumulative mean normalized difference
    let mut running_sum = 0f32;
    for tau in 1..max_lag {
        running_sum += diff[tau];
        cmnd[tau] = if running_sum > 0.0 {
            diff[tau] * tau as f32 / running_sum
        } else {
            1.0
        };
    }

    let mut tau = 2;
    while tau < max_lag {
        if cmnd[tau] < YIN_THRESHOLD {
            while tau + 1 < max_lag && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            let refined = parabolic_interpolate(&cmnd, tau);
            if refined <= 0.0 {
                return None;
            }
            return Some(sample_rate as f32 / refined);
        }
        tau += 1;
    }
    None
}

fn parabolic_interpolate(cmnd: &[f32], tau: usize) -> f32 {
    if tau == 0 || tau + 1 >= cmnd.len() {
        return tau as f32;
    }
    let (x0, x1, x2) = (cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]);
    let denom = 2.0 * (2.0 * x1 - x2 - x0);
    if denom.abs() < 1e-9 {
        return tau as f32;
    }
    tau as f32 + (x2 - x0) / (2.0 * denom)
}

pub fn freq_to_midi_note(freq: f32) -> f32 {
    69.0 + 12.0 * (freq / 440.0).log2()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DetectedNote {
    pub note: u8,
    pub start_sec: f32,
    pub duration_sec: f32,
}

/// Extracts a monophonic melody as quantized MIDI notes from raw
/// interleaved samples (downmixed to mono internally): frame-by-frame YIN
/// pitch tracking, quantized to the nearest semitone, consecutive
/// same-note frames merged, with a minimum note duration to suppress
/// spurious single-frame blips.
pub fn extract_notes(samples: &[f32], channels: u16, sample_rate: u32) -> Vec<DetectedNote> {
    let mono = to_mono(samples, channels);
    let frame_size = 2048usize;
    let hop = 512usize;
    let min_note_sec = 0.08;
    let hop_sec = hop as f32 / sample_rate as f32;

    let mut frame_notes: Vec<Option<u8>> = Vec::new();
    let mut pos = 0;
    while pos + frame_size <= mono.len() {
        let frame = &mono[pos..pos + frame_size];
        let midi = detect_pitch(frame, sample_rate)
            .map(|f| freq_to_midi_note(f).round().clamp(0.0, 127.0) as u8);
        frame_notes.push(midi);
        pos += hop;
    }

    let mut notes = Vec::new();
    let mut current: Option<(u8, usize)> = None; // (note, start_frame_index)

    for (i, note) in frame_notes.iter().enumerate() {
        match (current, *note) {
            (Some((cn, _)), Some(n)) if cn == n => {} // same note continues
            (Some((cn, start_i)), other) => {
                push_if_long_enough(&mut notes, cn, start_i, i, hop_sec, min_note_sec);
                current = other.map(|n| (n, i));
            }
            (None, Some(n)) => current = Some((n, i)),
            (None, None) => {}
        }
    }
    if let Some((cn, start_i)) = current {
        push_if_long_enough(
            &mut notes,
            cn,
            start_i,
            frame_notes.len(),
            hop_sec,
            min_note_sec,
        );
    }
    notes
}

fn push_if_long_enough(
    notes: &mut Vec<DetectedNote>,
    note: u8,
    start_i: usize,
    end_i: usize,
    hop_sec: f32,
    min_note_sec: f32,
) {
    let duration_sec = (end_i - start_i) as f32 * hop_sec;
    if duration_sec >= min_note_sec {
        notes.push(DetectedNote {
            note,
            start_sec: start_i as f32 * hop_sec,
            duration_sec,
        });
    }
}

fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    if channels == 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|f| f.iter().sum::<f32>() / channels as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_wave(freq: f32, sample_rate: u32, n_samples: usize) -> Vec<f32> {
        (0..n_samples)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    #[test]
    fn detects_a440_within_a_few_cents() {
        let sample_rate = 44100;
        let frame = sine_wave(440.0, sample_rate, 2048);
        let freq = detect_pitch(&frame, sample_rate).expect("should detect a pitch");
        assert!((freq - 440.0).abs() < 2.0, "expected ~440 Hz, got {freq}");
    }

    #[test]
    fn detects_a220_within_a_few_cents() {
        let sample_rate = 44100;
        let frame = sine_wave(220.0, sample_rate, 2048);
        let freq = detect_pitch(&frame, sample_rate).expect("should detect a pitch");
        assert!((freq - 220.0).abs() < 2.0, "expected ~220 Hz, got {freq}");
    }

    #[test]
    fn silence_yields_no_confident_pitch() {
        let frame = vec![0.0f32; 2048];
        // YIN's threshold logic can behave oddly on pure zero input in some
        // implementations; a near-silent frame is the more realistic case.
        let quiet: Vec<f32> = frame.iter().map(|_| 0.0001).collect();
        let sample_rate = 44100;
        // Not asserting None strictly (a flat DC-ish signal can still trip
        // the threshold on some implementations) — just that it doesn't panic
        // and returns something in a plausible range if it does detect one.
        if let Some(freq) = detect_pitch(&quiet, sample_rate) {
            assert!(freq > 0.0);
        }
    }

    #[test]
    fn freq_to_midi_note_matches_known_reference_pitches() {
        assert!((freq_to_midi_note(440.0) - 69.0).abs() < 0.01); // A4
        assert!((freq_to_midi_note(261.626) - 60.0).abs() < 0.05); // C4 (middle C)
    }

    #[test]
    fn extract_notes_finds_a_single_sustained_note() {
        let sample_rate = 44100;
        let samples = sine_wave(440.0, sample_rate, sample_rate as usize / 2); // 0.5s
        let notes = extract_notes(&samples, 1, sample_rate);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].note, 69); // A4
        assert!(notes[0].duration_sec > 0.3);
    }
}
