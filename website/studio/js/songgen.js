// Preset song starters. Original one-bar patterns in well-known genre
// feels (four-on-the-floor, boom-bap, a walking bass) — not transcriptions
// of any recording. Built-in synths and the vendored drum kits only.
import { state, changed, createTrack, addNotesClip, beat } from "./project.js";

const K = 12;
const S = 14;
const H = 6;
const O = 8;
const CL = 16;
const RIM = 17;
const CR = 9;

const RECIPES = {
  hiphop: {
    title: "Chill boom-bap",
    bpm: 92,
    kit: "808",
    bass: "subbass",
    keys: "analog",
    scale: "minor",
    drums: [
      [0, K, 118], [8, K, 100], [10, K, 90],
      [4, S, 110], [12, S, 108],
      [0, H, 70], [2, H, 55], [4, H, 68], [6, H, 50], [8, H, 72], [10, H, 54], [12, H, 68], [14, O, 60],
    ],
    bassLine: [[0, 36, 2], [6, 34, 1], [10, 36, 1.5], [14, 31, 1]],
    chords: [[0, [48, 51, 55], 6], [8, [46, 50, 53], 6]],
  },
  house: {
    title: "Sunrise house",
    bpm: 124,
    kit: "909",
    bass: "subbass",
    keys: "analog",
    drums: [
      [0, K, 120], [4, K, 120], [8, K, 120], [12, K, 120],
      [4, CL, 100], [12, CL, 100],
      [2, H, 60], [6, O, 70], [10, H, 60], [14, O, 72],
    ],
    bassLine: [[2, 36, 1], [6, 36, 1], [10, 43, 1], [14, 41, 1]],
    chords: [[0, [60, 64, 67], 2], [8, [58, 62, 65], 2]],
  },
  pop: {
    title: "Bright pop",
    bpm: 112,
    kit: "acoustic",
    bass: "subbass",
    keys: "analog",
    drums: [
      [0, K, 115], [8, K, 100], [10, K, 80],
      [4, S, 112], [12, S, 112],
      [0, H, 65], [2, H, 50], [4, H, 65], [6, H, 50], [8, H, 65], [10, H, 50], [12, H, 65], [14, H, 50],
    ],
    bassLine: [[0, 36, 2], [4, 43, 2], [8, 41, 2], [12, 38, 2]],
    chords: [[0, [60, 64, 67], 4], [4, [65, 69, 72], 4], [8, [57, 60, 64], 4], [12, [55, 59, 62], 4]],
  },
  jazz: {
    title: "Late jazz",
    bpm: 138,
    kit: "acoustic",
    bass: "subbass",
    keys: "analog",
    swing: true,
    drums: [
      [0, K, 90], [10, K, 70],
      [4, RIM, 100], [12, RIM, 96],
      [0, 10, 55], [2, 10, 40], [4, 10, 55], [6, 10, 40], [8, 10, 55], [10, 10, 40], [12, 10, 55], [14, 10, 40],
    ],
    bassLine: [[0, 36, 2], [4, 41, 2], [8, 43, 2], [12, 38, 2]],
    chords: [[2, [60, 64, 67, 71], 3], [10, [58, 62, 65, 69], 3]],
  },
  lofi: {
    title: "Dusty lo-fi",
    bpm: 84,
    kit: "lofi",
    bass: "subbass",
    keys: "analog",
    drums: [
      [0, K, 100], [9, K, 70],
      [4, S, 90], [12, S, 86],
      [2, H, 40], [6, H, 36], [10, H, 40], [14, H, 34],
    ],
    bassLine: [[0, 36, 6], [8, 34, 6]],
    chords: [[0, [60, 63, 67], 8], [8, [58, 63, 65], 8]],
  },
  funk: {
    title: "Pocket funk",
    bpm: 108,
    kit: "linn",
    bass: "subbass",
    keys: "chip",
    drums: [
      [0, K, 118], [6, K, 90], [10, K, 100],
      [4, S, 112], [12, S, 112],
      [0, H, 70], [2, H, 45], [4, H, 70], [6, H, 45], [8, H, 70], [10, H, 50], [12, H, 70], [14, H, 45],
    ],
    bassLine: [[0, 36, 1], [3, 36, 1], [7, 38, 1], [8, 43, 2], [14, 41, 1]],
    chords: [[0, [60, 64, 67], 1.5], [4, [62, 65, 69], 1.5], [8, [55, 60, 64], 1.5], [12, [57, 60, 64], 1.5]],
  },
  trap: {
    title: "Night trap",
    bpm: 140,
    kit: "trap",
    bass: "subbass",
    keys: "chip",
    drums: [
      [0, K, 120], [7, K, 90], [10, K, 100],
      [8, S, 114],
      [0, H, 50], [2, H, 35], [3, H, 40], [4, H, 55], [6, H, 34], [7, H, 38],
      [8, H, 50], [10, H, 36], [11, H, 40], [12, H, 55], [14, H, 34], [15, H, 38],
    ],
    bassLine: [[0, 31, 6], [10, 34, 4]],
    chords: [[0, [63, 67, 70], 8], [8, [61, 65, 68], 6]],
  },
  rock: {
    title: "Garage rock",
    bpm: 128,
    kit: "acoustic",
    bass: "subbass",
    keys: "analog",
    drums: [
      [0, K, 120], [3, K, 80], [8, K, 110], [11, K, 80],
      [4, S, 116], [12, S, 116],
      [0, CR, 70],
      [0, H, 60], [2, H, 48], [4, H, 60], [6, H, 48], [8, H, 60], [10, H, 48], [12, H, 60], [14, H, 48],
    ],
    bassLine: [[0, 40, 2], [4, 40, 2], [8, 45, 2], [12, 43, 2]],
    chords: [[0, [52, 59], 4], [4, [52, 59], 4], [8, [50, 57], 4], [12, [47, 54], 4]],
  },
};

