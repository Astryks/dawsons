use tauri::State;

use crate::sidecar::SidecarStatus;
use crate::state::AppState;

/// Lets the frontend fetch the current status on mount, complementing the
/// `sidecar:status` events pushed on every state change (an event emitted
/// before a listener subscribes would otherwise be missed).
#[tauri::command]
pub fn sidecar_status(state: State<AppState>) -> Result<SidecarStatus, String> {
    let handle = state
        .sidecar_handle
        .lock()
        .map_err(|_| "sidecar state poisoned".to_string())?;
    match handle.as_ref() {
        Some(h) => h
            .status
            .lock()
            .map(|s| s.clone())
            .map_err(|_| "sidecar status poisoned".to_string()),
        None => Ok(SidecarStatus::Starting),
    }
}
