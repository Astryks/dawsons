// "Tap an instrument, hear a beat instantly" starter loops for the home
// screen — a 2-bar seed pattern per instrument family, immediately
// editable afterward via pattern-editor.js's click-to-place grid. This
// is the same instant-gratification hook GarageBand's touch instruments
// are built around, reimplemented with this project's own from-scratch
// synth — original patterns, not derived from any existing song.

const STARTERS = [
  {
    key: "drums",
    label: "Drums",
    icon: "🥁",
    family: "drums",
    hits: [
      { step: 0, sound: "kick" },
      { step: 1, sound: "hihat" },
      { step: 2, sound: "snare" },
      { step: 3, sound: "hihat" },
      { step: 4, sound: "kick" },
      { step: 5, sound: "hihat" },
      { step: 6, sound: "snare" },
      { step: 7, sound: "hihat" },
      { step: 8, sound: "kick" },
      { step: 9, sound: "hihat" },
      { step: 10, sound: "snare" },
      { step: 11, sound: "hihat" },
      { step: 12, sound: "kick" },
      { step: 13, sound: "hihat" },
      { step: 14, sound: "snare" },
      { step: 15, sound: "hihat" },
    ],
  },
  {
    key: "keys",
    label: "Keys",
    icon: "🎹",
    family: "keys",
    hits: [
      { step: 0, sound: "root" },
      { step: 4, sound: "third" },
      { step: 8, sound: "fifth" },
      { step: 12, sound: "third" },
    ],
  },
  {
    key: "bass",
    label: "Bass",
    icon: "🎸",
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
    key: "guitar",
    label: "Guitar",
    icon: "🪕",
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
    key: "lead",
    label: "Lead",
    icon: "🎤",
    family: "lead",
    hits: [
      { step: 0, sound: "fifth" },
      { step: 2, sound: "third" },
      { step: 4, sound: "root" },
      { step: 6, sound: "third" },
    ],
  },
];

export { STARTERS };
