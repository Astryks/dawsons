// Drum kits for the 18-pad grid. Every pad slot has the same *role* in
// every kit (row 1 = toms/percussion, row 2 = hats/cymbals, row 3 =
// kicks/snares/claps) so finger patterns carry over when you switch kits.
//
// Sample-based kits use the vendored, Public Domain / CC0 one-shots in
// ../samples (see ../SOUND_LIBRARY.md). "909 House" and the 808 basses in
// "Trap" are synthesised in the browser from scratch (original DSP, no
// samples), then rendered once to AudioBuffers so every kit plays — and
// exports — the same way.

import { getCtx, loadSample } from "./audio.js";

export const PAD_ROLES = [
  "Hi Tom", "Mid Tom", "Low Tom", "Cowbell", "Perc 1", "Perc 2",
  "Closed Hat", "Pedal Hat", "Open Hat", "Crash", "Ride", "Splash",
  "Kick", "Kick 2", "Snare", "Snare 2", "Clap", "Rim",
];

// Computer keys, laid out like the pads (number row = top row).
export const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "q", "w", "e", "r", "t", "y", "a", "s", "d", "f", "g", "h"];

// General MIDI drum notes -> pad index (for Web MIDI pad controllers).
export const GM_TO_PAD = {
  50: 0, 48: 1, 47: 1, 45: 2, 43: 2, 41: 2, 56: 3, 54: 4, 70: 4, 75: 4, 69: 4, 63: 5, 62: 5, 64: 5,
  42: 6, 44: 7, 46: 8, 49: 9, 57: 9, 51: 10, 59: 10, 53: 10, 55: 11, 52: 11,
  36: 12, 35: 13, 38: 14, 40: 15, 39: 16, 37: 17,
};
export const PAD_TO_GM = [50, 47, 45, 56, 54, 63, 42, 44, 46, 49, 51, 55, 36, 35, 38, 40, 39, 37];

// Open hat is choked by the closed and pedal hats, like a real hi-hat.
const CHOKE_BY = { 6: [8], 7: [8] };

const s = (src, extra = {}) => ({ src, ...extra });
const syn = (fn, extra = {}) => ({ synth: fn, ...extra });

