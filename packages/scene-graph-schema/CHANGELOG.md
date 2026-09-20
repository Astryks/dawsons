# Scene Graph Schema Changelog

## 1.0.0 — Phase 1

Initial schema: `song` with `bpm`/`key`/`timeSignature`, `sections`,
`tracks` (audio only — `midi` type reserved), `notes` (empty for Phase 1
audio tracks), `chords`, `automation` (reserved, unused in Phase 1). Every
AI-derived field carries `confidence` and `source`.

A `schemaVersion` bump is required for any breaking change (removed/renamed
required field, changed type, changed enum semantics). Additive, optional
fields do not require a version bump but should still be noted here.
Loading a project with an older `schemaVersion` triggers a migration
function in `apps/desktop/src-tauri/src/scene_graph/migrations/` — none
exist yet since this is the first version.
