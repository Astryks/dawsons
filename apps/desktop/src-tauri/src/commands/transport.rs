use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio_engine::{effects, synth, transport};
use crate::state::AppState;

fn require_audio(
    state: &Option<crate::state::AudioEngineHandle>,
) -> Result<&crate::state::AudioEngineHandle, String> {
    state
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())
}

/// M2 debug command: loads and plays the bundled synthetic test tone,
/// proving the full decode -> mix -> cpal output path end to end. Real
/// file loading (via `load_track`, with a user-chosen path) lands with M4.
#[tauri::command]
pub fn debug_play_test_tone(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let asset_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-assets/test-tone.wav");
    transport::load_test_track(&handle.mixer, &handle.engine_config, &asset_path)?;
    transport::play(&handle.mixer)
}

/// "Reverse & re-pitch" tool: applies reverse and/or a pitch shift (the
/// vari-speed tape technique) to the bundled test tone and plays it.
/// Real user-supplied clips land once file import (M4) exists; this proves
/// the effect chain end to end first.
#[tauri::command]
pub fn debug_play_reversed_pitched_tone(
    state: State<AppState>,
    reverse: bool,
    semitones: f64,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let asset_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-assets/test-tone.wav");
    transport::load_test_track_with_effects(
        &handle.mixer,
        &handle.engine_config,
        &asset_path,
        reverse,
        semitones as f32,
    )?;
    transport::play(&handle.mixer)
}

/// The full clip-tools effect chain, sent as one struct rather than a
/// growing list of positional args. The frontend always sends every
/// field (with sensible values even for a disabled effect) rather than
/// relying on server-side defaults, so what you hear always matches
/// exactly what the UI's sliders say.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectParams {
    pub reverse: bool,
    pub semitones: f64,
    pub eq_freq_hz: f64,
    pub eq_gain_db: f64,
    pub eq_q: f64,
    pub compress_enabled: bool,
    pub compress_threshold_db: f64,
    pub compress_ratio: f64,
    pub compress_attack_ms: f64,
    pub compress_release_ms: f64,
    pub compress_makeup_db: f64,
    pub delay_ms: f64,
    pub delay_feedback: f64,
    pub delay_wet: f64,
    pub reverb_wet: f64,
    pub reverb_room: f64,
    pub robotic_hz: f64,
    pub muffle_cutoff_hz: f64,
}

impl EffectParams {
    fn to_chain(&self) -> effects::EffectChain {
        effects::EffectChain {
            reverse: self.reverse,
            semitones: self.semitones as f32,
            eq_freq_hz: self.eq_freq_hz as f32,
            eq_gain_db: self.eq_gain_db as f32,
            eq_q: self.eq_q as f32,
            compress_enabled: self.compress_enabled,
            compress_threshold_db: self.compress_threshold_db as f32,
            compress_ratio: self.compress_ratio as f32,
            compress_attack_ms: self.compress_attack_ms as f32,
            compress_release_ms: self.compress_release_ms as f32,
            compress_makeup_db: self.compress_makeup_db as f32,
            delay_ms: self.delay_ms as f32,
            delay_feedback: self.delay_feedback as f32,
            delay_wet: self.delay_wet as f32,
            reverb_wet: self.reverb_wet as f32,
            reverb_room: self.reverb_room as f32,
            robotic_hz: self.robotic_hz as f32,
            muffle_cutoff_hz: self.muffle_cutoff_hz as f32,
        }
    }
}

/// The real clip-tools command: applies reverse, pitch, EQ, compression,
/// delay, and/or reverb to *any* file the user points at — including a
/// stem Demucs just isolated from an uploaded clip — not just the bundled
/// demo tone.
#[tauri::command]
pub fn apply_effects_to_file(
    state: State<AppState>,
    file_path: String,
    effects: EffectParams,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    transport::load_file_with_effects(
        &handle.mixer,
        &handle.engine_config,
        std::path::Path::new(&file_path),
        &effects.to_chain(),
    )?;
    transport::play(&handle.mixer)
}

#[tauri::command]
pub fn transport_play(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::play(&require_audio(&audio)?.mixer)
}

#[tauri::command]
pub fn transport_pause(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::pause(&require_audio(&audio)?.mixer)
}

#[tauri::command]
pub fn transport_stop(state: State<AppState>) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    transport::stop(&require_audio(&audio)?.mixer)
}

/// Rewind/fast-forward and click/drag-to-seek on the timeline — editing
/// a song means constantly jumping back to re-hear a spot, and Play/
/// Pause/Stop alone made that require replaying from the very start
/// every time.
#[tauri::command]
pub fn transport_seek(state: State<AppState>, position_sec: f64) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    transport::seek(&handle.mixer, position_sec, &handle.engine_config)
}

/// A track's mixer info plus its duration in seconds (computed here,
/// where the engine's sample rate/channel count is available — the
/// mixer itself only knows raw sample counts) — what the timeline UI
/// actually needs to draw proportionally-sized layers.
#[derive(Debug, Clone, Serialize)]
pub struct TrackSummary {
    pub name: String,
    pub muted: bool,
    pub duration_sec: f64,
    pub start_offset_sec: f64,
}

