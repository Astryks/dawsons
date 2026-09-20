# Status

Living progress log for Dawsons. Updated after every merge — check here
first for what's actually done vs. planned.

## Done (merged to `main`)

- **M1** — Repo scaffold: Tauri+React shell, AI sidecar skeleton, Scene Graph JSON Schema v1.0.0
- **M2** — Real-time audio engine (cpal + symphonia): file decode, resample, multi-track mixing, transport
- **M3** — Sidecar process supervision: spawn, health-check, restart-once-on-crash, graceful shutdown
- **Marketing site** — `website/`, deployed to [mydawsons.com](https://mydawsons.com) via free GitHub Pages (DNS still needs pointing at GitHub Pages from the registrar)
- **Reverse & pitch-shift** — vari-speed audio effect, real feature with tests
- **Multi-project management** — local SQLite `projects` table, create/rename/delete/switch
- **Export** — mix bounce and per-stem export to local WAV files
- **Voice Notes** — on-device recording/playback/delete (cpal capture path)
- **M4 — Real song analysis**: real Demucs stem separation (not mocked), job tracking (`POST /analyze` → poll → done), stems load as independently mutable tracks in the audio engine

25 Rust unit tests + 4 Python tests (including a real end-to-end Demucs inference test) passing. Everything above runs 100% locally — no server, no cloud cost, per the project's core constraint.

## Not started yet

- M5 — Tempo/key/chord/section detection populating the full Scene Graph (M4's `/analyze` result is stems-only for now; the full schema-shaped fragment lands here)
- M6 — Timeline + AI-breakdown UI (track add/remove/reorder, song-browser dropdown, confidence badges)
- M6b — Voice Notes UI polish / promoting a note into a project
- M7 — Real model weight download flow with first-run progress UX
- M8 — Packaging (PyInstaller-frozen sidecar bundled into the Tauri app)
- M9 — Hardening (crash/restart testing, bad-file handling)
- Cloud-generation Pro tier (needs a backend, billing, accounts — see `docs/MONETIZATION.md`; not built)
- Local profile (name + picture, "your songs" list) — designed, not built; explicitly *not* a multi-user social network (that needs a paid server/hosting decision first, see `docs/UX_DESIGN.md`)

## Known issues / notes for next session

- Branching discipline slipped once (edited files on `main` before creating a feature branch), which combined with GitHub's squash-merge commit-hash changes to cause a real merge conflict — resolved cleanly, but always `git checkout -b <branch>` first from now on.
- Model weights (Demucs, and later CREPE/MT3/DDSP) are deliberately **not** committed to git — see `docs/ARCHITECTURE.md` and the note in `services/ai-sidecar/models/`. They're fetched from each project's own public distribution point at runtime, which is the free and correct approach; see that section for why vendoring them here would be both costly and unnecessary.