export const KITS = [
  {
    id: "acoustic",
    name: "Acoustic Studio",
    pads: [
      s("sonicpi/drum_tom_hi_hard", { name: "Hi Tom" }), s("sonicpi/drum_tom_mid_hard", { name: "Mid Tom" }),
      s("sonicpi/drum_tom_lo_hard", { name: "Floor Tom" }), s("sonicpi/drum_cowbell", { name: "Cowbell", gain: 0.7 }),
      s("lm2/tambourine", { name: "Tambourine", gain: 0.7 }), s("sonicpi/drum_roll", { name: "Snare Roll", gain: 0.8 }),
      s("sonicpi/drum_cymbal_closed", { name: "Closed Hat" }), s("sonicpi/drum_cymbal_pedal", { name: "Pedal Hat" }),
      s("sonicpi/drum_cymbal_open", { name: "Open Hat" }), s("sonicpi/drum_cymbal_hard", { name: "Crash" }),
      s("sonicpi/drum_cymbal_soft", { name: "Ride" }), s("sonicpi/drum_splash_hard", { name: "Splash" }),
      s("sonicpi/drum_heavy_kick", { name: "Kick" }), s("sonicpi/drum_bass_hard", { name: "Kick 2" }),
      s("sonicpi/drum_snare_hard", { name: "Snare" }), s("sonicpi/drum_snare_soft", { name: "Snare Soft" }),
      s("lm2/clap", { name: "Clap" }), s("lm2/stick-m", { name: "Rim / Stick" }),
    ],
  },
  {
    id: "808",
    name: "TR-808",
    pads: [
      s("tr808/ht50", { name: "Hi Tom" }), s("tr808/mt50", { name: "Mid Tom" }), s("tr808/lt50", { name: "Low Tom" }),
      s("tr808/cb", { name: "Cowbell", gain: 0.7 }), s("tr808/cl", { name: "Clave" }), s("tr808/hc50", { name: "Conga" }),
      s("tr808/ch", { name: "Closed Hat" }), s("tr808/ma", { name: "Maracas" }), s("tr808/oh25", { name: "Open Hat" }),
      s("tr808/cy5050", { name: "Cymbal", gain: 0.7 }), s("tr808/cy1010", { name: "Short Cym", gain: 0.7 }),
      s("tr808/oh75", { name: "Long Hat" }),
      s("tr808/bd2575", { name: "Kick" }), s("tr808/bd5010", { name: "Kick Tight" }), s("tr808/sd5050", { name: "Snare" }),
      s("tr808/sd2575", { name: "Snare 2" }), s("tr808/cp", { name: "Clap" }), s("tr808/rs", { name: "Rimshot" }),
    ],
  },
  {
    id: "909",
    name: "909 House (synth)",
    pads: [
      syn((c, o) => tom(c, o, 260), { name: "Hi Tom" }), syn((c, o) => tom(c, o, 190), { name: "Mid Tom" }),
      syn((c, o) => tom(c, o, 130), { name: "Low Tom" }), syn(cowbell, { name: "Cowbell" }),
      syn(shaker, { name: "Shaker" }), syn((c, o) => conga(c, o, 320), { name: "Conga" }),
      syn((c, o) => hat(c, o, 0.05), { name: "Closed Hat" }), syn((c, o) => hat(c, o, 0.11), { name: "Pedal Hat" }),
      syn((c, o) => hat(c, o, 0.42), { name: "Open Hat" }), syn(crash, { name: "Crash" }), syn(ride, { name: "Ride" }),
      syn((c, o) => hat(c, o, 0.8, 0.5), { name: "Sizzle" }),
      syn(kick909, { name: "Kick" }), syn((c, o) => kick909(c, o, 0.35, 70), { name: "Kick Short" }),
      syn(snare909, { name: "Snare" }), syn((c, o) => snare909(c, o, 0.16, 240), { name: "Snare Tight" }),
      syn(clap, { name: "Clap" }), syn(rim, { name: "Rim" }),
    ],
  },
  {
    id: "trap",
    name: "Trap (808 + sub bass)",
    pads: [
      syn((c, o) => sub808(c, o, 36, 1.4), { name: "808 C" }), syn((c, o) => sub808(c, o, 39, 1.4), { name: "808 D#" }),
      syn((c, o) => sub808(c, o, 41, 1.4), { name: "808 F" }), syn((c, o) => sub808(c, o, 43, 1.4), { name: "808 G" }),
      syn((c, o) => sub808(c, o, 46, 1.4), { name: "808 A#" }), syn((c, o) => sub808(c, o, 48, 1.4), { name: "808 C+" }),
      s("tr808/ch", { name: "Hat" }), s("tr808/ch", { name: "Hat Roll", tune: 3, gain: 0.55 }),
      s("tr808/oh25", { name: "Open Hat" }), s("tr808/cy5050", { name: "Crash", gain: 0.6 }),
      s("sonicpi/perc_snap", { name: "Snap" }), s("sonicpi/vinyl_backspin", { name: "Backspin", gain: 0.6 }),
      s("tr808/bd5010", { name: "Kick" }), syn((c, o) => sub808(c, o, 31, 2.2), { name: "808 Long" }),
      s("tr808/sd7575", { name: "Snare" }), s("tr808/sd5050", { name: "Snare 2", tune: 2 }),
      s("tr808/cp", { name: "Clap" }), s("tr808/rs", { name: "Rim" }),
    ],
  },
  {
    id: "lofi",
    name: "Lo-fi Dusty",
    fx: "lofi",
    pads: [
      s("sonicpi/drum_tom_hi_hard", { name: "Hi Tom", tune: -2 }), s("sonicpi/drum_tom_mid_hard", { name: "Mid Tom", tune: -2 }),
      s("sonicpi/drum_tom_lo_hard", { name: "Low Tom", tune: -2 }), s("lm2/cowbell", { name: "Cowbell", gain: 0.6 }),
      s("lm2/cabasa", { name: "Shaker" }), s("sonicpi/vinyl_scratch", { name: "Scratch", gain: 0.6 }),
      s("sonicpi/drum_cymbal_closed", { name: "Closed Hat", gain: 0.8 }), s("lm2/hhclosed-short", { name: "Tick Hat" }),
      s("sonicpi/drum_cymbal_open", { name: "Open Hat", gain: 0.8 }), s("sonicpi/drum_cymbal_soft", { name: "Ride" }),
      s("sonicpi/vinyl_hiss", { name: "Vinyl", gain: 0.8 }), s("lm2/ride", { name: "Bell" }),
      s("sonicpi/drum_heavy_kick", { name: "Kick", tune: -1 }), s("lm2/kick", { name: "Kick 2" }),
      s("sonicpi/drum_snare_soft", { name: "Snare", tune: -2 }), s("lm2/snare-m", { name: "Snare 2", tune: -3 }),
      s("lm2/clap", { name: "Clap", tune: -2 }), s("lm2/stick-m", { name: "Rim", tune: -2 }),
    ],
  },
  {
    id: "linn",
    name: "LinnDrum 80s (LM-2)",
    pads: [
      s("lm2/tom-h", { name: "Hi Tom" }), s("lm2/tom-m", { name: "Mid Tom" }), s("lm2/tom-l", { name: "Low Tom" }),
      s("lm2/cowbell", { name: "Cowbell", gain: 0.7 }), s("lm2/tambourine", { name: "Tambourine" }),
      s("lm2/conga-h", { name: "Conga" }),
      s("lm2/hhclosed", { name: "Closed Hat" }), s("lm2/hhclosed-short", { name: "Pedal Hat" }),
      s("lm2/hhopen", { name: "Open Hat" }), s("lm2/crash", { name: "Crash" }), s("lm2/ride", { name: "Ride" }),
      s("lm2/cabasa", { name: "Cabasa" }),
      s("lm2/kick", { name: "Kick" }), s("lm2/kick-alt", { name: "Kick 2" }), s("lm2/snare-m", { name: "Snare" }),
      s("lm2/snare-h", { name: "Snare Hi" }), s("lm2/clap", { name: "Clap" }), s("lm2/stick-m", { name: "Sidestick" }),
    ],
  },
  {
    id: "tabla",
    name: "Tabla (world)",
    pads: [
      "tabla_tun1", "tabla_tun3", "tabla_tas1", "tabla_tas3", "tabla_te_m", "tabla_te_ne",
      "tabla_na", "tabla_na_o", "tabla_na_s", "tabla_te1", "tabla_te2", "tabla_re",
      "tabla_ghe1", "tabla_ghe4", "tabla_ghe8", "tabla_dhec", "tabla_ke1", "tabla_ke2",
    ].map((n) => s(`sonicpi/${n}`, { name: n.replace("tabla_", "").replace("_", " ") })),
  },
];