function has(text, ...words) {
  return words.some((w) => text.includes(w));
}

export function recipeFor(prompt) {
  const p = (prompt || "").toLowerCase();
  let id = "pop";
  if (has(p, "trap", "drill")) id = "trap";
  else if (has(p, "lofi", "lo-fi", "lo fi", "chillhop")) id = "lofi";
  else if (has(p, "house", "techno", "edm", "dance")) id = "house";
  else if (has(p, "jazz", "swing", "blues")) id = "jazz";
  else if (has(p, "funk")) id = "funk";
  else if (has(p, "rock", "punk", "guitar")) id = "rock";
  else if (has(p, "hip", "rap", "boom", "beat")) id = "hiphop";
  else if (has(p, "chill", "calm", "soft", "sad", "rain")) id = "lofi";
  else if (has(p, "dark", "night", "moody")) id = "trap";
  else if (has(p, "happy", "bright", "summer", "pop", "fun")) id = "pop";
  const recipe = { ...RECIPES[id], id };
  let bpm = recipe.bpm;
  if (has(p, "chill", "calm", "soft", "slow")) bpm -= 8;
  if (has(p, "fast", "energetic", "hype", "party")) bpm += 10;
  if (has(p, "dark", "sad")) bpm -= 4;
  recipe.bpm = Math.max(60, Math.min(180, bpm));
  recipe.title = prompt && prompt.trim() ? titleFrom(prompt, recipe.title) : recipe.title;
  return recipe;
}

function titleFrom(prompt, fallback) {
  const clean = prompt.trim().replace(/\s+/g, " ");
  if (clean.length > 42) return fallback;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function place(recipe) {
  state.bpm = recipe.bpm;
  const step = beat() / 4;
  const at = (s) => {
    // Delay the "and" of each beat a little so jazz feels swung.
    const nudged = recipe.swing && s % 4 === 2 ? s + 0.6 : s;
    return nudged * step;
  };
  const drums = createTrack("drums", { kitId: recipe.kit, name: `${recipe.title} drums` });
  const drumNotes = recipe.drums.map(([s, pad, v]) => ({ t: at(s), n: pad, v, d: 0.08 }));
  const dClip = addNotesClip(drums, drumNotes, 0, step * 16, "Beat");
  dClip.loop = true;
  dClip.length = dClip.cycle * 4;

  const bass = createTrack("keys", { instrumentId: recipe.bass, name: `${recipe.title} bass` });
  const bassNotes = recipe.bassLine.map(([s, n, beats]) => ({ t: at(s), n, v: 100, d: beats * beat() * 0.9 }));
  const bClip = addNotesClip(bass, bassNotes, 0, step * 16, "Bass");
  bClip.loop = true;
  bClip.length = bClip.cycle * 4;

  const keys = createTrack("keys", { instrumentId: recipe.keys, name: `${recipe.title} chords` });
  const keyNotes = [];
  recipe.chords.forEach(([s, notes, beats]) => {
    notes.forEach((n) => keyNotes.push({ t: at(s), n, v: 78, d: beats * beat() * 0.92 }));
  });
  const kClip = addNotesClip(keys, keyNotes, 0, step * 16, "Chords");
  kClip.loop = true;
  kClip.length = kClip.cycle * 4;

  state.loop = true;
  state.loopFromBar = 0;
  state.loopBars = 4;
  changed("all");
  return { title: recipe.title, bpm: recipe.bpm, drumId: drums.id, clipId: dClip.id };
}

export function buildSong(prompt) {
  return place(recipeFor(prompt));
}
