# MyDawsons Studio — redesign plan (browser DAW)

Status: **v2 (Phase 2 essentials + DAW upgrade) built on branch `feat/studio-redesign`, served at `/studio/`.
Preview: https://mydawsons-studio-preview.vercel.app/studio/ (throwaway Vercel project).
Production (`mydawsons.com`, GitHub Pages from `main`) is untouched.**

## Where things live

- Repo: `Astryks/dawsons` (monorepo: Tauri desktop app, Python sidecar, iOS, and the website).
- Website: `website/` — static HTML/CSS/vanilla-JS ES modules, **no build step**.
- Hosting: **GitHub Pages** (`.github/workflows/deploy-pages.yml`, deploys `website/` on push to `main`; custom domain via `website/CNAME`). No Vercel project existed for this site.
- Accounts/login: **the site has no login today** — the homepage and FAQs promise "no account". The Studio keeps that; see open questions.

## References and what we took from them

| Reference | What we could verify | What we took |
|---|---|---|
| YouTube `ha4r88LPKeQ` | Title (oEmbed): "Youngest DJ & Producer DJ Arch Jnr Recreating In Da Club By 50 Cent." Couldn't watch the video. | A kid finger-drumming a hip-hop beat on pads → big, touch-friendly pad grid, computer-key mapping laid out like the pads, fast kit switching, 808/trap kits, record what you drum. |
| Vochlea Dubler 2 (Facebook reel `1228490571382970`) | Public description: "the voice-activated MIDI controller for songwriters. Let your voice be the instrument…". Couldn't watch the video. | Sing → pitch tracked → notes on any instrument (with scale snap + octave shift); beatbox → kick/snare/hat, with "teach it your sounds" training like Dubler's calibration. |
| George Michael Instagram reel `DQH0kjwjBWY` | Caption: 35th anniversary of "Waiting For That Day" (Listen Without Prejudice Vol. 1). Couldn't watch the reel; the brief says it shows layering, reversing and slowing tracks. | Loop-layering workflow: drop loops, loop/extend by dragging, reverse, tape-style slow-down (pitch drops) *and* pitch-preserving stretch, per-track mute/solo/volume/pan. |

## Feature plan by phase

### Phase 1 — MVP (built)
- **Layout**: keyboard across the top, 3×6 drum pads + voice panel on the left, multitrack timeline on the right; stacks vertically on phones.
- **Drum pads (18)**: click/multi-touch, keys `1–6 / Q–Y / A–H`, GM-mapped Web MIDI (channel 10), hi-hat choke, velocity by tap position / Shift.
  Kits: Acoustic Studio, TR-808, 909 House (synthesised), Trap (808 + tuned sub basses), Lo-fi Dusty, LinnDrum 80s, Tabla.
- **Keyboard**: responsive 1–4 octaves, mouse/multi-touch/glissando, computer keys (`A W S E D F T G Y H U J K …`, `Z/X` octave), Web MIDI.
  38 sounds: sampled Steinway grand, Wurlitzer, FM e-piano, organs, strings, choir, guitars, basses, pads, leads, brass, winds, mallets + 3 built-in synths that work offline.
- **Voice**: mic record to an audio track (latency-compensated); **Sing → keys** (AudioWorklet YIN pitch tracking, hysteresis note tracker, scale/key snap, octave shift); **Beatbox → drums** (onset detection + band-energy/ZCR features, heuristic or nearest-centroid on 4 taught examples per sound).
- **Timeline**: add Drums/Keys/Audio tracks; record pads/keys/voice into clips (count-in, metronome, optional 1/16 quantize); upload audio (file picker or drag-drop); CC0 loop library (preview, drag or +); clip move (also across tracks of the same kind), trim both edges, loop (drag right edge to repeat), reverse, tape speed 0.5–2×, stretch (keeps pitch, WSOLA), pitch ±12 st (keeps length), "Fit to tempo", volume, split at playhead, duplicate, delete, quantize/transpose note clips; track mute/solo/volume/pan; snap to 1/16; zoom.
- **Export**: offline render of the whole mix to 16-bit 44.1 kHz stereo WAV.

### v2 — built (October 2026)

**Typing layout (default "Compact"; Settings ⚙ keeps "Classic" v1).** Matched by physical key (`KeyboardEvent.code`), so it works on AZERTY/QWERTZ too. Drums and piano play at the same time — no mode switch.