export function kitById(id) {
  return KITS.find((k) => k.id === id) || KITS[0];
}

// ---------------------------------------------------------------- loading

const kitBuffers = new Map(); // kitId -> Promise<AudioBuffer[]>

export function loadKit(kitId) {
  if (!kitBuffers.has(kitId)) {
    const kit = kitById(kitId);
    const p = Promise.all(
      kit.pads.map(async (pad) => {
        let buf = pad.synth ? await renderSynth(pad.synth) : await loadSample(pad.src);
        if (kit.fx === "lofi") buf = await lofi(buf);
        return buf;
      })
    );
    p.catch(() => kitBuffers.delete(kitId));
    kitBuffers.set(kitId, p);
  }
  return kitBuffers.get(kitId);
}

// Returns already-loaded buffers synchronously (or null) for low-latency play.
const loadedNow = new Map();
export async function ensureKit(kitId) {
  const bufs = await loadKit(kitId);
  loadedNow.set(kitId, bufs);
  return bufs;
}
export function kitReady(kitId) {
  return loadedNow.get(kitId) || null;
}

// ------------------------------------------------------------------ play

const openHats = new WeakMap(); // dest -> {src, gain}

export function playPad(c, kitId, index, time, velocity = 0.9, dest, buffers) {
  const bufs = buffers || kitReady(kitId);
  if (!bufs || !bufs[index]) return null;
  const pad = kitById(kitId).pads[index];
  const src = c.createBufferSource();
  src.buffer = bufs[index];
  if (pad.tune) src.playbackRate.value = Math.pow(2, pad.tune / 12);
  const g = c.createGain();
  const v = Math.max(0.05, Math.min(1, velocity));
  g.gain.value = (pad.gain ?? 1) * v * v * 1.1;
  src.connect(g).connect(dest);
  const t = Math.max(time, c.currentTime);
  // Hi-hat choke
  if (CHOKE_BY[index]) {
    const held = openHats.get(dest);
    if (held) {
      try {
        held.gain.gain.setTargetAtTime(0, t, 0.01);
        held.src.stop(t + 0.1);
      } catch { /* already stopped */ }
      openHats.delete(dest);
    }
  }
  if (index === 8) openHats.set(dest, { src, gain: g });
  src.start(t);
  return src;
}

