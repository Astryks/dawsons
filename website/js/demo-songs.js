// Original demo compositions for the browser DAW — the same original
// songs authored for the desktop app's demo_songs.rs, ported here so the
// two share the exact same musical data. Standard chord progressions
// (I-V-vi-IV, ii-V-I, etc.) aren't copyrightable; only a specific
// melodic realization is, and these melodies are original.

const BAR_SEC = 2.0;
const EIGHTH = BAR_SEC / 8;
const QUARTER = BAR_SEC / 4;

function note(pitch, dur) {
  return { pitches: [pitch], dur };
}
function chord(pitches, dur) {
  return { pitches, dur };
}

function bassPulse(root) {
  return [note(root, QUARTER), note(root, QUARTER), note(root, QUARTER), note(root, QUARTER)];
}

function arpeggio([r, third, fifth]) {
  return [r, third, fifth, third, r, third, fifth, third].map((p) => note(p, EIGHTH));
}

function melodyPhrase([a, b, c, d]) {
  return [note(a, QUARTER), note(b, QUARTER), note(c, QUARTER), note(d, QUARTER)];
}

function standardDrumBar() {
  return [
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
  ];
}

function fourBarDrums() {
  return [...standardDrumBar(), ...standardDrumBar(), ...standardDrumBar(), ...standardDrumBar()];
}

function buildFromChords(chords, build) {
  const piano = [];
  const bass = [];
  const guitar = [];
  const lead = [];
  for (const [ch, root, arp, mel] of chords) {
    piano.push(chord(ch, BAR_SEC));
    bass.push(...bassPulse(root));
    guitar.push(...arpeggio(arp));
    lead.push(...melodyPhrase(mel));
  }
  return build(piano, bass, guitar, lead);
}

function morningLoop() {
  const chords = [
    [[48, 52, 55], 36, [60, 64, 67], [72, 71, 69, 67]],
    [[43, 47, 50], 43, [55, 59, 62], [71, 69, 67, 65]],
    [[45, 48, 52], 45, [57, 60, 64], [69, 67, 65, 64]],
    [[41, 45, 48], 41, [53, 57, 60], [67, 65, 64, 62]],
  ];
  return buildFromChords(chords, (piano, bass, guitar, lead) => ({
    title: "Morning Loop",
    genre: "Pop",
    description: "Upbeat pop progression (C–G–Am–F) — piano, bass, guitar, and a choir lead.",
    layers: [
      { name: "Vocal", family: "lead", notes: lead },
      { name: "Guitar", family: "guitar", notes: guitar },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass },
    ],
    drums: fourBarDrums(),
  }));
}

function blueCorner() {
  const chords = [
    [[50, 53, 57, 60], 38, [62, 65, 69], [69, 67, 65, 62]],
    [[55, 59, 62, 65], 43, [67, 71, 74], [74, 72, 71, 69]],
    [[48, 52, 55, 59], 36, [60, 64, 67], [67, 65, 64, 62]],
    [[57, 60, 64, 67], 45, [69, 72, 76], [76, 74, 72, 69]],
  ];
  return buildFromChords(chords, (piano, bass, guitar, lead) => ({
    title: "Blue Corner",
    genre: "Jazz",
    description: "Classic jazz turnaround (Dm7–G7–Cmaj7–Am7) — sax lead, piano, guitar comping, bass.",
    layers: [
      { name: "Sax Lead", family: "brass", notes: lead },
      { name: "Guitar", family: "guitar", notes: guitar },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass },
    ],
    drums: fourBarDrums(),
  }));
}

function cornerGroove() {
  const chords = [
    [[57, 60, 64], 45, [69, 72, 76], [76, 74, 72, 69]],
    [[55, 59, 62], 43, [67, 71, 74], [74, 72, 71, 67]],
    [[53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]],
    [[55, 59, 62], 43, [67, 71, 74], [71, 69, 67, 62]],
  ];
  return buildFromChords(chords, (piano, bass, synthRiff, hornStabs) => ({
    title: "Corner Groove",
    genre: "Hip-Hop",
    description: "Boom-bap style loop (Am–G–F–G) — horn-stab hook, synth riff, electric piano, deep bass.",
    layers: [
      { name: "Horn Stabs", family: "brass", notes: hornStabs },
      { name: "Synth Riff", family: "lead", notes: synthRiff },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass },
    ],
    drums: fourBarDrums(),
  }));
}

function firesideLoop() {
  const chords = [
    [[53, 57, 60], 41, [65, 69, 72], [72, 74, 76, 77]],
    [[58, 62, 65], 46, [70, 74, 77], [77, 76, 74, 72]],
    [[60, 64, 67], 48, [72, 76, 79], [79, 77, 76, 74]],
    [[53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]],
  ];
  return buildFromChords(chords, (piano, bass, sparkle, lead) => ({
    title: "Fireside Loop",
    genre: "Holiday",
    description: "Warm holiday-pop loop (F–Bb–C–F) — glockenspiel sparkle, piano, bass, choir lead.",
    layers: [
      { name: "Choir Lead", family: "lead", notes: lead },
      { name: "Sparkle", family: "bell", notes: sparkle },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass },
    ],
    drums: fourBarDrums(),
  }));
}

const DEMO_SONGS = [morningLoop(), blueCorner(), cornerGroove(), firesideLoop()];

export { DEMO_SONGS, BAR_SEC };