```
Drums, left hand (same shape as the 3x6 pads)     Piano, right hand
  Q W E R T Y   toms / percussion                   U I . P [ ]     C# D# (gap) F# G# A#
  A S D F G `   hats / cymbals                      H J K L ; ' \   C  D  E  F  G  A  B
  Z X C V B N   kick, kick 2, snare, snare 2,      Octave: ,  down   .  up
                clap, rim
```
Every pad and piano key shows its key. Shift = harder hit. Space play/stop, Enter record, Home, Delete, Ctrl/⌘+Z / Shift+Ctrl/⌘+Z (or Ctrl+Y) undo/redo, Esc, `?` help.

**Import from anywhere.** Upload or drop files anywhere on the page; "🔗 From link" fetches an audio URL directly, and if the host blocks CORS retries via `website/api/fetch-audio.js` (Vercel function, preview project only — same-site callers, http(s) only, private IPs blocked after DNS + on every redirect, audio content types, 30 MB / 20 s caps). Streaming services (YouTube, Spotify, SoundCloud, Apple Music…) are refused in both client and proxy. "⏺ Record a tab" uses `getDisplayMedia` (tab/system audio) + MediaRecorder → new audio clip at the playhead. A one-line rights note is shown in the import bar and the footer.

**Clip editing.** ⇆ reverse button on every audio clip (one click) + right-click / long-press clip menu (reverse, half/normal tape speed, fit to tempo, fades, convert voice → notes, loop, split, duplicate, track effects, delete). Plain edge drag = trim (or repeat if looping); **Alt/Option + edge drag = time-stretch** (pitch kept; dashed edge cursor while Alt is held, live "Stretch 1.25×" tooltip). Fades: drag the small top-corner handles or pick from the clip bar.

**Effects** (`js/fx.js`, original Web Audio). Per track: EQ (3-band), filter (LP/HP/BP), distortion, compressor, chorus, delay (tempo-synced presets), convolution reverb with **self-generated impulse responses** (seeded decaying noise — no IR files to license). Each effect has presets, and one-click chain presets: Small room, Big hall, Telephone, Radio, Lo-fi, Vocal polish, Punchy drums, Dreamy, Dub echo. Master bus: reverb + limiter (ceiling) + volume. Export uses the identical chain.

**Phase-2 essentials.** Undo/redo (80 steps, snapshot-based, buffers referenced by id), autosave to IndexedDB (project JSON + raw audio, restored on load with a "Start new" option), 7-step onboarding tour on first visit (re-run from `?`), shortcuts help (`?`), clip fades.

**Extras chosen (high value, low risk).** Drum step sequencer (▦ Steps on any drum clip, 1/16 grid up to 64 steps), tap tempo, a tuner (note + cents needle) in the voice panel, "Voice Lead" built-in synth that follows pitch bends. Skipped for now to avoid bloat: piano-roll editor (next on the list), a separate metronome UI (Click already exists).

**Voice → any instrument.** "Sing → instrument" with its own *Play as* menu (every keyboard sound, plus "Drums — beatbox mode"); if a Keys track is selected, the voice plays and records onto that track. Pitch tracking moved from YIN to the **McLeod Pitch Method** in the AudioWorklet with a 32 ms window and a 5.3 ms hop (was 43 ms / 10.7 ms). Note tracker with hysteresis on pitch (±0.7 st band, 3 frames to start, 4 to change, 6 to stop) and on level (gate opens at the sensitivity threshold, closes at 60 %), velocity from loudness, optional **Glide** (live pitch-bend on built-in synths; sampled instruments take the start offset). Press ● to record the notes. **Convert a vocal clip to instrument**: clip menu → offline MPM over the clip → notes on a new Keys track (uses the voice panel's instrument, scale snap and octave).
CREPE-tiny was considered: the model is MIT-licensed, but it adds ~2 MB of weights + TF.js/ONNX runtime and a 64 ms+ analysis window, so it would *raise* latency. MPM is the lower-latency choice for live play; CREPE stays a Phase-3 option for offline conversion accuracy.

Tests: headless Chrome with a fake mic (synthesised sung melody C-D-E-G-E-C): voice played 60 62 64 67 64 60; clip conversion produced 64 67 64 60 60 62 (first note clipped by the fake device start). See the v2 report for full results.

### Phase 2 — remaining

- Project list + save/load project files (JSON + audio blobs). (Autosave + undo/redo done in v2.)
- Piano-roll editor for keys clips, velocity lanes. (Drum step grid done in v2.)
- Send/return reverb buses; automation. (Per-track FX + master done in v2.)
- Self-host (or R2/CDN-mirror) the streamed piano/soundfont samples for reliability and preload the default sounds; progress UI on first load.
- Loop library v2: tempo/key metadata, auto-fit on drop, more CC0 genres (guitar/bass/keys/vocal chops); search.
- Latency calibration wizard (tap-along) for mic takes and voice-to-instrument.
- Replace the classic homepage DAW with the Studio once Sid signs off (keep SEO copy/JSON-LD on the page, redirect/retire old features deliberately, update sitemap/llms.txt, remove `noindex`).

### Phase 3 — "AI overlay" + social
- ML pitch tracking (CREPE-tiny/SPICE via ONNX/TF.js) for more robust sing-to-instrument; learned beatbox classifier.
- Optional accounts (cloud save, share links) — only if Sid wants login (see questions).
- Bring in desktop-app features: stem separation, key/chord detection, in-house producer.
- Collaboration / publish & remix.

## Architecture (Phase 1)

```
website/studio/
  index.html, studio.css
  js/main.js         UI wiring (pads, keys, voice, clip bar, loop library, export)
  js/project.js      model + transport: tracks/clips, look-ahead scheduler, recording, offline render
  js/timeline.js     timeline UI (drag, trim, loop-extend, waveforms, note previews)
  js/kits.js         kit definitions, sample loading, synthesised voices, lo-fi FX, hi-hat choke
  js/instruments.js  keyboard sounds (smplr: Splendid piano, e-pianos, FluidR3 GM) + built-in synths
  js/clipfx.js       reverse, WSOLA time-stretch, pitch shift, waveform peaks
  js/voice.js        mic capture, note tracker, beatbox classifier + training
  js/voice-worklet.js AudioWorklet: capture + McLeod pitch (MPM) + band energies (audio thread)
  js/keymap.js       compact (v2) and classic computer-keyboard layouts
  js/fx.js           per-track effects, generated reverb IRs, presets, master bus
  js/store.js        undo/redo snapshots + IndexedDB autosave
  js/importers.js    URL import (+ proxy fallback) and tab/system-audio capture
  js/pitch.js        MPM + note tracker (offline vocal -> notes)