// ------------------------------------------------------- synthesis (DSP)

const SR = 44100;

async function renderSynth(fn) {
  const len = Math.ceil(SR * 2.6);
  const off = new OfflineAudioContext(1, len, SR);
  const out = off.createGain();
  out.connect(off.destination);
  const dur = fn(off, out) || 1;
  const rendered = await off.startRendering();
  return trim(rendered, Math.min(2.6, dur + 0.05));
}

function trim(buf, seconds) {
  const n = Math.min(buf.length, Math.ceil(seconds * buf.sampleRate));
  const c = getCtx();
  const out = c.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch).subarray(0, n);
    const o = out.getChannelData(ch);
    o.set(d);
    const fade = Math.min(256, n);
    for (let i = 0; i < fade; i++) o[n - 1 - i] *= i / fade;
  }
  return out;
}

let noiseBuf = null;
function noise(c) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
  }
  const n = c.createBufferSource();
  n.buffer = noiseBuf;
  return n;
}

function env(c, peak, attack, decay, t = 0) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function softClip(c, amount = 2) {
  const ws = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  return ws;
}

function kick909(c, out, decay = 0.55, low = 48) {
  const o = c.createOscillator();
  o.frequency.setValueAtTime(190, 0);
  o.frequency.exponentialRampToValueAtTime(low, 0.09);
  const g = env(c, 1, 0.001, decay);
  const sh = softClip(c, 2.5);
  o.connect(g).connect(sh).connect(out);
  o.start(0);
  o.stop(decay + 0.1);
  const n = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1500;
  const ng = env(c, 0.35, 0.0005, 0.012);
  n.connect(hp).connect(ng).connect(out);
  n.start(0);
  n.stop(0.05);
  return decay + 0.1;
}

function snare909(c, out, decay = 0.26, tone = 190) {
  [tone, tone * 1.75].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f * 1.3, 0);
    o.frequency.exponentialRampToValueAtTime(f, 0.03);
    const g = env(c, i ? 0.25 : 0.45, 0.001, 0.12);
    o.connect(g).connect(out);
    o.start(0);
    o.stop(0.3);
  });
  const n = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  const g = env(c, 0.6, 0.001, decay);
  n.connect(hp).connect(g).connect(out);
  n.start(0);
  n.stop(decay + 0.1);
  return decay + 0.1;
}

