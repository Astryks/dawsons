use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceNote {
    pub id: String,
    pub title: String,
    pub duration_sec: f64,
    pub created_at: String,
    pub file_path: String,
}
