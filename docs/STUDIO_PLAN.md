# MyDawsons Studio — redesign plan (browser DAW)

Status: **Phase 1 MVP built on branch `feat/studio-redesign`, served at `/studio/`.
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

### Phase 2 — make it sticky
- Autosave to IndexedDB + project list; undo/redo; save/load project files (JSON + audio blobs).
- Piano-roll/step editor for note clips (edit notes, draw beats), velocity lanes.
- Per-track effects (reverb, delay, EQ, compressor, filter) and a master section; send/return reverb.
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
  js/voice-worklet.js AudioWorklet: capture + YIN + band energies (audio thread)
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

## Known limits of the MVP
- No undo, no autosave (a leave-page warning guards unsaved work).
- Sampled instruments need network on first use; built-in synths/kits work offline.
- Voice-to-instrument latency ~50–70 ms (analysis window + confirmation frames); monophonic; tuned on synthetic test signals only so far.
- Stretch/pitch processing runs on the main thread (fine for loops; a few seconds for long songs).
- Web MIDI isn't available in Safari/iOS.
