use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::audio_engine::demo_songs::all_demo_songs;
use crate::audio_engine::mixer::TrackBuffer;
use crate::audio_engine::synth::{render_drums, render_part};
use crate::state::AppState;

#[derive(Serialize)]
pub struct DemoSongInfo {
    pub index: usize,
    pub title: String,
    pub genre: String,
    pub description: String,
}

#[tauri::command]
pub fn list_demo_songs() -> Vec<DemoSongInfo> {
    all_demo_songs()
        .into_iter()
        .enumerate()
        .map(|(index, song)| DemoSongInfo {
            index,
            title: song.title.to_string(),
            genre: song.genre.to_string(),
            description: song.description.to_string(),
        })
        .collect()
}

/// Renders every layer of a demo song (plus drums) through the GM synth
/// and loads them into the mixer as separate, independently mutable
/// tracks — the "populated project right away" home-screen experience.
#[tauri::command]
pub fn load_demo_song(state: State<AppState>, index: usize) -> Result<(), String> {
    let song = crate::audio_engine::demo_songs::demo_song(index)
        .ok_or_else(|| format!("no demo song at index {index}"))?;

    let audio = state
        .audio
        .lock()
        .map_err(|_| "audio state poisoned".to_string())?;
    let handle = audio
        .as_ref()
        .ok_or_else(|| "audio engine unavailable".to_string())?;
    let config = &handle.engine_config;

    let mut tracks = Vec::with_capacity(song.layers.len() + 1);
    for layer in &song.layers {
        let samples = render_part(config, layer.program, &layer.notes)?;
        tracks.push(TrackBuffer {
            name: layer.name.to_string(),
            samples: Arc::new(samples),
            gain: 1.0,
            muted: false,
        });
    }
    let drum_samples = render_drums(config, &song.drums)?;
    tracks.push(TrackBuffer {
        name: "Drums".to_string(),
        samples: Arc::new(drum_samples),
        gain: 1.0,
        muted: false,
    });

    let mut mixer = handle
        .mixer
        .lock()
        .map_err(|_| "mixer lock poisoned".to_string())?;
    mixer.tracks = tracks;
    mixer.position = 0;
    mixer.playing = false;
    Ok(())
}