website/api/fetch-audio.js  Vercel function: CORS fallback for URL import (preview only)
  js/piano.js, pads.js, midi.js, loops.js, audio.js
  vendor/smplr-1.1.0.mjs (MIT)
  samples/           CC0 / PD one-shots + loops (5 MB, ogg + m4a for Safari)
  SOUND_LIBRARY.md   per-set licenses, evidence and confidence
```

Choice: raw Web Audio + smplr instead of Tone.js — smplr gives realistic
multi-velocity samplers, and a small custom scheduler/exporter keeps live
playback and WAV export on exactly the same code path.

## Licenses (summary — full table in `website/studio/SOUND_LIBRARY.md`)

- Code: smplr MIT (vendored). Everything else original.
- Samples: Splendid Grand (PD), Wurlitzer by Greg Sullivan (CC-BY 3.0, attributed), VCSL TX81Z (CC0), FluidR3_GM (MIT / CC-BY 3.0 renderings), Sonic Pi pack (CC0), TR-808 & LM-2 (PD per distributor).
- Excluded: MusyngKite/FatBoy (CC-BY-SA), Hydrogen kits (GPL), Drum Abuse (no license found), amen/breakbeat loops (commercial-record provenance).

## Known limits
- Autosave lives in this browser only (IndexedDB); no cloud sync or project files yet. Undo history is per tab and holds processed audio in memory.
- Sampled instruments need network on first use; built-in synths/kits work offline.
- Voice-to-instrument latency ~35–50 ms (32 ms window + 3 × 5.3 ms confirmation); monophonic; tuned on synthetic test signals only so far.
- Glide bends only the built-in synths live (smplr samplers can't be re-pitched after note-on).
- Tab capture needs Chrome/Edge on desktop; Safari/Firefox have no tab-audio capture. The URL proxy only exists on the Vercel preview; on GitHub Pages, CORS-blocked links show a "download it and drag it in" message.
- Stretch/pitch processing runs on the main thread (fine for loops; a few seconds for long songs).
- Web MIDI isn't available in Safari/iOS.
