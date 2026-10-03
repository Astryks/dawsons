// A genre/decade-themed starter-pattern library — "free pre-made beats
// under themes like jazz, pop, hip hop, rock, funky, 90s 80s 70s 60s."
// Explicitly NOT scraped or extracted from any third-party "free beat"
// site, loop pack, or sample library — that request was declined
// directly (see STATUS.md): almost all of that content is
// non-commercial-only, requires attribution, or forbids bundling into a
// product, which would be real copyright exposure. This is the
// legitimate equivalent instead: original multi-track arrangements
// (drums + bass + one melodic instrument), hand-composed fresh for this
// project using the same well-known, decades-old, uncopyrightable genre
// *conventions* (a four-on-the-floor kick, a walking bass line, a boom-
// bap snare placement) that `starter-patterns.js`'s single-instrument
// presets already use the same way — not transcribed from, or derived
// from, any specific recording. Same standard this project already
// holds itself to elsewhere (see STATUS.md's chord-detector test
// fixtures: "synthesized ground-truth... built from publicly
// documented, uncopyrightable chord names, not real recordings").
//
// Each preset is a small multi-track "song starter": one click adds
// every listed track to the timeline at once, each as a genuinely
// editable pattern track (same click-to-place grid, same
// createPattern()/STARTERS machinery every other instrument-browser
// track already uses) — not a single locked-together audio clip.
const GENRE_PATTERNS = [
  {
    key: "genre-jazz",
    label: "Jazz",
    description: "Swung ride feel, walking-ish bass, syncopated comping chords.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 10, sound: "kick" },
          { step: 4, sound: "rimshot" },
          { step: 12, sound: "rimshot" },
          { step: 0, sound: "hihat" },
          { step: 3, sound: "hihat" },
          { step: 6, sound: "hihat" },
          { step: 9, sound: "hihat" },
          { step: 12, sound: "hihat" },
          { step: 15, sound: "hihat" },
        ],
      },
      {
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "fifth" },
          { step: 8, sound: "third" },
          { step: 12, sound: "fifth" },
        ],
      },
      {
        family: "keys",
        hits: [
          { step: 1, sound: "third" },
          { step: 5, sound: "fifth" },
          { step: 9, sound: "root" },
          { step: 13, sound: "third" },
        ],
      },
    ],
  },
  {
    key: "genre-pop",
    label: "Pop",
    description: "Clean backbeat, steady root-note bass, a simple hook riff.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
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
        ],
      },
      {
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "root" },
          { step: 8, sound: "root" },
          { step: 12, sound: "root" },
        ],
      },
      {
        family: "keys",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "third" },
          { step: 8, sound: "fifth" },
          { step: 12, sound: "third" },
        ],
      },
    ],
  },
  {
    key: "genre-hiphop",
    label: "Hip-Hop",
    description: "Boom-bap kick/snare, sparse bass locked to the kick, moody stabs.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 7, sound: "kick" },
          { step: 10, sound: "kick" },
          { step: 4, sound: "clap" },
          { step: 12, sound: "clap" },
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
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 7, sound: "root" },
          { step: 10, sound: "root" },
        ],
      },
      {
        family: "epiano",
        hits: [
          { step: 2, sound: "third" },
          { step: 7, sound: "root" },
          { step: 10, sound: "fifth" },
          { step: 13, sound: "third" },
        ],
      },
    ],
  },
  {
    key: "genre-rock",
    label: "Rock",
    description: "Driving eighth-note bass, power-chord hits, a crash on one.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 6, sound: "kick" },
          { step: 8, sound: "kick" },
          { step: 4, sound: "snare" },
          { step: 12, sound: "snare" },
          { step: 0, sound: "crash" },
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
        family: "guitar_distorted",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "fifth" },
          { step: 8, sound: "root" },
          { step: 12, sound: "fifth" },
        ],
      },
    ],
  },
  {
    key: "genre-funk",
    label: "Funk",
    description: "Syncopated 16th-note hats, a ghost-note snare, a tight comped riff.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 3, sound: "kick" },
          { step: 8, sound: "kick" },
          { step: 11, sound: "kick" },
          { step: 6, sound: "rimshot" },
          { step: 14, sound: "rimshot" },
          { step: 4, sound: "clap" },
          { step: 12, sound: "clap" },
          { step: 0, sound: "hihat" },
          { step: 2, sound: "hihat" },
          { step: 3, sound: "hihat" },
          { step: 5, sound: "hihat" },
          { step: 6, sound: "hihat" },
          { step: 8, sound: "hihat" },
          { step: 10, sound: "hihat" },
          { step: 11, sound: "hihat" },
          { step: 13, sound: "hihat" },
          { step: 14, sound: "hihat" },
        ],
      },
      {
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
      {
        family: "guitar_clean",
        hits: [
          { step: 1, sound: "root" },
          { step: 3, sound: "third" },
          { step: 6, sound: "fifth" },
          { step: 9, sound: "third" },
          { step: 11, sound: "root" },
          { step: 14, sound: "fifth" },
        ],
      },
    ],
  },
  {
    key: "genre-60s",
    label: "60s",
    description: "Bright backbeat, quarter-note walking bass, twangy clean chords.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
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
        ],
      },
      {
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "fifth" },
          { step: 8, sound: "third" },
          { step: 12, sound: "fifth" },
        ],
      },
      {
        family: "guitar_clean",
        hits: [
          { step: 0, sound: "root" },
          { step: 4, sound: "third" },
          { step: 8, sound: "fifth" },
          { step: 12, sound: "third" },
        ],
      },
    ],
  },
  {
    key: "genre-70s",
    label: "70s",
    description: "Disco four-on-the-floor, an octave-jumping bass, a funky skank guitar.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 4, sound: "kick" },
          { step: 8, sound: "kick" },
          { step: 12, sound: "kick" },
          { step: 4, sound: "clap" },
          { step: 12, sound: "clap" },
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
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 2, sound: "octave" },
          { step: 4, sound: "root" },
          { step: 6, sound: "octave" },
          { step: 8, sound: "root" },
          { step: 10, sound: "octave" },
          { step: 12, sound: "root" },
          { step: 14, sound: "octave" },
        ],
      },
      {
        family: "guitar_clean",
        hits: [
          { step: 1, sound: "third" },
          { step: 3, sound: "fifth" },
          { step: 9, sound: "third" },
          { step: 11, sound: "fifth" },
        ],
      },
    ],
  },
  {
    key: "genre-80s",
    label: "80s",
    description: "Gated-clap drum machine, pulsing synth bass, a bright arpeggio lead.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 8, sound: "kick" },
          { step: 4, sound: "clap" },
          { step: 12, sound: "clap" },
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
        family: "synthbass",
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
        family: "lead",
        hits: [
          { step: 0, sound: "root" },
          { step: 2, sound: "third" },
          { step: 4, sound: "fifth" },
          { step: 6, sound: "octave" },
          { step: 8, sound: "fifth" },
          { step: 10, sound: "third" },
          { step: 12, sound: "root" },
          { step: 14, sound: "third" },
        ],
      },
    ],
  },
  {
    key: "genre-90s",
    label: "90s",
    description: "Half-time grunge beat, root-locked bass, a distorted riff.",
    tracks: [
      {
        family: "drums",
        hits: [
          { step: 0, sound: "kick" },
          { step: 10, sound: "kick" },
          { step: 8, sound: "snare" },
          { step: 0, sound: "crash" },
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
        family: "bass",
        hits: [
          { step: 0, sound: "root" },
          { step: 8, sound: "root" },
        ],
      },
      {
        family: "guitar_distorted",
        hits: [
          { step: 0, sound: "root" },
          { step: 3, sound: "third" },
          { step: 8, sound: "root" },
          { step: 11, sound: "fifth" },
        ],
      },
    ],
  },
];

export { GENRE_PATTERNS };
