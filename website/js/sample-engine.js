// Real sampled instruments for the homepage DAW — "See how detailed
// [Ableton's] left section is with so many types of instruments that
// sound like real instruments. Add that." The homepage's own synth.js
// is a from-scratch oscillator engine (original design choice, kept
// lightweight/dependency-free) that fundamentally can't sound like a
// recorded instrument no matter how it's tuned. This module brings in
// the same real, already-vetted sample engine `website/studio/` already
// uses in production — smplr (MIT), streaming properly-licensed
// recordings (Splendid Grand Piano/public domain, Greg Sullivan
// Wurlitzer EP200/CC-BY 3.0, VCSL TX81Z FM piano/CC0, FluidR3_GM
// renderings/MIT+CC-BY 3.0 — full sourcing already verified in
// THIRD_PARTY_NOTICES.md's "Browser Studio" section, not re-researched
// here). Vendored unmodified at js/vendor/smplr-1.1.0.mjs (same file,
// copied from website/studio/vendor/, not re-fetched).
//
// The homepage's track model is fundamentally different from Studio's
// live-playable-keyboard model, though: every homepage track is a
// pre-rendered AudioBuffer (see synth.js's renderVoice/pattern-editor.js's
// createPattern), not a live Web-Audio-node instrument you play in real
// time. smplr's own instruments work on *any* BaseAudioContext, offline
// included (see its exported `renderOffline` helper) — so rather than
// building a second, parallel live-playing engine, this renders a
// family's starter-riff hits through a real sampled instrument into one
// real AudioBuffer via an OfflineAudioContext, which then drops straight
// into the existing Track/buffer model with zero changes needed
// anywhere else (timeline, waveform, export, mixer all just see a
// buffer, same as any other track).
import { SplendidGrandPiano, ElectricPiano, Soundfont, Versilian, renderOffline } from "./vendor/smplr-1.1.0.mjs";
import { paletteFor } from "./pattern-editor.js";

// Only families with a real, credible sampled match are listed here —
// drums/lead/pad/pluck are deliberately synthetic sounds with no one
// "real" acoustic instrument to sample, so they're left out on purpose
// and keep using the existing oscillator synth with zero behavior
// change. GM instrument names match the exact ids already used (and
// already license-verified) in website/studio/js/instruments.js's
// FluidR3_GM soundfont mapping.
//
// (2026-10-04) Grown per direct feedback ("make sure instruments dont
// sound computer like... have a large library of real music sounds") —
// two kinds of additions, both using sources already verified in
// THIRD_PARTY_NOTICES.md, no new license research:
//   1. `synthbass` added (soundfont synth_bass_1) — Studio's own
//      INSTRUMENTS list already uses this exact id from the same
//      FluidR3_GM source for its own "Synth Bass" entry; extending
//      coverage to an already-verified source's existing catalogue,
//      not a new dependency.
//   2. harp/marimba/bell/saxophone upgraded from a FluidR3_GM
//      soundfont rendering to a real multi-sampled recording from VCSL
//      (Versilian Community Sample Library, CC0 1.0 — the exact same
//      repo (`sgossner/VCSL` via smpldsnds.github.io/sgossner-vcsl)
//      already verified and in use for the TX81Z FM piano; VCSL's
//      license is CC0 for the whole collection, not per-instrument, so
//      using more of its catalogue needs no new verification). Every
//      path below was checked directly against the mirror's own
//      `sfz_files.json` manifest and confirmed to resolve (sfz file +
//      its .ogg/.m4a sample assets, both 200) before being added here —
//      not assumed from smplr's own hardcoded example path, which
//      pointed at a "Strings/Violin" instrument this particular mirror
//      does not actually have (checked and confirmed absent from the
//      manifest, so violin/cello/strings/choir/brass/trumpet/trombone/
//      clarinet/flute/oboe/bass/guitars stay on their existing FluidR3
//      mapping rather than guessing at an unverified VCSL path).
const FAMILY_SAMPLE_MAP = {
  keys: { type: "piano" },
  epiano: { type: "epiano", instrument: "WurlitzerEP200" },
  organ: { type: "soundfont", instrument: "drawbar_organ" },
  clavinet: { type: "soundfont", instrument: "clavinet" },
  guitar: { type: "soundfont", instrument: "acoustic_guitar_nylon" },
  guitar_clean: { type: "soundfont", instrument: "electric_guitar_clean" },
  guitar_distorted: { type: "soundfont", instrument: "overdriven_guitar" },
  bass: { type: "soundfont", instrument: "acoustic_bass" },
  synthbass: { type: "soundfont", instrument: "synth_bass_1" },
  strings: { type: "soundfont", instrument: "string_ensemble_1" },
  violin: { type: "soundfont", instrument: "violin" },
  cello: { type: "soundfont", instrument: "cello" },
  harp: { type: "versilian", instrument: "Chordophones/Composite Chordophones/Concert Harp" },
  choir: { type: "soundfont", instrument: "choir_aahs" },
  brass: { type: "soundfont", instrument: "brass_section" },
  trumpet: { type: "soundfont", instrument: "trumpet" },
  trombone: { type: "soundfont", instrument: "trombone" },
  saxophone: { type: "versilian", instrument: "Aerophones/Reed Aerophones/Tenor Saxophone - Vibrato" },
  clarinet: { type: "soundfont", instrument: "clarinet" },
  flute: { type: "soundfont", instrument: "flute" },
  oboe: { type: "soundfont", instrument: "oboe" },
  marimba: { type: "versilian", instrument: "Idiophones/Struck Idiophones/Marimba" },
  bell: { type: "versilian", instrument: "Idiophones/Struck Idiophones/Tubular Bells 1" },
};

