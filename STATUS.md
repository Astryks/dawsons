# Status

Living progress log for Dawsons. Updated after every merge — check here
first for what's actually done vs. planned.

## Done (merged to `main`)

- **M1** — Repo scaffold: Tauri+React shell, AI sidecar skeleton, Scene Graph JSON Schema v1.0.0
- **M2** — Real-time audio engine (cpal + symphonia): file decode, resample, multi-track mixing, transport
- **M3** — Sidecar process supervision: spawn, health-check, restart-once-on-crash, graceful shutdown
- **Marketing site** — `website/`, deployed to [mydawsons.com](https://mydawsons.com) via free GitHub Pages (DNS still needs pointing at GitHub Pages from the registrar)
- **Clip tools: reverse, re-pitch & reverb** — vari-speed reverse/pitch-shift plus a from-scratch Schroeder reverb (comb + all-pass filters, our own DSP code, no dependency), all runnable on *any* file the user picks (an isolated Demucs stem, an exported clip, an upload) — not just a bundled demo tone
- **Smart upload** — drop in any sound file and the sidecar runs it through Demucs, compares stem energies, and suggests which instrument layer it belongs in (or a new layer if nothing matches clearly) before adding it to the timeline as its own track
- **Multi-project management** — local SQLite `projects` table, create/rename/delete/switch
- **Export** — mix bounce and per-stem export to local WAV files
- **Voice Notes** — on-device recording/playback/delete (cpal capture path)
- **M4 — Real song analysis**: real Demucs stem separation via `htdemucs_6s` (6 stems: vocals/drums/bass/guitar/piano/other — a genuinely different model checkpoint than the default 4-stem one), job tracking (`POST /analyze` → poll → done), stems load as independently mutable tracks
- **M5 — Tempo/key/chord/section detection**: real librosa-based tempo/key, a custom chroma+template chord detector (avoids GPL Chordino), novelty-based sections — all assembled into the full schema-validated Scene Graph fragment, persisted per-project in SQLite
- **Instrument library** — 128 General MIDI instruments playable via `rustysynth` + a free MIT-licensed SoundFont (FluidR3_GM, fetched via `scripts/download_soundfont.sh`, never committed — same pattern as model weights)
- **Voice-to-instrument** — the second flagship capability from the original vision. YIN pitch tracking (classical DSP, not a model) turns a recording into MIDI notes, played back through any of the 128 GM instruments.
- **Chord starter** — the "press C, hear a C major chord" easy-start feature, generalized across all 128 instruments (major/minor/7th/maj7/min7/sus4/diminished)
- **Genre-based example songs** — 6 original demo compositions across Pop, Jazz, Hip-Hop, Holiday, R&B/Soul, and Folk/Acoustic, filterable by a genre picker on the home screen, paired with a factual (title/artist/year only) inspiration list of real famous songs per genre — see the "Example songs & genre inspiration" section in `docs/UX_DESIGN.md` for why the playable examples are original compositions rather than transcriptions of the real songs referenced

41 Rust unit tests + 10 Python tests (including real end-to-end runs — Demucs inference, the full M5 pipeline, and clip classification, not mocked) passing. Everything above runs 100% locally — no server, no cloud cost, per the project's core constraint.

## Open-source model inventory (what's actually integrated vs. discussed)

- **Integrated**: Demucs (`htdemucs_6s`), librosa (tempo/key), a custom chroma+template chord detector (replaces Chordino/GPL), YIN pitch tracking (replaces CREPE for this use case — see reasoning in the voice-to-instrument commit).
- **Discussed, not yet integrated**: CREPE (optional higher-accuracy pitch mode — tractable, queued), DDSP (real timbre-preserving voice-to-instrument, bigger effort — queued), MT3/Omnizart (polyphonic transcription to populate real note-level data in stems — needs research into current install paths, historically finicky JAX-based setup), ACE-Step/YuE2 (full generative models — Phase 5, likely too heavy for the 16GB M1 Pro this was built on; correctly deferred per the original roadmap's own "generation only after editing is solid" principle).

## Not started yet

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
- The dev machine's pyenv-built Python 3.11.10 was missing `lzma` support (needed transitively by librosa's `pooch` dependency) — fixed by building xz 5.8.4 from source as a static lib and rebuilding Python against it. If setting up on a fresh machine, watch for this same failure mode and note that xz 5.6.0/5.6.1 specifically are backdoored (CVE-2024-3094) — use 5.6.2+ or the 5.4.x/5.8.x lines.
- YouTube link import was considered and explicitly dropped: extracting audio from YouTube violates their ToS regardless of any in-app disclaimer (a disclaimer manages user liability, not whether the app itself breaks the platform's terms). Direct file upload is the only import path, by design.
