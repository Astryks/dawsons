//! SQLite persistence for projects and their Scene Graphs. Rust is the
//! single writer (see ADR 0001) — the sidecar never touches this database.

use rusqlite::{Connection, OptionalExtension};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::model::{Project, VoiceNote};

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data dir: {e}"))?;
    let conn = Connection::open(dir.join("dawsons.db"))
        .map_err(|e| format!("failed to open database: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            source_file TEXT
        );
        CREATE TABLE IF NOT EXISTS scene_graphs (
            project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            schema_version TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS voice_notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            duration_sec REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            file_path TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| format!("migration failed: {e}"))
}

/// Upserts the Scene Graph JSON for a project — Rust is the sole writer
/// (see ADR 0001); the sidecar only ever returns fragments for Rust to
/// store here.
pub fn save_scene_graph(
    conn: &Connection,
    project_id: &str,
    schema_version: &str,
    data: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO scene_graphs (project_id, schema_version, data, updated_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(project_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            data = excluded.data,
            updated_at = excluded.updated_at",
        rusqlite::params![project_id, schema_version, data],
    )
    .map_err(|e| format!("failed to save scene graph: {e}"))?;
    Ok(())
}

pub fn get_scene_graph(conn: &Connection, project_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data FROM scene_graphs WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("failed to load scene graph: {e}"))
}

pub fn list_voice_notes(conn: &Connection) -> Result<Vec<VoiceNote>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, duration_sec, created_at, file_path FROM voice_notes ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(VoiceNote {
                id: row.get(0)?,
                title: row.get(1)?,
                duration_sec: row.get(2)?,
                created_at: row.get(3)?,
                file_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn create_voice_note(
    conn: &Connection,
    id: &str,
    title: &str,
    duration_sec: f64,
    file_path: &str,
) -> Result<VoiceNote, String> {
    conn.execute(
        "INSERT INTO voice_notes (id, title, duration_sec, file_path) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, title, duration_sec, file_path],
    )
    .map_err(|e| format!("failed to save voice note: {e}"))?;
    conn.query_row(
        "SELECT id, title, duration_sec, created_at, file_path FROM voice_notes WHERE id = ?1",
        [id],
        |row| {
            Ok(VoiceNote {
                id: row.get(0)?,
                title: row.get(1)?,
                duration_sec: row.get(2)?,
                created_at: row.get(3)?,
                file_path: row.get(4)?,
            })
        },
    )
    .map_err(|e| format!("failed to load saved voice note: {e}"))
}

/// Deletes the DB row and returns the file path so the caller can remove
/// the audio file too (kept as two steps so a failed file delete doesn't
/// silently leave an orphaned DB row referencing nothing).
pub fn delete_voice_note(conn: &Connection, id: &str) -> Result<String, String> {
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM voice_notes WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| format!("no voice note with id {id}"))?;
    conn.execute("DELETE FROM voice_notes WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete voice note: {e}"))?;
    Ok(file_path)
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at, source_file FROM projects ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                source_file: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn create_project(
    conn: &Connection,
    name: &str,
    source_file: Option<&str>,
) -> Result<Project, String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO projects (id, name, source_file) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, source_file],
    )
    .map_err(|e| format!("failed to create project: {e}"))?;
    get_project(conn, &id)
}

fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, created_at, updated_at, source_file FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                source_file: row.get(4)?,
            })
        },
    )
    .map_err(|e| format!("failed to load created project: {e}"))
}

