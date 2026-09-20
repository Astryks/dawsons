use tauri::State;

use crate::scene_graph::{store, Project};
use crate::state::AppState;

fn with_db<T>(
    state: &State<AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .db
        .lock()
        .map_err(|_| "database state poisoned".to_string())?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| "project database unavailable".to_string())?;
    f(conn)
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    with_db(&state, store::list_projects)
}

#[tauri::command]
pub fn create_project(
    state: State<AppState>,
    name: String,
    source_file: Option<String>,
) -> Result<Project, String> {
    with_db(&state, |conn| {
        store::create_project(conn, &name, source_file.as_deref())
    })
}

#[tauri::command]
pub fn rename_project(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    with_db(&state, |conn| store::rename_project(conn, &id, &name))
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: String) -> Result<(), String> {
    with_db(&state, |conn| store::delete_project(conn, &id))
}
