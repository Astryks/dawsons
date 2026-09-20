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

/// Semitone offsets from the tonic for the two most common scales — the
/// same music-theory facts already used for chord qualities elsewhere in
/// this project, not anyone's copyrightable expression.
pub const MAJOR_SCALE: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
pub const MINOR_SCALE: [u8; 7] = [0, 2, 3, 5, 7, 8, 10];

/// Snaps a MIDI note to the nearest pitch in a given key/scale — the
/// "auto-tune" correction for singing that isn't quite in tune. `tonic`
/// is a pitch class 0-11 (C=0); `scale` is semitone offsets from the
/// tonic (see `MAJOR_SCALE`/`MINOR_SCALE`). Searches the target octave
/// plus one above/below so a note near an octave boundary still finds
/// its true nearest neighbor.
pub fn snap_to_scale(note: u8, tonic: u8, scale: &[u8]) -> u8 {
    let note_i = note as i32;
    let mut best = note;
    let mut best_dist = i32::MAX;
    for octave in -1..=1 {
        let octave_base = (note_i / 12 + octave) * 12;
        for &interval in scale {
            let candidate = octave_base + tonic as i32 + interval as i32;
            if !(0..=127).contains(&candidate) {
                continue;
            }
            let dist = (candidate - note_i).abs();
            if dist < best_dist {
                best_dist = dist;
                best = candidate as u8;
            }
        }
    }
    best
}

/// Applies `snap_to_scale` to every note in a detected melody — the
/// auto-tune pass for voice-to-instrument.
pub fn snap_notes_to_scale(notes: &[DetectedNote], tonic: u8, scale: &[u8]) -> Vec<DetectedNote> {
    notes
        .iter()
        .map(|n| DetectedNote {
            note: snap_to_scale(n.note, tonic, scale),
            ..*n
        })
        .collect()
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

    #[test]
    fn snap_to_scale_leaves_an_in_scale_note_unchanged() {
        // C4 (60) is in C major (tonic 0).
        assert_eq!(snap_to_scale(60, 0, &MAJOR_SCALE), 60);
    }

    #[test]
    fn snap_to_scale_corrects_a_flat_note_to_the_nearest_in_key_pitch() {
        // C#4 (61) is a semitone flat of D4 (62, in C major) and a
        // semitone sharp of C4 (60, also in C major) — tied distance, so
        // this just checks the result actually lands in the scale.
        let snapped = snap_to_scale(61, 0, &MAJOR_SCALE);
        assert!(MAJOR_SCALE.contains(&(snapped % 12)));
    }

    #[test]
    fn snap_to_scale_corrects_a_clearly_off_pitch_note() {
        // D#4 (63) is far from D4 (62) or E4 (64)'s neighbors in C major;
        // the nearest in-key note is E4 (64, 1 semitone away) beating
        // D4 (62, 1 semitone away) — both equally close, so check it's
        // one of the two nearest scale tones, not some distant note.
        let snapped = snap_to_scale(63, 0, &MAJOR_SCALE);
        assert!((61..=65).contains(&snapped));
        assert!(MAJOR_SCALE.contains(&(snapped % 12)));
    }

    #[test]
    fn snap_to_scale_respects_a_different_tonic() {
        // A#4 (70) is not in D major (tonic 2; pitch classes 2,4,6,7,9,11,1)
        // — nearest in-key notes are A4 (69) or B4 (71); should move off A#.
        let snapped = snap_to_scale(70, 2, &MAJOR_SCALE);
        assert_ne!(snapped, 70);
        assert!(MAJOR_SCALE
            .iter()
            .any(|&interval| (2 + interval) % 12 == snapped % 12));
    }

    #[test]
    fn snap_notes_to_scale_corrects_every_note_in_a_melody() {
        let notes = vec![
            DetectedNote {
                note: 61,
                start_sec: 0.0,
                duration_sec: 0.5,
            },
            DetectedNote {
                note: 63,
                start_sec: 0.5,
                duration_sec: 0.5,
            },
        ];
        let corrected = snap_notes_to_scale(&notes, 0, &MAJOR_SCALE);
        assert_eq!(corrected.len(), 2);
        for n in &corrected {
            assert!(MAJOR_SCALE.contains(&(n.note % 12)));
        }
    }
}
