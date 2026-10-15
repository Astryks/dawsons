// Per-track effects + master bus. All original Web Audio code.
// Reverb is convolution with impulse responses we *generate* (decaying
// stereo noise with a tone filter), so there are no third-party IR files.
//
// A track's fx settings are plain JSON (saved/undone with the project):
//   { eq:{on,low,mid,high}, filter:{on,type,freq,q}, comp:{on,threshold,ratio,attack,release,makeup},
//     dist:{on,drive,mix}, chorus:{on,rate,depth,mix}, delay:{on,time,feedback,mix},
//     reverb:{on,size,tone,mix} }
// The same builder runs on the live AudioContext and on the
// OfflineAudioContext used for WAV export, so the export sounds the same.

export const FX_ORDER = ["eq", "filter", "dist", "comp", "chorus", "delay", "reverb"];

export const FX_DEFS = {
  eq: {
    name: "EQ",
    params: { low: [-15, 15, 0, "dB"], mid: [-15, 15, 0, "dB"], high: [-15, 15, 0, "dB"] },
    presets: { Flat: { low: 0, mid: 0, high: 0 }, "Bass boost": { low: 7, mid: 0, high: 0 }, Bright: { low: -2, mid: 0, high: 6 }, "Warm": { low: 3, mid: -2, high: -4 }, Scoop: { low: 4, mid: -6, high: 4 } },
  },
  filter: {
    name: "Filter",
    params: { freq: [40, 18000, 1200, "Hz"], q: [0.1, 18, 1, ""] },
    types: ["lowpass", "highpass", "bandpass"],
    presets: { "Muffled": { type: "lowpass", freq: 700, q: 1 }, "Thin": { type: "highpass", freq: 900, q: 0.8 }, "Telephone": { type: "bandpass", freq: 1500, q: 1.4 }, "Wah peak": { type: "bandpass", freq: 900, q: 8 } },
  },
  dist: {
    name: "Distortion",
    params: { drive: [0, 1, 0.4, ""], mix: [0, 1, 0.6, ""] },
    presets: { "Warm tape": { drive: 0.2, mix: 0.5 }, "Crunch": { drive: 0.5, mix: 0.8 }, "Fuzz": { drive: 0.95, mix: 1 } },
  },
  comp: {
    name: "Compressor",
    params: { threshold: [-60, 0, -20, "dB"], ratio: [1, 20, 4, ":1"], attack: [0.001, 0.2, 0.01, "s"], release: [0.02, 1, 0.2, "s"], makeup: [0, 24, 4, "dB"] },
    presets: { Gentle: { threshold: -18, ratio: 2, attack: 0.02, release: 0.25, makeup: 3 }, "Punchy drums": { threshold: -24, ratio: 5, attack: 0.02, release: 0.12, makeup: 6 }, "Vocal level": { threshold: -26, ratio: 4, attack: 0.005, release: 0.2, makeup: 7 }, Squash: { threshold: -40, ratio: 20, attack: 0.001, release: 0.08, makeup: 14 } },
  },
  chorus: {
    name: "Chorus",
    params: { rate: [0.05, 5, 0.8, "Hz"], depth: [0, 1, 0.5, ""], mix: [0, 1, 0.5, ""] },
    presets: { Subtle: { rate: 0.5, depth: 0.3, mix: 0.35 }, Lush: { rate: 0.9, depth: 0.7, mix: 0.55 }, Wobble: { rate: 4, depth: 0.8, mix: 0.6 } },
  },
  delay: {
    name: "Delay",
    params: { time: [0.02, 1.5, 0.375, "s"], feedback: [0, 0.9, 0.35, ""], mix: [0, 1, 0.3, ""] },
    presets: { Slapback: { time: 0.11, feedback: 0.1, mix: 0.3 }, "1/8 echo": { time: "1/8", feedback: 0.35, mix: 0.3 }, "1/4 echo": { time: "1/4", feedback: 0.45, mix: 0.3 }, "Dub": { time: "3/8", feedback: 0.7, mix: 0.4 } },
  },
  reverb: {
    name: "Reverb",
    params: { size: [0.2, 8, 1.8, "s"], tone: [0, 1, 0.6, ""], mix: [0, 1, 0.3, ""] },
    presets: { "Small room": { size: 0.6, tone: 0.55, mix: 0.25 }, "Plate": { size: 1.6, tone: 0.85, mix: 0.3 }, "Big hall": { size: 3.8, tone: 0.6, mix: 0.35 }, "Cathedral": { size: 7, tone: 0.5, mix: 0.45 } },
  },
};

