// A real preset library — several genuinely distinct, named patterns
// per instrument (not one generic loop each), all built from this
// project's own from-scratch synth and click-to-place pattern grid.
// Style *names* here (Boom Bap, Trap, Four-on-the-Floor, Funk, Jazz…)
// describe well-known, decades-old genre conventions — the same way
// "waltz" or "shuffle" describe a rhythm feel, not any specific
// recording — the patterns themselves are original, hand-written for
// this project, not transcribed from any real song.

const DRUM_PRESETS = [
  {
    key: "drums-boombap",
    label: "Boom Bap",
    family: "drums",
    hits: [
      { step: 0, sound: "kick" },
      { step: 3, sound: "kick" },
      { step: 4, sound: "snare" },
      { step: 8, sound: "kick" },
      { step: 11, sound: "kick" },
      { step: 12, sound: "snare" },
      { step: 0, sound: "hihat" },
      { step: 2, sound: "hihat" },
      { step: 4, sound: "hihat" },
      { step: 6, sound: "hihat" },
      { step: 8, sound: "hihat" },
      { step: 10, sound: "hihat" },
      { step: 12, sound: "hihat" },
      { step: 14, sound: "hihat" },
    ],
  },
  {
    key: "drums-trap",
    label: "Trap Hats",
    family: "drums",
    hits: [
      { step: 0, sound: "kick" },
      { step: 6, sound: "kick" },
      { step: 10, sound: "kick" },
      { step: 4, sound: "clap" },
      { step: 12, sound: "clap" },
      { step: 0, sound: "hihat" },
      { step: 1, sound: "hihat" },
      { step: 2, sound: "hihat" },
      { step: 3, sound: "hihat" },
      { step: 5, sound: "hihat" },
      { step: 7, sound: "hihat" },
      { step: 8, sound: "hihat" },
      { step: 9, sound: "hihat" },
      { step: 11, sound: "hihat" },
      { step: 13, sound: "openhat" },
      { step: 14, sound: "hihat" },
      { step: 15, sound: "hihat" },
    ],
  },
  {
    key: "drums-fourfloor",
    label: "Four-on-the-Floor",
    family: "drums",
    hits: [
      { step: 0, sound: "kick" },
      { step: 4, sound: "kick" },
      { step: 8, sound: "kick" },
      { step: 12, sound: "kick" },
      { step: 2, sound: "clap" },
      { step: 10, sound: "clap" },
      { step: 0, sound: "hihat" },
      { step: 2, sound: "hihat" },
      { step: 4, sound: "hihat" },
      { step: 6, sound: "hihat" },
      { step: 8, sound: "hihat" },
      { step: 10, sound: "hihat" },
      { step: 12, sound: "hihat" },
      { step: 14, sound: "openhat" },
    ],
  },
  {
    key: "drums-rock",
    label: "Rock Beat",
    family: "drums",
    hits: [
      { step: 0, sound: "kick" },
      { step: 6, sound: "kick" },
      { step: 8, sound: "kick" },
      { step: 4, sound: "snare" },
      { step: 12, sound: "snare" },
      { step: 0, sound: "hihat" },
      { step: 2, sound: "hihat" },
      { step: 4, sound: "hihat" },
      { step: 6, sound: "hihat" },
      { step: 8, sound: "hihat" },
      { step: 10, sound: "hihat" },
      { step: 12, sound: "hihat" },
      { step: 14, sound: "hihat" },
      { step: 15, sound: "crash" },
    ],
  },
];

