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
| ACE-Step | Apache-2.0 (code **and** published model weights — verified directly against the LICENSE file and the Hugging Face model card, not just a description) | Text-prompt-to-original-instrumental generation |
| diffusers / transformers / accelerate | Apache-2.0 | ACE-Step's inference stack |

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
| MusicGen (Meta AudioCraft) | Code is MIT, but the published pretrained **weights** are CC-BY-NC 4.0 | Weights are non-commercial only — the same "code is free, weights aren't" trap the project has watched for since Essentia |
| Stable Audio Open | Stability AI Community License | Free only under $1M annual revenue, then requires a paid Enterprise license and mandatory registration — exactly the kind of scaling-cost dependency this project avoids, even though small-scale use is currently free |
| YuE2 | Weights require a separately negotiated commercial license | The original YuE (v1) remains Apache-2.0 including weights and was considered, but its 7B-parameter LLM-based architecture is too heavy for this project's target hardware (a 16GB M1 Pro); ACE-Step's diffusion-based approach was chosen instead for being both properly licensed and lightweight enough to actually run here |

## Bundled assets (not code, but redistributed)

| Asset | License | Notes |
|---|---|---|
| FluidR3_GM.sf2 (General MIDI SoundFont) | MIT (Copyright Frank Wen) | Instrument library — the single asset behind the full 128-program GM instrument set. Not committed to git (148MB) — fetched via `scripts/download_soundfont.sh`, same pattern as model weights. Source: [pianobooster/fluid-soundfont](https://github.com/pianobooster/fluid-soundfont). |

This file is updated whenever a new third-party dependency is added — see
the checklist in `docs/ARCHITECTURE.md`.
