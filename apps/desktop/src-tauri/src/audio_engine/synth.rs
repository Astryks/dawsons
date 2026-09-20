//! General MIDI instrument playback via `rustysynth` (MIT license) and a
//! bundled-by-reference SoundFont (FluidR3_GM.sf2, MIT license, Frank
//! Wen — see THIRD_PARTY_NOTICES.md). One SoundFont gives the full 128
//! GM program set (pianos, guitars, basses, strings, brass, synths, ...)
//! plus GM percussion — the practical way to offer "as many instruments
//! as possible" without licensing or curating each one individually.
//!
//! The SoundFont file itself is never committed to git (148MB) — see
//! `soundfont_path()` and `scripts/download_soundfont.sh`.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;

use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};

use super::device::EngineConfig;
use super::pitch::DetectedNote;

const CHANNEL: i32 = 0;

pub fn soundfont_path() -> PathBuf {
    dirs_cache_dir()
        .join("dawsons")
        .join("soundfonts")
        .join("FluidR3_GM.sf2")
}

fn dirs_cache_dir() -> PathBuf {
    // Mirrors platform-appropriate cache locations without adding a new
    // dependency just for this: macOS/Linux both honor $HOME/.cache by
    // convention for this kind of asset; Windows falls back to a local
    // app-data-adjacent temp dir since there's no cpal-style env var here.
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".cache");
    }
    std::env::temp_dir()
}

pub fn is_soundfont_available() -> bool {
    soundfont_path().exists()
}

fn load_synthesizer(config: &EngineConfig, program: u8) -> Result<Synthesizer, String> {
    let path = soundfont_path();
    let file = File::open(&path).map_err(|_| {
        format!("SoundFont not found at {path:?} — run scripts/download_soundfont.sh first")
    })?;
    let mut reader = BufReader::new(file);
    let sound_font = Arc::new(
        SoundFont::new(&mut reader).map_err(|e| format!("failed to parse SoundFont: {e}"))?,
    );
    let settings = SynthesizerSettings::new(config.sample_rate as i32);
    let mut synthesizer = Synthesizer::new(&sound_font, &settings)
        .map_err(|e| format!("failed to create synthesizer: {e}"))?;
    synthesizer.process_midi_message(CHANNEL, 0xC0, program as i32, 0); // program change
    Ok(synthesizer)
}

fn render_one_note(
    synthesizer: &mut Synthesizer,
    config: &EngineConfig,
    note: i32,
    velocity: i32,
    duration_sec: f32,
) -> (Vec<f32>, Vec<f32>) {
    let total_frames = ((duration_sec * config.sample_rate as f32) as usize).max(1);
    let note_off_frame = total_frames * 4 / 5; // release before the buffer ends so the tail rings out naturally

    let mut left = vec![0f32; total_frames];
    let mut right = vec![0f32; total_frames];
    synthesizer.note_on(CHANNEL, note, velocity);

    let chunk = 256usize;
    let mut rendered = 0usize;
    while rendered < total_frames {
        let this_chunk = chunk.min(total_frames - rendered);
        if rendered <= note_off_frame && rendered + this_chunk > note_off_frame {
            synthesizer.note_off(CHANNEL, note);
        }
        synthesizer.render(
            &mut left[rendered..rendered + this_chunk],
            &mut right[rendered..rendered + this_chunk],
        );
        rendered += this_chunk;
    }
    (left, right)
}

fn interleave(left: &[f32], right: &[f32], channels: u16) -> Vec<f32> {
    let mut interleaved = Vec::with_capacity(left.len() * channels as usize);
    for i in 0..left.len() {
        for _ in 0..channels {
            interleaved.push((left[i] + right[i]) / 2.0);
        }
    }
    interleaved
}

/// Renders a single MIDI note (program change + note on/off) to interleaved
/// f32 PCM at the engine's sample rate/channel count — the instrument
/// library's "preview a note" demo.
pub fn render_note(
    config: &EngineConfig,
    program: u8,
    note: i32,
    velocity: i32,
    duration_sec: f32,
) -> Result<Vec<f32>, String> {
    let mut synthesizer = load_synthesizer(config, program)?;
    let (left, right) = render_one_note(&mut synthesizer, config, note, velocity, duration_sec);
    Ok(interleave(&left, &right, config.channels))
}

/// Renders a detected melody (see pitch::extract_notes) as a sequence of
/// notes through the chosen GM instrument — the actual voice-to-instrument
/// feature. Notes are rendered back-to-back (relative note lengths are
/// preserved; the exact silence gaps between notes in the original
/// recording are not — a reasonable v1 simplification, not a fidelity
/// requirement here).
pub fn render_melody(
    config: &EngineConfig,
    program: u8,
    notes: &[DetectedNote],
) -> Result<Vec<f32>, String> {
    if notes.is_empty() {
        return Err(
            "no notes detected in this recording — try humming or singing more clearly".to_string(),
        );
    }
    let mut synthesizer = load_synthesizer(config, program)?;
    let mut left_full = Vec::new();
    let mut right_full = Vec::new();
    for note in notes {
        let (left, right) = render_one_note(
            &mut synthesizer,
            config,
            note.note as i32,
            100,
            note.duration_sec,
        );
        left_full.extend_from_slice(&left);
        right_full.extend_from_slice(&right);
    }
    Ok(interleave(&left_full, &right_full, config.channels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soundfont_path_is_stable() {
        // Not asserting existence (CI doesn't have the 148MB file) — just
        // that the path construction itself doesn't panic and lands under
        // a "soundfonts" dir, which the download script and this module
        // both need to agree on.
        let path = soundfont_path();
        assert!(path.to_string_lossy().contains("soundfonts"));
    }

    /// Skips itself (rather than failing) when the SoundFont isn't present
    /// — true in CI, which doesn't fetch the 148MB asset — but gives real
    /// non-silent-audio confidence locally, where it matters most since
    /// that's where the file actually lives.
    #[test]
    fn renders_nonsilent_audio_when_soundfont_present() {
        if !is_soundfont_available() {
            eprintln!("skipping: soundfont not downloaded in this environment");
            return;
        }
        let config = EngineConfig {
            sample_rate: 44100,
            channels: 2,
        };
        let samples = render_note(&config, 0, 60, 100, 1.0).expect("render should succeed");
        let peak = samples.iter().fold(0f32, |a, &b| a.max(b.abs()));
        assert!(peak > 0.01, "expected audible output, got peak={peak}");
    }
}