const BASS_PRESETS = [
  {
    key: "bass-pulse",
    label: "Steady Pulse",
    family: "bass",
    hits: [
      { step: 0, sound: "root" },
      { step: 2, sound: "root" },
      { step: 4, sound: "root" },
      { step: 6, sound: "root" },
      { step: 8, sound: "root" },
      { step: 10, sound: "root" },
      { step: 12, sound: "root" },
      { step: 14, sound: "root" },
    ],
  },
  {
    key: "bass-rootfifth",
    label: "Root & Fifth",
    family: "bass",
    hits: [
      { step: 0, sound: "root" },
      { step: 4, sound: "fifth" },
      { step: 8, sound: "root" },
      { step: 12, sound: "fifth" },
    ],
  },
  {
    key: "bass-syncopated",
    label: "Syncopated",
    family: "bass",
    hits: [
      { step: 0, sound: "root" },
      { step: 3, sound: "root" },
      { step: 6, sound: "fifth" },
      { step: 8, sound: "root" },
      { step: 11, sound: "root" },
      { step: 14, sound: "fifth" },
    ],
  },
];

const GUITAR_PRESETS = [
  {
    key: "guitar-strummed",
    label: "Strummed Chords",
    family: "guitar",
    hits: [
      { step: 0, sound: "root" },
      { step: 1, sound: "third" },
      { step: 2, sound: "fifth" },
      { step: 3, sound: "third" },
      { step: 4, sound: "root" },
      { step: 5, sound: "third" },
      { step: 6, sound: "fifth" },
      { step: 7, sound: "third" },
    ],
  },
  {
    key: "guitar-fingerpicked",
    label: "Fingerpicked",
    family: "guitar",
    hits: [
      { step: 0, sound: "root" },
      { step: 2, sound: "fifth" },
      { step: 4, sound: "third" },
      { step: 6, sound: "fifth" },
      { step: 8, sound: "root" },
      { step: 10, sound: "octave" },
      { step: 12, sound: "third" },
      { step: 14, sound: "fifth" },
    ],
  },
  {
    key: "guitar-funk",
    label: "Funk Riff",
    family: "guitar",
    hits: [
      { step: 0, sound: "root" },
      { step: 3, sound: "root" },
      { step: 5, sound: "third" },
      { step: 8, sound: "root" },
      { step: 11, sound: "fifth" },
      { step: 13, sound: "third" },
    ],
  },
];

const PIANO_PRESETS = [
  {
    key: "keys-pop",
    label: "Pop Riff",
    family: "keys",
    hits: [
      { step: 0, sound: "root" },
      { step: 4, sound: "third" },
      { step: 8, sound: "fifth" },
      { step: 12, sound: "third" },
    ],
  },
  {
    key: "keys-ballad",
    label: "Ballad Chords",
    family: "keys",
    hits: [
      { step: 0, sound: "root" },
      { step: 8, sound: "third" },
    ],
  },
  {
    key: "keys-jazz",
    label: "Jazz Comping",
    family: "keys",
    hits: [
      { step: 1, sound: "third" },
      { step: 3, sound: "fifth" },
      { step: 7, sound: "root" },
      { step: 9, sound: "third" },
      { step: 13, sound: "fifth" },
    ],
  },
];

const LEAD_PRESETS = [
  {
    key: "lead-hook",
    label: "Simple Hook",
    family: "lead",
    hits: [
      { step: 0, sound: "fifth" },
      { step: 2, sound: "third" },
      { step: 4, sound: "root" },
      { step: 6, sound: "third" },
    ],
  },
];

// Every preset, grouped by family — this is what the sidebar's
// "Preset patterns" panel renders, one section per instrument.
const PRESET_LIBRARY = [
  { family: "drums", label: "Drums", presets: DRUM_PRESETS },
  { family: "bass", label: "Bass", presets: BASS_PRESETS },
  { family: "guitar", label: "Guitar", presets: GUITAR_PRESETS },
  { family: "keys", label: "Piano", presets: PIANO_PRESETS },
  { family: "lead", label: "Lead", presets: LEAD_PRESETS },
];

// Kept for any code that still wants "the one default starter" per
// family (e.g. the instrument browser's plain "Starter" action) — just
// the first preset in each family's list.
const STARTERS = PRESET_LIBRARY.map((group) => ({
  key: group.presets[0].key,
  label: group.label,
  family: group.family,
  hits: group.presets[0].hits,
}));

export { STARTERS, PRESET_LIBRARY };
