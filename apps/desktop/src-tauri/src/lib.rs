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
        .manage(state::AppState::default())
        .setup(|app| {
            let state = app.state::<state::AppState>();
            state.init_audio();
            state.init_sidecar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::transport::debug_play_test_tone,
            commands::transport::debug_play_reversed_pitched_tone,
            commands::transport::transport_play,
            commands::transport::transport_pause,
            commands::transport::transport_stop,
            commands::sidecar::sidecar_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running dawsons");
}
