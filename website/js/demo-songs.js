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

// Converts a sequential note-event array ({pitches, dur}, back-to-back
// in time — the shape bassPulse/arpeggio/melodyPhrase all produce) into
// the pattern editor's step-indexed hit format ({step, note}), so a
// layer built the normal way can ALSO be made click-to-place editable.
// Only meaningful for a track whose grid resolution genuinely divides
// evenly into these events' durations — true here since every demo
// song's rhythm section is built from EIGHTH/QUARTER multiples of the
// same BAR_SEC, matching the pattern editor's own STEP_SEC exactly.
function eventsToHits(events, stepSec) {
  const hits = [];
  let stepCursor = 0;
  for (const ev of events) {
    if (ev.pitches.length) hits.push({ step: stepCursor, note: ev.pitches[0] });
    stepCursor += Math.round(ev.dur / stepSec);
  }
  return { hits, totalSteps: stepCursor };
}

function drumHitsToPattern(drumEvents, stepSec) {
  const hits = [];
  let stepCursor = 0;
  for (const ev of drumEvents) {
    hits.push({ step: stepCursor, sound: ev.kind });
    stepCursor += Math.round(ev.dur / stepSec);
  }
  return { hits, totalSteps: stepCursor };
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
  // Piano (sustained block chords) and lead (a genuine passing-tone
  // melody) don't fit the click-to-place grid's root/3rd/5th/octave
  // palette without distorting them — bass and the arpeggio-role line
  // are both built entirely from that same 3-note-cycle vocabulary
  // already, so they convert losslessly.
  const bassPattern = eventsToHits(bass, EIGHTH);
  const guitarPattern = eventsToHits(guitar, EIGHTH);
  return build(piano, bass, guitar, lead, bassPattern, guitarPattern);
}

function morningLoop() {
  const chords = [
    [[48, 52, 55], 36, [60, 64, 67], [72, 71, 69, 67]],
    [[43, 47, 50], 43, [55, 59, 62], [71, 69, 67, 65]],
    [[45, 48, 52], 45, [57, 60, 64], [69, 67, 65, 64]],
    [[41, 45, 48], 41, [53, 57, 60], [67, 65, 64, 62]],
  ];
  const drums = fourBarDrums();
  return buildFromChords(chords, (piano, bass, guitar, lead, bassPattern, guitarPattern) => ({
    title: "Morning Loop",
    genre: "Pop",
    description: "Upbeat pop progression (C–G–Am–F) — piano, bass, guitar, and a choir lead.",
    layers: [
      { name: "Vocal", family: "lead", notes: lead },
      { name: "Guitar", family: "guitar", notes: guitar, pattern: guitarPattern },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass, pattern: bassPattern },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  }));
}

function blueCorner() {
  const chords = [
    [[50, 53, 57, 60], 38, [62, 65, 69], [69, 67, 65, 62]],
    [[55, 59, 62, 65], 43, [67, 71, 74], [74, 72, 71, 69]],
    [[48, 52, 55, 59], 36, [60, 64, 67], [67, 65, 64, 62]],
    [[57, 60, 64, 67], 45, [69, 72, 76], [76, 74, 72, 69]],
  ];
  const drums = fourBarDrums();
  return buildFromChords(chords, (piano, bass, guitar, lead, bassPattern, guitarPattern) => ({
    title: "Blue Corner",
    genre: "Jazz",
    description: "Classic jazz turnaround (Dm7–G7–Cmaj7–Am7) — sax lead, piano, guitar comping, bass.",
    layers: [
      { name: "Sax Lead", family: "saxophone", notes: lead },
      { name: "Guitar", family: "guitar", notes: guitar, pattern: guitarPattern },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass, pattern: bassPattern },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  }));
}

function cornerGroove() {
  const chords = [
    [[57, 60, 64], 45, [69, 72, 76], [76, 74, 72, 69]],
    [[55, 59, 62], 43, [67, 71, 74], [74, 72, 71, 67]],
    [[53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]],
    [[55, 59, 62], 43, [67, 71, 74], [71, 69, 67, 62]],
  ];
  const drums = fourBarDrums();
  return buildFromChords(chords, (piano, bass, synthRiff, hornStabs, bassPattern, synthRiffPattern) => ({
    title: "Corner Groove",
    genre: "Hip-Hop",
    description: "Boom-bap style loop (Am–G–F–G) — horn-stab hook, synth riff, electric piano, deep bass.",
    layers: [
      { name: "Horn Stabs", family: "brass", notes: hornStabs },
      { name: "Synth Riff", family: "lead", notes: synthRiff, pattern: synthRiffPattern },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass, pattern: bassPattern },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  }));
}

