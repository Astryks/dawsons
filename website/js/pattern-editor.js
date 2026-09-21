// A minimal, click-to-place beat/note grid for any track — the
// GarageBand-style "tap a sound, tap a step to place it, tap again to
// remove it" interaction, built on this project's own from-scratch synth
// (synth.js). Every track's pattern is just a list of {step, sound}
// hits at a fixed eighth-note grid resolution; the audio buffer is
// simply re-rendered from that list whenever it changes, so there is
// never a separate "pattern" and "audio" to keep in sync.

import { renderVoice, renderDrumHit } from "./synth.js";

const STEP_SEC = 0.25; // one eighth note, matching demo-songs.js's BAR_SEC=2.0 tempo
const STEPS_PER_BEAT = 2; // a beat is a quarter note = 2 eighth-note steps
const DEFAULT_STEPS = 16; // 2 bars

function notePalette(root, rootLabel) {
  return [
    { key: "root", label: rootLabel, note: root },
    { key: "third", label: "3rd", note: root + 4 },
    { key: "fifth", label: "5th", note: root + 7 },
    { key: "octave", label: rootLabel + "'", note: root + 12 },
  ];
}

const FAMILY_PALETTES = {
  drums: [
    { key: "kick", label: "Kick" },
    { key: "snare", label: "Snare" },
    { key: "hihat", label: "Hi-hat" },
    { key: "clap", label: "Clap" },
  ],
  keys: notePalette(60, "C"),
  guitar: notePalette(60, "C"),
  bass: notePalette(48, "C"),
  lead: notePalette(60, "C"),
  pad: notePalette(60, "C"),
  brass: notePalette(60, "C"),
  bell: notePalette(72, "C"),
  flute: notePalette(72, "C"),
  saxophone: notePalette(58, "C"),
  clarinet: notePalette(62, "C"),
  strings: notePalette(60, "C"),
  organ: notePalette(60, "C"),
  epiano: notePalette(60, "C"),
  choir: notePalette(64, "C"),
  synthbass: notePalette(40, "C"),
  marimba: notePalette(72, "C"),
  trumpet: notePalette(60, "C"),
};

function paletteFor(family) {
  return FAMILY_PALETTES[family] || FAMILY_PALETTES.keys;
}

function soundLabel(family, soundKey) {
  const entry = paletteFor(family).find((s) => s.key === soundKey);
  return entry ? entry.label : soundKey;
}

function rebuildBuffer(ctx, sampleRate, family, hits, totalSteps) {
  const totalSamples = Math.max(1, Math.ceil(totalSteps * STEP_SEC * sampleRate));
  const buf = ctx.createBuffer(2, totalSamples, sampleRate);
  const palette = paletteFor(family);
  for (const hit of hits) {
    const startSec = hit.step * STEP_SEC;
    if (family === "drums") {
      renderDrumHit(buf, hit.sound, startSec, sampleRate);
    } else if (hit.note !== undefined) {
      // An absolute MIDI note, not a palette key — used for hits
      // converted from real composed material (e.g. a demo song's
      // bass/arpeggio line), where the harmonic root genuinely changes
      // bar to bar and can't be expressed as one fixed palette root.
      // Editing this step (see toggleStep) replaces it with a plain
      // palette-key hit, same as any user-placed step.
      renderVoice(ctx, buf, family, [hit.note], startSec, STEP_SEC * 1.8, sampleRate);
    } else {
      const entry = palette.find((s) => s.key === hit.sound);
      if (entry) renderVoice(ctx, buf, family, [entry.note], startSec, STEP_SEC * 1.8, sampleRate);
    }
  }
  return buf;
}

// Creates a pattern-backed track's metadata + its initial rendered
// buffer. `hits` seeds the pattern (e.g. a starter loop); pass `[]` for
// a blank, silent grid the user builds up from scratch.
function createPattern(ctx, sampleRate, family, hits = [], totalSteps = DEFAULT_STEPS) {
  const ownHits = hits.map((h) => ({ ...h }));
  return {
    family,
    hits: ownHits,
    totalSteps,
    buffer: rebuildBuffer(ctx, sampleRate, family, ownHits, totalSteps),
  };
}

// Toggles one step: removes a hit already there, or places `sound` if
// the step is empty and a sound is given. Mutates `pattern` in place and
// returns the freshly rebuilt buffer (the caller assigns it to the
// track).
function toggleStep(ctx, sampleRate, pattern, step, sound) {
  const existingIndex = pattern.hits.findIndex((h) => h.step === step);
  if (existingIndex >= 0) {
    pattern.hits.splice(existingIndex, 1);
  } else if (sound) {
    pattern.hits.push({ step, sound });
  }
  pattern.buffer = rebuildBuffer(ctx, sampleRate, pattern.family, pattern.hits, pattern.totalSteps);
  return pattern.buffer;
}

// Auto-fills `sound` at every Nth beat across the whole pattern, without
// disturbing hits already placed elsewhere — the "clap every 4 beats"
// quick-populate action.
function autoFillEveryBeats(ctx, sampleRate, pattern, sound, everyBeats) {
  const strideSteps = Math.max(1, Math.round(everyBeats * STEPS_PER_BEAT));
  for (let step = 0; step < pattern.totalSteps; step += strideSteps) {
    if (!pattern.hits.some((h) => h.step === step)) {
      pattern.hits.push({ step, sound });
    }
  }
  pattern.buffer = rebuildBuffer(ctx, sampleRate, pattern.family, pattern.hits, pattern.totalSteps);
  return pattern.buffer;
}

export {
  STEP_SEC,
  STEPS_PER_BEAT,
  DEFAULT_STEPS,
  FAMILY_PALETTES,
  paletteFor,
  soundLabel,
  createPattern,
  toggleStep,
  autoFillEveryBeats,
};