pub fn rename_project(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE projects SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| format!("failed to rename project: {e}"))?;
    if updated == 0 {
        return Err(format!("no project with id {id}"));
    }
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| format!("failed to delete project: {e}"))?;
    if deleted == 0 {
        return Err(format!("no project with id {id}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn create_then_list_returns_the_project() {
        let conn = test_db();
        let created = create_project(&conn, "My Song", None).unwrap();
        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, created.id);
        assert_eq!(projects[0].name, "My Song");
    }

    #[test]
    fn rename_updates_the_name() {
        let conn = test_db();
        let created = create_project(&conn, "Old Name", None).unwrap();
        rename_project(&conn, &created.id, "New Name").unwrap();
        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects[0].name, "New Name");
    }

    #[test]
    fn rename_missing_project_errors() {
        let conn = test_db();
        assert!(rename_project(&conn, "nonexistent", "x").is_err());
    }

    #[test]
    fn delete_removes_the_project() {
        let conn = test_db();
        let created = create_project(&conn, "Temp", None).unwrap();
        delete_project(&conn, &created.id).unwrap();
        assert_eq!(list_projects(&conn).unwrap().len(), 0);
    }

    #[test]
    fn delete_missing_project_errors() {
        let conn = test_db();
        assert!(delete_project(&conn, "nonexistent").is_err());
    }

    #[test]
    fn create_then_list_returns_the_voice_note() {
        let conn = test_db();
        let created =
            create_voice_note(&conn, "vn-1", "Idea for chorus", 12.5, "/tmp/vn-1.wav").unwrap();
        let notes = list_voice_notes(&conn).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, created.id);
        assert_eq!(notes[0].title, "Idea for chorus");
        assert!((notes[0].duration_sec - 12.5).abs() < 1e-9);
    }

    #[test]
    fn delete_voice_note_returns_its_file_path_and_removes_the_row() {
        let conn = test_db();
        create_voice_note(&conn, "vn-2", "Bassline", 4.0, "/tmp/vn-2.wav").unwrap();
        let path = delete_voice_note(&conn, "vn-2").unwrap();
        assert_eq!(path, "/tmp/vn-2.wav");
        assert_eq!(list_voice_notes(&conn).unwrap().len(), 0);
    }

    #[test]
    fn delete_missing_voice_note_errors() {
        let conn = test_db();
        assert!(delete_voice_note(&conn, "nonexistent").is_err());
    }

    /// Closes a real gap: item 76's "Add audio track (no separation)"
    /// button (`handleAddRawAudioTrack` in App.tsx) builds this exact
    /// Scene-Graph shape by hand (not a sidecar analysis result) and
    /// saves it so the track survives a project switch — that save/get
    /// round trip itself had no test at all until now. Confirms what Sid
    /// asked to "check in the app" for real: a fortnite.mp4 track added
    /// via the no-separation path, persisted, and reloaded, ends up in
    /// exactly the shape `load_stems_from_result` (analysis.rs) needs
    /// (it only ever reads `name` + `audioFilePath` off each entry) —
    /// the fields that only exist for a real analysis result (`tempo`,
    /// `key`, etc.) are absent here, by design, and that's fine.
    #[test]
    fn fortnite_track_added_without_separation_survives_a_save_and_reload() {
        let conn = test_db();
        let project = create_project(&conn, "Fortnite test", None).unwrap();

        // Exactly what handleAddRawAudioTrack constructs client-side.
        let graph = serde_json::json!({
            "schemaVersion": "1.0.0",
            "song": {
                "tracks": [{
                    "id": "11111111-1111-1111-1111-111111111111",
                    "name": "fortnite",
                    "type": "audio",
                    "instrument": "other",
                    "audioFilePath": "/Users/sidmehta/Downloads/fortnite.mp4",
                    "source": "user",
                }]
            }
        });
        save_scene_graph(
            &conn,
            &project.id,
            graph["schemaVersion"].as_str().unwrap(),
            &graph.to_string(),
        )
        .unwrap();

        // Simulate switching away and back to the project (the M6b
        // restore effect) — reload from scratch, parse it back.
        let reloaded = get_scene_graph(&conn, &project.id)
            .unwrap()
            .expect("scene graph must still be there after reload");
        let parsed: serde_json::Value = serde_json::from_str(&reloaded).unwrap();
        let tracks = parsed["song"]["tracks"].as_array().unwrap();
        assert_eq!(tracks.len(), 1);

        // Exactly load_stems_from_result's own extraction — if this
        // passes, the real Tauri command will restore this track.
        let name = tracks[0]["name"].as_str().expect("track missing name");
        let path = tracks[0]["audioFilePath"]
            .as_str()
            .expect("track missing audioFilePath");
        assert_eq!(name, "fortnite");
        assert_eq!(path, "/Users/sidmehta/Downloads/fortnite.mp4");
    }
}