// One-click chain presets ("Small room", "Big hall", "Telephone"...)
export const CHAIN_PRESETS = {
  "Dry (no effects)": {},
  "Small room": { reverb: "Small room" },
  "Big hall": { reverb: "Big hall" },
  Telephone: { filter: "Telephone", dist: "Warm tape", comp: "Squash" },
  "Radio": { eq: "Bright", filter: "Thin", comp: "Vocal level" },
  "Lo-fi": { filter: "Muffled", dist: "Warm tape", chorus: "Wobble" },
  "Vocal polish": { eq: "Bright", comp: "Vocal level", reverb: "Plate" },
  "Punchy drums": { eq: "Scoop", comp: "Punchy drums", reverb: "Small room" },
  "Dreamy": { chorus: "Lush", delay: "1/4 echo", reverb: "Cathedral" },
  "Dub echo": { filter: "Thin", delay: "Dub", reverb: "Plate" },
};

export function defaultFx() {
  const fx = {};
  for (const [k, def] of Object.entries(FX_DEFS)) {
    fx[k] = { on: false };
    for (const [p, [, , dflt]] of Object.entries(def.params)) fx[k][p] = dflt;
  }
  fx.filter.type = "lowpass";
  return fx;
}

export function applyPreset(fx, effect, presetName, bpm) {
  const p = FX_DEFS[effect].presets[presetName];
  if (!p) return;
  Object.assign(fx[effect], p, { on: true });
  if (typeof fx[effect].time === "string") fx[effect].time = noteTime(fx[effect].time, bpm);
  fx[effect].preset = presetName;
}

export function applyChainPreset(fx, name, bpm) {
  const chain = CHAIN_PRESETS[name];
  if (!chain) return;
  const fresh = defaultFx();
  for (const k of FX_ORDER) fx[k] = fresh[k];
  for (const [effect, preset] of Object.entries(chain)) applyPreset(fx, effect, preset, bpm);
}

function noteTime(s, bpm) {
  const [a, b] = s.split("/").map(Number);
  return +(((60 / bpm) * 4 * a) / b).toFixed(3);
}

// ------------------------------------------------------- impulse responses

const irCache = new Map(); // key -> AudioBuffer (per context sample rate)
export function impulse(c, size, tone) {
  const key = `${c.sampleRate}|${size.toFixed(2)}|${tone.toFixed(2)}`;
  // AudioBuffers can be shared between contexts with the same sample rate.
  if (irCache.has(key)) return irCache.get(key);
  const sr = c.sampleRate;
  const len = Math.max(1, Math.floor(sr * Math.min(10, size)));
  const buf = c.createBuffer(2, len, sr);
  // simple seeded PRNG so live + export get the identical IR
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const pre = Math.floor(sr * 0.008);
  const cutoff = 1500 + tone * 14000;
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(1 - (i - pre) / (len - pre), 2) * Math.exp((-3 * t) / size);
      // darker tail as it decays
      const aa = a + (1 - a) * Math.min(0.9, t / size) * (1 - tone) * 0.6;
      lp = aa * lp + (1 - aa) * rnd();
      d[i] = lp * env;
    }
    // a few early reflections
    for (let r = 0; r < 6; r++) {
      const at = pre + Math.floor(sr * (0.004 + 0.011 * r + 0.003 * ch) * Math.min(2, size));
      if (at < len) d[at] += (0.5 / (r + 1)) * (r % 2 ? -1 : 1);
    }
  }
  // normalise energy so different sizes are similar loudness
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) e += v * v;
  const k = 1 / Math.sqrt(e / 2 + 1e-9) * 0.9;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
  irCache.set(key, buf);
  return buf;
}

function distCurve(drive) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

const dB = (v) => Math.pow(10, v / 20);

// Wet/dry wrapper: input -> dry -> out, input -> fx -> wet -> out
function wetDry(c, mix, buildWet) {
  const input = c.createGain();
  const out = c.createGain();
  const dry = c.createGain();
  const wet = c.createGain();
  dry.gain.value = 1 - mix * (mix > 0.5 ? 1 : 0.5);
  wet.gain.value = mix;
  input.connect(dry).connect(out);
  const wetIn = buildWet(input);
  wetIn.connect(wet).connect(out);
  return { input, output: out };
}

