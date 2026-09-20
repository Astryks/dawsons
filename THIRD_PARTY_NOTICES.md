# Third-Party Notices

Dawsons is proprietary software (see LICENSE) that depends on the following
open-source components. Each is used under its own license, listed below.
All are free to use in closed-source, commercial software with no fees —
this list is checked before adding any new dependency.

## Shipped in the desktop app (Rust / frontend)

| Component | License | Notes |
|---|---|---|
| Tauri | MIT / Apache-2.0 | Desktop shell framework |
| cpal | MIT / Apache-2.0 | Cross-platform audio I/O |
| symphonia | MPL-2.0 | Audio decoding. Weak copyleft: only modifications to symphonia's own source files are affected; does not require open-sourcing Dawsons. |
| rustysynth | MIT | General MIDI SoundFont synthesis (instrument library) |
| rusqlite / SQLite | MIT (rusqlite) / Public Domain (SQLite) | Scene Graph persistence |
| serde / serde_json | MIT / Apache-2.0 | Serialization |
| tokio | MIT | Async runtime |
| reqwest | MIT / Apache-2.0 | HTTP client (Rust → sidecar) |
| React | MIT | Frontend UI |
| Vite | MIT | Frontend build tool |
| zustand | MIT | Frontend state store |
| zod | MIT | Frontend runtime schema validation |

## Shipped in the AI sidecar (Python)

| Component | License | Notes |
|---|---|---|
| FastAPI | MIT | Sidecar HTTP API |
| Uvicorn | BSD-3-Clause | ASGI server |
| Pydantic | MIT | Data models |
| Demucs | MIT | Stem separation (Meta AI) |
| PyTorch / torchaudio | BSD-3-Clause | ML runtime (required by Demucs) |
| librosa | ISC | Tempo, key, and chroma feature extraction |
| soundfile | BSD-3-Clause | Audio file I/O |
| numpy / scipy | BSD-3-Clause | Numerical computing |

## Reserved for later phases (not yet integrated)

| Component | License | Planned use |
|---|---|---|
| CREPE | MIT | Voice pitch detection |
| MT3 (Magenta) | Apache-2.0 | Multi-instrument transcription |
| DDSP (Magenta) | Apache-2.0 | Voice-to-instrument timbre transfer |
| Omnizart | MIT | Drum/polyphonic transcription |

## Explicitly excluded

| Component | License | Reason excluded |
|---|---|---|
| Essentia | AGPL-3.0 (commercial license required otherwise) | Closed-source commercial use requires a paid license from MTG/UPF |
| Chordino / NNLS Chroma | GPL-2.0 | Copyleft — would obligate open-sourcing dependent code |
| JUCE | GPL-3.0 (commercial license required otherwise) | Free tier is copyleft; commercial tier is paid |

## Bundled assets (not code, but redistributed)

| Asset | License | Notes |
|---|---|---|
| FluidR3_GM.sf2 (General MIDI SoundFont) | MIT (Copyright Frank Wen) | Instrument library — the single asset behind the full 128-program GM instrument set. Not committed to git (148MB) — fetched via `scripts/download_soundfont.sh`, same pattern as model weights. Source: [pianobooster/fluid-soundfont](https://github.com/pianobooster/fluid-soundfont). |

This file is updated whenever a new third-party dependency is added — see
the checklist in `docs/ARCHITECTURE.md`.