function clap(c, out) {
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1150;
  bp.Q.value = 1.2;
  bp.connect(out);
  [0, 0.011, 0.022].forEach((t) => {
    const n = noise(c);
    const g = env(c, 0.9, 0.0008, 0.012, t);
    n.connect(g).connect(bp);
    n.start(t);
    n.stop(t + 0.05);
  });
  const n = noise(c);
  const g = env(c, 0.8, 0.001, 0.22, 0.03);
  n.connect(g).connect(bp);
  n.start(0.03);
  n.stop(0.4);
  return 0.35;
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(c, out, decay, hpFreq = 7000, peak = 0.5, t = 0) {
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = hpFreq;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 10000;
  bp.Q.value = 0.8;
  const g = env(c, peak, 0.001, decay, t);
  bp.connect(hp).connect(g).connect(out);
  METAL.forEach((f) => {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f * 1.6;
    const og = c.createGain();
    og.gain.value = 0.18;
    o.connect(og).connect(bp);
    o.start(t);
    o.stop(t + decay + 0.1);
  });
}

function hat(c, out, decay, peak = 0.55) {
  metal(c, out, decay, 7000, peak);
  const n = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 8000;
  const g = env(c, peak * 0.5, 0.001, decay * 0.8);
  n.connect(hp).connect(g).connect(out);
  n.start(0);
  n.stop(decay + 0.1);
  return decay + 0.1;
}

function crash(c, out) {
  metal(c, out, 1.6, 4500, 0.35);
  const n = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5000;
  const g = env(c, 0.4, 0.002, 1.8);
  n.connect(hp).connect(g).connect(out);
  n.start(0);
  n.stop(2);
  return 2;
}

function ride(c, out) {
  metal(c, out, 1.2, 6000, 0.3);
  const o = c.createOscillator();
  o.frequency.value = 3200;
  const g = env(c, 0.06, 0.001, 0.8);
  o.connect(g).connect(out);
  o.start(0);
  o.stop(1);
  return 1.3;
}

function tom(c, out, f) {
  const o = c.createOscillator();
  o.frequency.setValueAtTime(f * 1.6, 0);
  o.frequency.exponentialRampToValueAtTime(f, 0.05);
  const g = env(c, 0.9, 0.001, 0.45);
  o.connect(g).connect(softClip(c, 1.5)).connect(out);
  o.start(0);
  o.stop(0.6);
  const n = noise(c);
  const lp = c.createBiquadFilter();
  lp.frequency.value = 3000;
  const ng = env(c, 0.15, 0.001, 0.04);
  n.connect(lp).connect(ng).connect(out);
  n.start(0);
  n.stop(0.1);
  return 0.6;
}

function conga(c, out, f) {
  const o = c.createOscillator();
  o.frequency.setValueAtTime(f * 1.2, 0);
  o.frequency.exponentialRampToValueAtTime(f, 0.02);
  const g = env(c, 0.8, 0.001, 0.22);
  o.connect(g).connect(out);
  o.start(0);
  o.stop(0.3);
  return 0.3;
}

function cowbell(c, out) {
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 800;
  bp.Q.value = 2;
  const g = env(c, 0.6, 0.001, 0.35);
  bp.connect(g).connect(out);
  [540, 800].forEach((f) => {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    o.connect(bp);
    o.start(0);
    o.stop(0.4);
  });
  return 0.4;
}

function shaker(c, out) {
  const n = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.linearRampToValueAtTime(0.4, 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, 0.12);
  n.connect(hp).connect(g).connect(out);
  n.start(0);
  n.stop(0.15);
  return 0.15;
}

function rim(c, out) {
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.value = 1700;
  const g = env(c, 0.6, 0.0005, 0.03);
  o.connect(g).connect(out);
  o.start(0);
  o.stop(0.06);
  const o2 = c.createOscillator();
  o2.frequency.value = 480;
  const g2 = env(c, 0.4, 0.0005, 0.04);
  o2.connect(g2).connect(out);
  o2.start(0);
  o2.stop(0.06);
  return 0.08;
}

// Tuned 808-style sub bass: sine with a fast pitch drop, long decay and
// soft saturation for harmonics that survive small speakers.
function sub808(c, out, midi, decay) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const o = c.createOscillator();
  o.frequency.setValueAtTime(f * 2.2, 0);
  o.frequency.exponentialRampToValueAtTime(f, 0.045);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(0.9, 0.003);
  g.gain.setTargetAtTime(0.0001, 0.12, decay / 4);
  o.connect(g).connect(softClip(c, 3)).connect(out);
  o.start(0);
  o.stop(decay + 0.2);
  return decay + 0.2;
}

// Lo-fi: sample-rate reduction + 10-bit crush + warm low-pass + soft clip.
async function lofi(buf) {
  const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const crushed = off.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  const hold = 3;
  const steps = 512;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    const o = crushed.getChannelData(ch);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % hold === 0) v = Math.round(d[i] * steps) / steps;
      o[i] = v;
    }
  }
  const src = off.createBufferSource();
  src.buffer = crushed;
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3800;
  lp.Q.value = 0.5;
  const g = off.createGain();
  g.gain.value = 0.9;
  src.connect(lp).connect(softClip(off, 1.6)).connect(g).connect(off.destination);
  src.start(0);
  return off.startRendering();
}