function firesideLoop() {
  const chords = [
    [[53, 57, 60], 41, [65, 69, 72], [72, 74, 76, 77]],
    [[58, 62, 65], 46, [70, 74, 77], [77, 76, 74, 72]],
    [[60, 64, 67], 48, [72, 76, 79], [79, 77, 76, 74]],
    [[53, 57, 60], 41, [65, 69, 72], [72, 69, 65, 60]],
  ];
  const drums = fourBarDrums();
  return buildFromChords(chords, (piano, bass, sparkle, lead, bassPattern, sparklePattern) => ({
    title: "Fireside Loop",
    genre: "Holiday",
    description: "Warm holiday-pop loop (F–Bb–C–F) — glockenspiel sparkle, piano, bass, choir lead.",
    layers: [
      { name: "Choir Lead", family: "lead", notes: lead },
      { name: "Sparkle", family: "bell", notes: sparkle, pattern: sparklePattern },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass, pattern: bassPattern },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  }));
}

// Four-on-the-floor drum pattern (kick every beat, hi-hat on the
// off-beats) — the foundational rhythm of house/techno/EDM production,
// a genre-defining technique in the public domain, not any one track's
// specific drum programming.
function edmDrumBar() {
  return [
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
    { kind: "kick", dur: EIGHTH },
    { kind: "hihat", dur: EIGHTH },
  ];
}
function fourBarEdmDrums() {
  return [...edmDrumBar(), ...edmDrumBar(), ...edmDrumBar(), ...edmDrumBar()];
}