export function hasSample(family) {
  return Object.prototype.hasOwnProperty.call(FAMILY_SAMPLE_MAP, family);
}

async function createSampledInstrument(ctx, family) {
  const def = FAMILY_SAMPLE_MAP[family];
  if (!def) return null;
  let inst;
  if (def.type === "piano") inst = SplendidGrandPiano(ctx, { destination: ctx.destination, decayTime: 0.6 });
  else if (def.type === "epiano") inst = ElectricPiano(ctx, { destination: ctx.destination, instrument: def.instrument });
  else if (def.type === "versilian") inst = Versilian(ctx, { destination: ctx.destination, instrument: def.instrument });
  else inst = Soundfont(ctx, { destination: ctx.destination, kit: "FluidR3_GM", instrument: def.instrument });
  await (inst.ready || inst.load);
  return inst;
}

// Renders the exact same {step, sound}/{step, note}-hit array
// pattern-editor.js's own rebuildBuffer works from, through a real
// sampled instrument instead of the built-in oscillator synth — same
// step timing and note duration, so a "real instrument" track lines up
// with its synth-starter sibling. Returns a real AudioBuffer, or null
// if this family has no sampled match (caller falls back to the synth).
export async function renderSampledPattern(family, hits, totalSteps, stepSec, sampleRate) {
  if (!hasSample(family)) return null;
  const palette = paletteFor(family);
  const duration = Math.max(0.5, totalSteps * stepSec + 1.5); // +tail for the sample's own natural decay
  const result = await renderOffline(
    async (offlineCtx) => {
      const inst = await createSampledInstrument(offlineCtx, family);
      if (!inst) return;
      for (const hit of hits) {
        const startSec = hit.step * stepSec;
        const note = hit.note !== undefined ? hit.note : palette.find((s) => s.key === hit.sound)?.note;
        if (note === undefined) continue;
        inst.start({ note, velocity: 100, time: startSec, duration: stepSec * 1.8 });
      }
    },
    { sampleRate, channels: 2, duration },
  );
  return result.audioBuffer;
}