#[tauri::command]
pub fn list_tracks(state: State<AppState>) -> Result<Vec<TrackSummary>, String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    let channels = handle.engine_config.channels.max(1) as f64;
    let sample_rate = handle.engine_config.sample_rate.max(1) as f64;
    Ok(mixer
        .track_info()
        .into_iter()
        .map(|t| TrackSummary {
            name: t.name,
            muted: t.muted,
            duration_sec: (t.len_samples as f64 / channels) / sample_rate,
            start_offset_sec: (t.start_offset_samples as f64 / channels) / sample_rate,
        })
        .collect())
}

/// Drags a region to a different point on the timeline — the desktop
/// equivalent of the browser DAW's draggable clips, backed by the
/// mixer's real per-track `start_offset` (silence plays until the
/// shared playhead reaches it), not just a visual reposition.
#[tauri::command]
pub fn set_track_offset(
    state: State<AppState>,
    index: usize,
    offset_sec: f64,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    let channels = handle.engine_config.channels.max(1) as f64;
    let sample_rate = handle.engine_config.sample_rate.max(1) as f64;
    let offset_samples = (offset_sec.max(0.0) * sample_rate * channels).round() as usize;
    mixer.set_track_offset(index, offset_samples)
}

#[tauri::command]
pub fn set_track_muted(state: State<AppState>, index: usize, muted: bool) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.set_muted(index, muted)
}

/// Moves a layer to a new position in the stack — the backing for
/// reordering tracks in the timeline UI.
#[tauri::command]
pub fn move_track(state: State<AppState>, from: usize, to: usize) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.move_track(from, to)
}

/// Deletes a layer entirely — the backing for a "remove this layer"
/// button in the timeline UI.
#[tauri::command]
pub fn remove_track(state: State<AppState>, index: usize) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.remove_track(index)
}

/// Playhead position plus whether the mixer is still actually playing —
/// bundled together (rather than a bare position) so the frontend can
/// tell a genuine pause/stop apart from playback finishing naturally
/// (which also resets position to 0, per `MixerState::render`), and stop
/// polling in both cases instead of only the ones it triggered itself.
#[derive(Debug, Clone, Serialize)]
pub struct TransportStatus {
    pub position_sec: f64,
    pub playing: bool,
}

/// Polled by the frontend during playback to animate a moving playhead
/// over the timeline and detect when playback has ended.
#[tauri::command]
pub fn transport_status(state: State<AppState>) -> Result<TransportStatus, String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    let channels = handle.engine_config.channels.max(1) as f64;
    let sample_rate = handle.engine_config.sample_rate.max(1) as f64;
    Ok(TransportStatus {
        position_sec: (mixer.position as f64 / channels) / sample_rate,
        playing: mixer.playing,
    })
}

#[tauri::command]
pub fn soundfont_available() -> bool {
    synth::is_soundfont_available()
}

/// Instrument library demo: renders a single note with the chosen GM
/// program via the SoundFont synth and plays it — proves the instrument
/// picker end to end before it's wired into real track editing.
#[tauri::command]
pub fn play_instrument_note(state: State<AppState>, program: u8, note: i32) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let samples = synth::render_note(&handle.engine_config, program, note, 100, 1.5)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![crate::audio_engine::mixer::TrackBuffer {
        name: format!("instrument-{program}"),
        samples: std::sync::Arc::new(samples),
        gain: 1.0,
        muted: false,
        start_offset: 0,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}

/// Semitone offsets from the root for each supported chord quality — the
/// same idea as a guitar's open chord shapes (a C shape always plays a C
/// major triad no matter the instrument), generalized to any of the 128
/// GM instruments. Unrecognized qualities fall back to major so the
/// easy-start feature never silently does nothing.
pub(crate) fn chord_intervals(quality: &str) -> &'static [i32] {
    match quality {
        "minor" => &[0, 3, 7],
        "dominant7" => &[0, 4, 7, 10],
        "major7" => &[0, 4, 7, 11],
        "minor7" => &[0, 3, 7, 10],
        "sus4" => &[0, 5, 7],
        "diminished" => &[0, 3, 6],
        _ => &[0, 4, 7], // major
    }
}

/// The easy-start "press a note, hear a chord" tool: builds the chord for
/// `root_note` + `quality` and plays it through the chosen GM instrument —
/// so a brand new user gets a full, in-key chord out of piano, sax, synth,
/// or anything else, the same way pressing C on a guitar always gives a
/// full C major chord.
#[tauri::command]
pub fn play_instrument_chord(
    state: State<AppState>,
    program: u8,
    root_note: i32,
    quality: String,
) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let pitches: Vec<i32> = chord_intervals(&quality)
        .iter()
        .map(|offset| root_note + offset)
        .collect();
    let samples = synth::render_chord(&handle.engine_config, program, &pitches, 100, 1.5)?;
    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = vec![crate::audio_engine::mixer::TrackBuffer {
        name: format!("chord-{program}-{quality}"),
        samples: std::sync::Arc::new(samples),
        gain: 1.0,
        muted: false,
        start_offset: 0,
    }];
    mixer.position = 0;
    mixer.playing = true;
    Ok(())
}
