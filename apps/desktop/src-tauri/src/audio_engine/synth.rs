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

const MELODY_CHANNEL: i32 = 0;
/// GM percussion lives on MIDI channel 10 (channel index 9), where note
/// numbers select a fixed drum sound (kick, snare, hi-hat, ...) rather
/// than a pitch, and program-change messages are ignored.
const PERCUSSION_CHANNEL: i32 = 9;

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

fn load_synthesizer(
    config: &EngineConfig,
    channel: i32,
    program: u8,
) -> Result<Synthesizer, String> {
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
    if channel != PERCUSSION_CHANNEL {
        synthesizer.process_midi_message(channel, 0xC0, program as i32, 0); // program change
    }
    Ok(synthesizer)
}

/// Renders one event — a single note, a chord (several simultaneous
/// pitches), or silence (`pitches` empty) — for `duration_sec`.
fn render_one_event(
    synthesizer: &mut Synthesizer,
    channel: i32,
    config: &EngineConfig,
    pitches: &[i32],
    velocity: i32,
    duration_sec: f32,
) -> (Vec<f32>, Vec<f32>) {
    let total_frames = ((duration_sec * config.sample_rate as f32) as usize).max(1);
    let note_off_frame = total_frames * 4 / 5; // release before the buffer ends so the tail rings out naturally

    let mut left = vec![0f32; total_frames];
    let mut right = vec![0f32; total_frames];
    for &pitch in pitches {
        synthesizer.note_on(channel, pitch, velocity);
    }

    let chunk = 256usize;
    let mut rendered = 0usize;
    while rendered < total_frames {
        let this_chunk = chunk.min(total_frames - rendered);
        if rendered <= note_off_frame && rendered + this_chunk > note_off_frame {
            for &pitch in pitches {
                synthesizer.note_off(channel, pitch);
            }
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

fn render_sequence(
    config: &EngineConfig,
    channel: i32,
    program: u8,
    notes: &[DetectedNote],
) -> Result<Vec<f32>, String> {
    if notes.is_empty() {
        return Ok(Vec::new());
    }
    let mut synthesizer = load_synthesizer(config, channel, program)?;
    let mut left_full = Vec::new();
    let mut right_full = Vec::new();
    for note in notes {
        let (left, right) = render_one_event(
            &mut synthesizer,
            channel,
            config,
            &[note.note as i32],
            100,
            note.duration_sec,
        );
        left_full.extend_from_slice(&left);
        right_full.extend_from_slice(&right);
    }
    Ok(interleave(&left_full, &right_full, config.channels))
}

/// An event for hand-authored compositions (see `demo_songs.rs`): a single
/// note, a chord (several simultaneous pitches), or a rest (empty
/// `pitches`). Unlike `DetectedNote`, which always represents an actually-
/// sung pitch, authored parts need rests and chords to sound musical and
/// stay rhythmically aligned across simultaneously-rendered layers.
#[derive(Debug, Clone)]
pub struct ScoreNote {
    pub pitches: Vec<u8>,
    pub duration_sec: f32,
}

impl ScoreNote {
    pub fn note(pitch: u8, duration_sec: f32) -> Self {
        Self {
            pitches: vec![pitch],
            duration_sec,
        }
    }

    pub fn chord(pitches: Vec<u8>, duration_sec: f32) -> Self {
        Self {
            pitches,
            duration_sec,
        }
    }

    /// Not used by the current demo songs (their layers all stay fully
    /// covered by notes/chords), but real public API for authoring future
    /// compositions with rhythmic gaps.
    #[allow(dead_code)]
    pub fn rest(duration_sec: f32) -> Self {
        Self {
            pitches: Vec::new(),
            duration_sec,
        }
    }
}

fn render_score(
    config: &EngineConfig,
    channel: i32,
    program: u8,
    notes: &[ScoreNote],
) -> Result<Vec<f32>, String> {
    if notes.is_empty() {
        return Ok(Vec::new());
    }
    let mut synthesizer = load_synthesizer(config, channel, program)?;
    let mut left_full = Vec::new();
    let mut right_full = Vec::new();
    for note in notes {
        let pitches: Vec<i32> = note.pitches.iter().map(|&p| p as i32).collect();
        let (left, right) = render_one_event(
            &mut synthesizer,
            channel,
            config,
            &pitches,
            100,
            note.duration_sec,
        );
        left_full.extend_from_slice(&left);
        right_full.extend_from_slice(&right);
    }
    Ok(interleave(&left_full, &right_full, config.channels))
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
    let mut synthesizer = load_synthesizer(config, MELODY_CHANNEL, program)?;
    let (left, right) = render_one_event(
        &mut synthesizer,
        MELODY_CHANNEL,
        config,
        &[note],
        velocity,
        duration_sec,
    );
    Ok(interleave(&left, &right, config.channels))
}

/// Renders a full chord (several simultaneous pitches) through the chosen
/// GM instrument — the "press C, hear a C major chord" easy-start
/// feature, generalized across all 128 instruments the way a guitar's
/// open C shape always plays a C major chord. The frontend works out
/// which pitches make up the chord; this just plays them together.
pub fn render_chord(
    config: &EngineConfig,
    program: u8,
    pitches: &[i32],
    velocity: i32,
    duration_sec: f32,
) -> Result<Vec<f32>, String> {
    let mut synthesizer = load_synthesizer(config, MELODY_CHANNEL, program)?;
    let (left, right) = render_one_event(
        &mut synthesizer,
        MELODY_CHANNEL,
        config,
        pitches,
        velocity,
        duration_sec,
    );
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
    render_sequence(config, MELODY_CHANNEL, program, notes)
}

/// Renders a hand-authored melodic part (bass, guitar, piano, "vocal"
/// lead, ...) — single notes or chords, with rests — on the standard
/// melody channel through the given GM program. Used for demo song
/// generation, where each layer needs its own instrument.
pub fn render_part(
    config: &EngineConfig,
    program: u8,
    notes: &[ScoreNote],
) -> Result<Vec<f32>, String> {
    render_score(config, MELODY_CHANNEL, program, notes)
}

/// Renders a drum pattern (pitches are GM percussion key numbers — e.g.
/// 36=kick, 38=snare, 42=closed hi-hat — not musical pitches) on the GM
/// percussion channel.
pub fn render_drums(config: &EngineConfig, notes: &[ScoreNote]) -> Result<Vec<f32>, String> {
    render_score(config, PERCUSSION_CHANNEL, 0, notes)
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

    #[test]
    fn renders_nonsilent_chord_when_soundfont_present() {
        if !is_soundfont_available() {
            eprintln!("skipping: soundfont not downloaded in this environment");
            return;
        }
        let config = EngineConfig {
            sample_rate: 44100,
            channels: 2,
        };
        // C major triad: C4, E4, G4.
        let samples =
            render_chord(&config, 0, &[60, 64, 67], 100, 1.0).expect("render should succeed");
        let peak = samples.iter().fold(0f32, |a, &b| a.max(b.abs()));
        assert!(peak > 0.01, "expected audible output, got peak={peak}");
    }

    #[test]
    fn score_note_constructors_shape_pitches_correctly() {
        assert_eq!(ScoreNote::note(60, 1.0).pitches, vec![60]);
        assert_eq!(
            ScoreNote::chord(vec![60, 64, 67], 1.0).pitches,
            vec![60, 64, 67]
        );
        assert!(ScoreNote::rest(1.0).pitches.is_empty());
    }
}
