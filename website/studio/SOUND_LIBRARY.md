# MyDawsons Studio — sound library, code dependencies & licenses

Every sound the Studio plays is either **original** (synthesised in the
browser by our own code) or comes from a set whose license allows use in a
closed-source, commercial product. Licenses were checked against the
upstream repositories/READMEs on 2026-09-30 (not just third-party summaries).
Where our confidence is lower than "verified at the original source", it says so.

## Vendored in this repo (`website/studio/samples/`, fetched by `scripts/fetch_studio_samples.sh`)

| Set | Used for | License | Source / evidence | Confidence |
|---|---|---|---|---|
| **Sonic Pi sample pack** (`sonicpi/*`, `loops/*`) | Acoustic kit, Lo-fi kit, Tabla kit, vinyl FX, the whole Loop library | **CC0 1.0** (public domain dedication) | `sonic-pi-net/sonic-pi` → `etc/samples/README.md`: "All other samples … are from freesound.org and have also been placed in the public domain via the Creative Commons 0 License"; per-file freesound links listed there. Mirrored at `smpldsnds/sonic-pi-samples`. | Verified at upstream |
| **Roland TR-808 set** by Michael Fischer / Technopolis (1994) (`tr808/*`) | 808 kit, Trap kit | Public domain / free | `smpldsnds/drum-machines` README: "A collection of public domain samples of different drum machines". The original 1994 `TR808.TXT` (in that repo) says the set is "ABSOLUTELY FREE". These are recordings of a hardware machine (sounds, not compositions). | Good (distributor states PD; author says free, no explicit PD wording) |
| **LM-2 (LinnDrum-style)** (`lm2/*`) | LinnDrum 80s kit, some one-shots in other kits | Public domain | `smpldsnds/drum-machines` README (same as above). | Good (distributor statement; original author not identified) |

Deliberately **not** vendored: Sonic Pi's `loop_amen`, `loop_amen_full`
and `loop_breakbeat`. They are recognisable breaks lifted from commercial
records, so a CC0 tag on freesound can't clear the underlying recording.

## Streamed on demand (not in git) via smplr

| Instrument(s) in the keyboard menu | Samples | License | Evidence | Confidence |
|---|---|---|---|---|
| Grand Piano (sampled Steinway) | **Splendid Grand Piano** (AKAI, 4 velocity layers), `smpldsnds.github.io/sfzinstruments-splendid-grand-piano` | **Public domain** | README (sfzinstruments + smpldsnds mirror): "This samples set was released as public domain in early 2000 by Akai company." | Good |
| Electric Piano – Wurlitzer | **Greg Sullivan** Wurlitzer EP200, `smpldsnds.github.io/sfzinstruments-greg-sullivan-e-pianos` | **CC-BY 3.0** — attribution required | LICENSE/README in that repo; "with the author permission with the request for attribution". **Attribution: "Wurlitzer EP200 samples by Greg Sullivan (sullivang.net), CC-BY 3.0."** | Verified |
| FM Electric Piano (TX81Z) | **Versilian Community Sample Library (VCSL)**, `smpldsnds.github.io/sgossner-vcsl` | **CC0 1.0** | `sgossner/VCSL` license = CC0-1.0; README: "you can do whatever you want with these sounds (even make commercial software)". | Verified |
| All other sampled sounds (organs, strings, choir, guitars, basses, pads, leads, brass, winds, mallets…) | **FluidR3_GM** General MIDI SoundFont by **Frank Wen**, pre-rendered by `gleitz/midi-js-soundfonts` (`gleitz.github.io/midi-js-soundfonts/FluidR3_GM/`) | **MIT** (original SoundFont) — gleitz's README labels the rendered set **CC-BY 3.0** | gleitz README; FluidR3 MIT per `pianobooster/fluid-soundfont` (already recorded in `THIRD_PARTY_NOTICES.md`). We attribute under both: **"FluidR3_GM SoundFont © Frank Wen (MIT); MIDI.js renderings by Benjamin Gleitzman (gleitz), CC-BY 3.0."** | Verified |

Deliberately **not** used: **MusyngKite** and **FatBoy** renderings (smplr's
default soundfont). They're CC-BY-**SA** 3.0, and share-alike is a bad fit for
a proprietary product. We pin `kit: "FluidR3_GM"` in `js/instruments.js`.
Also skipped: smplr's **CP80** electric grand (three samples 404 upstream),
the **Drum Abuse** packs (no license statement found), **Hydrogen** drum kits
(GPL-2.0), and the smpldsnds soundfont collection (GPL-3.0 / CC-4.0 variants).

## Original sounds (our code, no samples)

- **909 House (synth)** kit: every pad synthesised in `js/kits.js` (sine-sweep kick, noise+tone snare, filtered noise clap, square-bank metallic hats/cymbals, etc.), rendered once to buffers.
- **Trap** kit's six tuned **808 sub basses** + "808 Long" (`sub808()` in `js/kits.js`).
- **Lo-fi Dusty** processing (sample-rate reduction, bit-crush, low-pass, soft clip) applied to CC0/PD one-shots.
- Built-in keyboard synths: Analog Synth, Sub Bass, Chiptune (`js/instruments.js`).
- Metronome click.

## Code dependencies

| Component | Version | License | How it ships |
|---|---|---|---|
| smplr (danigb) | 1.1.0 | MIT (package.json `license`) | Vendored unmodified at `vendor/smplr-1.1.0.mjs` (+ `vendor/SMPLR-LICENSE.txt`) |
| Web Audio API, AudioWorklet, Web MIDI, MediaDevices | — | Browser platform APIs | — |

No Tone.js is used in this MVP — raw Web Audio + smplr covers scheduling,
sampling and export with fewer moving parts. WSOLA time-stretch, YIN pitch
tracking and the beatbox classifier are original implementations of
well-known public techniques.

## User content

Files a user uploads or records stay in their browser tab. Nothing is
uploaded to a server. Users are responsible for rights to material they
import (e.g. samples from commercial records).
