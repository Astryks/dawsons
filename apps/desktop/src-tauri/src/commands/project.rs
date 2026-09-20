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

/// Persists a completed analysis result (or any Scene-Graph-shaped value)
/// against a project. `data` is stored as-is (already schema-validated on
/// the Python side); `schema_version` is read out of it here so the two
/// never drift apart.
#[tauri::command]
pub fn save_scene_graph(
    state: State<AppState>,
    project_id: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let schema_version = data
        .get("schemaVersion")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing schemaVersion".to_string())?
        .to_string();
    let serialized = serde_json::to_string(&data)
        .map_err(|e| format!("failed to serialize scene graph: {e}"))?;
    with_db(&state, |conn| {
        store::save_scene_graph(conn, &project_id, &schema_version, &serialized)
    })
}

/// Returns a project's saved Scene Graph, if it has one — e.g. to restore
/// a previous analysis when the user switches back to that project.
#[tauri::command]
pub fn get_scene_graph(
    state: State<AppState>,
    project_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let raw = with_db(&state, |conn| store::get_scene_graph(conn, &project_id))?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| format!("stored scene graph is corrupt: {e}")))
        .transpose()
}
