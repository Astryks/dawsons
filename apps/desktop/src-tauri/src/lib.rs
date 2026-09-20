mod audio_engine;
mod commands;
mod scene_graph;
mod sidecar;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .setup(|app| {
            let state = app.state::<state::AppState>();
            state.init_audio();
            state.init_sidecar(app.handle().clone());
            state.init_db(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::transport::debug_play_test_tone,
            commands::transport::debug_play_reversed_pitched_tone,
            commands::transport::transport_play,
            commands::transport::transport_pause,
            commands::transport::transport_stop,
            commands::transport::list_tracks,
            commands::transport::set_track_muted,
            commands::sidecar::sidecar_status,
            commands::analysis::start_analysis,
            commands::analysis::analysis_status,
            commands::analysis::load_stems_from_result,
            commands::project::save_scene_graph,
            commands::project::get_scene_graph,
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::rename_project,
            commands::project::delete_project,
            commands::export::export_mix,
            commands::export::export_stems,
            commands::voice_notes::start_voice_recording,
            commands::voice_notes::stop_voice_recording,
            commands::voice_notes::list_voice_notes,
            commands::voice_notes::delete_voice_note,
            commands::voice_notes::play_voice_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running dawsons");
}