function buildEffect(c, kind, p, extras) {
  switch (kind) {
    case "eq": {
      const lo = c.createBiquadFilter();
      lo.type = "lowshelf"; lo.frequency.value = 200; lo.gain.value = p.low;
      const mid = c.createBiquadFilter();
      mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8; mid.gain.value = p.mid;
      const hi = c.createBiquadFilter();
      hi.type = "highshelf"; hi.frequency.value = 5000; hi.gain.value = p.high;
      lo.connect(mid).connect(hi);
      return { input: lo, output: hi };
    }
    case "filter": {
      const f = c.createBiquadFilter();
      f.type = p.type || "lowpass";
      f.frequency.value = p.freq;
      f.Q.value = p.q;
      return { input: f, output: f };
    }
    case "dist":
      return wetDry(c, p.mix, (inp) => {
        const pre = c.createGain();
        pre.gain.value = 1 + p.drive * 2;
        const ws = c.createWaveShaper();
        ws.curve = distCurve(p.drive);
        ws.oversample = "2x";
        const post = c.createGain();
        post.gain.value = 0.7 / (1 + p.drive);
        inp.connect(pre).connect(ws).connect(post);
        return post;
      });
    case "comp": {
      const k = c.createDynamicsCompressor();
      k.threshold.value = p.threshold;
      k.ratio.value = p.ratio;
      k.attack.value = p.attack;
      k.release.value = p.release;
      k.knee.value = 6;
      const g = c.createGain();
      g.gain.value = dB(p.makeup);
      k.connect(g);
      return { input: k, output: g };
    }
    case "chorus":
      return wetDry(c, p.mix, (inp) => {
        const out = c.createGain();
        [0, 1].forEach((i) => {
          const d = c.createDelay(0.1);
          d.delayTime.value = 0.018 + i * 0.007;
          const lfo = c.createOscillator();
          lfo.frequency.value = p.rate * (i ? 1.13 : 1);
          const lg = c.createGain();
          lg.gain.value = 0.002 + p.depth * 0.006;
          lfo.connect(lg).connect(d.delayTime);
          lfo.start(0);
          extras.push(lfo);
          const pan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
          if (pan.pan) pan.pan.value = i ? 0.6 : -0.6;
          inp.connect(d).connect(pan).connect(out);
        });
        return out;
      });
    case "delay":
      return wetDry(c, p.mix, (inp) => {
        const d = c.createDelay(2);
        d.delayTime.value = Math.min(1.99, p.time);
        const fb = c.createGain();
        fb.gain.value = Math.min(0.92, p.feedback);
        const tone = c.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 5000;
        inp.connect(d).connect(tone).connect(fb).connect(d);
        return tone;
      });
    case "reverb":
      return wetDry(c, p.mix, (inp) => {
        const conv = c.createConvolver();
        conv.buffer = impulse(c, p.size, p.tone);
        inp.connect(conv);
        return conv;
      });
    default:
      return null;
  }
}

// Builds the enabled effects between `input` and `output`. Returns a
// handle with dispose(). Safe to call repeatedly (rebuild on change).
export function buildChain(c, fx, input, output) {
  const extras = [];
  const nodes = [];
  let last = input;
  for (const k of FX_ORDER) {
    const p = fx?.[k];
    if (!p || !p.on) continue;
    const e = buildEffect(c, k, p, extras);
    if (!e) continue;
    last.connect(e.input);
    nodes.push(e);
    last = e.output;
  }
  last.connect(output);
  return {
    dispose() {
      try { input.disconnect(); } catch { /* */ }
      nodes.forEach((e) => { try { e.output.disconnect(); } catch { /* */ } });
      extras.forEach((o) => { try { o.stop(); } catch { /* */ } });
    },
  };
}

export function fxSummary(fx) {
  return FX_ORDER.filter((k) => fx?.[k]?.on).map((k) => FX_DEFS[k].name);
}

// --------------------------------------------------------------- master

export function defaultMaster() {
  return { reverb: { on: false, size: 2.4, tone: 0.6, mix: 0.18 }, limiter: { on: true, ceiling: -1 }, volume: 0.9 };
}

// master input -> [reverb] -> [limiter] -> dest. Returns {input, dispose}
export function buildMaster(c, m, dest) {
  const input = c.createGain();
  input.gain.value = m.volume ?? 0.9;
  const fx = { reverb: { ...m.reverb } };
  const mid = c.createGain();
  const chain = buildChain(c, fx, input, mid);
  let tail = mid;
  let lim = null;
  if (m.limiter?.on) {
    lim = c.createDynamicsCompressor();
    lim.threshold.value = m.limiter.ceiling - 2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.1;
    mid.connect(lim);
    tail = lim;
  }
  tail.connect(dest);
  return {
    input,
    dispose() {
      chain.dispose();
      try { mid.disconnect(); } catch { /* */ }
      try { lim?.disconnect(); } catch { /* */ }
    },
  };
}