function neonPulse() {
  const chords = [
    [[45, 48, 52], 33, [57, 60, 64], [69, 67, 64, 60]],
    [[41, 45, 48], 29, [53, 57, 60], [65, 64, 60, 57]],
    [[43, 47, 50], 31, [55, 59, 62], [67, 65, 62, 59]],
    [[38, 41, 45], 26, [50, 53, 57], [62, 60, 57, 53]],
  ];
  const pad = [];
  const bass = [];
  const arp = [];
  const lead = [];
  for (const [ch, root, arpNotes, mel] of chords) {
    pad.push(chord(ch, BAR_SEC));
    bass.push(...bassPulse(root));
    arp.push(...arpeggio(arpNotes));
    lead.push(...melodyPhrase(mel));
  }
  const drums = fourBarEdmDrums();
  return {
    title: "Neon Pulse",
    genre: "Electronic",
    description:
      "Driving four-on-the-floor electronic loop (Am–Fm–Gm–Dm) — arpeggiated synth, pulsing sub bass, filtered pad, in the general style of filtered-synth dance/psytrance production, not any specific track.",
    layers: [
      { name: "Lead Synth", family: "lead", notes: lead },
      { name: "Arp", family: "guitar", notes: arp, pattern: eventsToHits(arp, EIGHTH) },
      { name: "Pad", family: "pad", notes: pad },
      { name: "Bass", family: "bass", notes: bass, pattern: eventsToHits(bass, EIGHTH) },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  };
}

// A simple military-cadence drum pattern (kick on the downbeat, a
// three-snare roll filling the rest of the bar) — standard marching
// band rhythm vocabulary, not from any specific band's arrangement.
function marchDrumBar() {
  return [
    { kind: "kick", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "kick", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
    { kind: "snare", dur: EIGHTH },
  ];
}
function fourBarMarchDrums() {
  return [...marchDrumBar(), ...marchDrumBar(), ...marchDrumBar(), ...marchDrumBar()];
}

function fieldParade() {
  const chords = [
    [[53, 57, 60], 41, [65, 69, 72], [72, 74, 76, 77]],
    [[58, 62, 65], 46, [70, 74, 77], [77, 76, 74, 72]],
    [[60, 64, 67], 48, [72, 76, 79], [79, 77, 76, 74]],
    [[53, 57, 60], 41, [65, 69, 72], [77, 76, 74, 72]],
  ];
  const harmony = [];
  const bass = [];
  const counter = [];
  const melody = [];
  for (const [ch, root, counterNotes, mel] of chords) {
    harmony.push(chord(ch, BAR_SEC));
    bass.push(...bassPulse(root));
    counter.push(...arpeggio(counterNotes));
    melody.push(...melodyPhrase(mel));
  }
  const drums = fourBarMarchDrums();
  return {
    title: "Field Parade",
    genre: "Marching Band",
    description:
      "Bright brass march (Fmaj–Bbmaj–Cmaj–Fmaj) with a snare-roll cadence — bold brass melody and countermelody over a tuba-style bass pulse.",
    layers: [
      { name: "Brass Melody", family: "brass", notes: melody },
      { name: "Brass Harmony", family: "saxophone", notes: counter, pattern: eventsToHits(counter, EIGHTH) },
      { name: "Sousaphone", family: "bass", notes: bass, pattern: eventsToHits(bass, EIGHTH) },
    ],
    drums,
    drumsPattern: drumHitsToPattern(drums, EIGHTH),
  };
}

function risingOverture() {
  const chords = [
    [[45, 48, 52], 33, [57, 60, 64], [69, 72, 76, 79]],
    [[41, 45, 48], 41, [53, 57, 60], [72, 71, 69, 67]],
    [[48, 52, 55], 36, [60, 64, 67], [79, 77, 76, 74]],
    [[43, 47, 50], 31, [55, 59, 62], [74, 72, 71, 69]],
  ];
  const strings = [];
  const bass = [];
  const brassAccent = [];
  const vocal = [];
  for (const [ch, root, brass_, mel] of chords) {
    strings.push(chord(ch, BAR_SEC));
    bass.push(...bassPulse(root));
    brassAccent.push(...arpeggio(brass_));
    vocal.push(...melodyPhrase(mel));
  }
  return {
    title: "Rising Overture",
    genre: "Opera & Symphony",
    description:
      "A dramatic orchestral/opera-style overture (Am–F–C–G) — a soaring choir/vocal lead over string pad, brass fanfare accents, and a bell shimmer, built the way a symphonic overture layers voices.",
    layers: [
      { name: "Choir Lead", family: "lead", notes: vocal },
      { name: "Brass Fanfare", family: "brass", notes: brassAccent, pattern: eventsToHits(brassAccent, EIGHTH) },
      { name: "Strings", family: "pad", notes: strings },
      { name: "Cello/Bass", family: "bass", notes: bass, pattern: eventsToHits(bass, EIGHTH) },
    ],
    drums: [],
  };
}

// Stockholm Nights — the user's own original song, uploaded for real
// analysis through the same pipeline the desktop app's "upload a song,
// see how it's built" feature uses (Demucs 6-stem separation + librosa
// tempo/key/chord detection). Grounded in the actual detected data, not
// invented: real key (C major, 0.959 confidence), the real first four
// detected chords in order (Fmaj7 → Dmaj7 → C → Dm), a real 6-note
// vocal-melody fragment extracted from the isolated vocals stem via
// librosa's pYIN pitch tracker, and the real separated instrumentation
// (Piano/Guitar/Bass/Vocals — "Other" from Demucs mapped to Pad).
function stockholmNights() {
  const chords = [
    [[53, 57, 60, 64], 41, [53, 57, 60], [62, 60, 60, 62]], // Fmaj7
    [[50, 54, 57, 61], 38, [50, 54, 57], [61, 62, 62, 63]], // Dmaj7
    [[48, 52, 55], 36, [48, 52, 55], [60, 60, 62, 60]], // C
    [[50, 53, 57], 38, [50, 53, 57], [62, 60, 61, 60]], // Dm
  ];
  const piano = [];
  const bass = [];
  const guitar = [];
  const vocal = [];
  for (const [ch, root, arp, mel] of chords) {
    piano.push(chord(ch, BAR_SEC));
    bass.push(...bassPulse(root));
    guitar.push(...arpeggio(arp));
    vocal.push(...melodyPhrase(mel));
  }
  const stockholmDrums = fourBarDrums();
  return {
    title: "Stockholm Nights",
    genre: "Original",
    description:
      "A real song, analyzed: uploaded through the actual Demucs + librosa pipeline (109.96 BPM, C major, 0.959 confidence) — this loop uses the real first four detected chords (Fmaj7–Dmaj7–C–Dm) and a real melodic fragment extracted from the isolated vocal stem, not an invented progression.",
    layers: [
      { name: "Vocals", family: "lead", notes: vocal },
      { name: "Guitar", family: "guitar", notes: guitar, pattern: eventsToHits(guitar, EIGHTH) },
      { name: "Piano", family: "keys", notes: piano },
      { name: "Bass", family: "bass", notes: bass, pattern: eventsToHits(bass, EIGHTH) },
    ],
    drums: stockholmDrums,
    drumsPattern: drumHitsToPattern(stockholmDrums, EIGHTH),
  };
}

const DEMO_SONGS = [
  morningLoop(),
  blueCorner(),
  cornerGroove(),
  firesideLoop(),
  neonPulse(),
  fieldParade(),
  risingOverture(),
  stockholmNights(),
];

export { DEMO_SONGS, BAR_SEC };
