use tauri::State;

use crate::audio_engine::wav_writer;
use crate::state::AppState;

fn require_audio(
    state: &Option<crate::state::AudioEngineHandle>,
) -> Result<&crate::state::AudioEngineHandle, String> {
    state
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())
}

/// Bounces the current mixer output (all unmuted tracks, summed across the
/// full length) to a single WAV file at `path` — chosen by the frontend via
/// a native save dialog, not hardcoded here. Local file I/O only; no server.
#[tauri::command]
pub fn export_mix(state: State<AppState>, path: String) -> Result<(), String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let mix = {
        let mixer = handle
            .mixer
            .lock()
            .map_err(|_| "mixer lock poisoned".to_string())?;
        mixer.render_full_mix()
    };
    wav_writer::write_wav(
        std::path::Path::new(&path),
        &mix,
        handle.engine_config.sample_rate,
        handle.engine_config.channels,
    )
}

/// Writes each loaded track to its own WAV file in `dir` (chosen via a
/// native folder-picker on the frontend). Returns the written file paths.
#[tauri::command]
pub fn export_stems(state: State<AppState>, dir: String) -> Result<Vec<String>, String> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = require_audio(&audio)?;
    let dir_path = std::path::Path::new(&dir);
    std::fs::create_dir_all(dir_path).map_err(|e| format!("failed to create {dir_path:?}: {e}"))?;

    let mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    let mut written = Vec::with_capacity(mixer.tracks.len());
    for (i, track) in mixer.tracks.iter().enumerate() {
        let file_path = dir_path.join(format!("track_{}.wav", i + 1));
        wav_writer::write_wav(
            &file_path,
            &track.samples,
            handle.engine_config.sample_rate,
            handle.engine_config.channels,
        )?;
        written.push(file_path.to_string_lossy().into_owned());
    }
    Ok(written)
}
