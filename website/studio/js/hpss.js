// In-browser harmonic/percussive separation (HPSS) plus a simple
// frequency split. This is not Demucs — it cannot isolate a singer —
// but it does pull drums, bass, and the rest of a mix apart with no
// model download and no server. Original DSP, no third-party code.

export function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const vRe = re[b] * wRe - im[b] * wIm;
        const vIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function median9(buf) {
  const a = Array.from(buf).sort((x, y) => x - y);
  return a[4];
}

/**
 * Split a mono Float32Array into drums / bass / melody / other.
 * Caps work to the buffer you pass in — the caller should trim length.
 */
export function splitStems(mono, sampleRate) {
  const n = 1024;
  const hop = 256;
  const win = hann(n);
  if (mono.length < n) {
    const z = new Float32Array(mono.length);
    return { drums: mono.slice(), bass: z, melody: z.slice(), other: z.slice() };
  }
  const reF = [];
  const imF = [];
  const mags = [];
  const bins = n >> 1;
  for (let start = 0; start + n <= mono.length; start += hop) {
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = mono[start + i] * win[i];
    fft(re, im, false);
    const mag = new Float32Array(bins);
    for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);
    reF.push(re);
    imF.push(im);
    mags.push(mag);
  }
  const frames = mags.length;
  const harm = mags.map(() => new Float32Array(bins));
  const perc = mags.map(() => new Float32Array(bins));
  const timeWin = new Float32Array(9);
  const freqWin = new Float32Array(9);
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < bins; k++) {
      for (let j = -4; j <= 4; j++) {
        const tt = Math.max(0, Math.min(frames - 1, t + j));
        timeWin[j + 4] = mags[tt][k];
      }
      harm[t][k] = median9(timeWin);
      for (let j = -4; j <= 4; j++) {
        const kk = Math.max(0, Math.min(bins - 1, k + j));
        freqWin[j + 4] = mags[t][kk];
      }
      perc[t][k] = median9(freqWin);
    }
  }
  const bassK = Math.max(2, Math.round((180 * n) / sampleRate));
  const melK = Math.round((5000 * n) / sampleRate);
  const maskOf = (kind) => (t, k) => {
    const h = harm[t][k];
    const p = perc[t][k];
    const sum = h + p + 1e-9;
    const hp = h / sum;
    const pp = p / sum;
    if (kind === "drums") return pp;
    if (k < bassK) return kind === "bass" ? hp : 0;
    if (k < melK) return kind === "melody" ? hp : 0;
    return kind === "other" ? hp : 0;
  };
  const istft = (kind) => {
    const out = new Float32Array(mono.length);
    const norm = new Float32Array(mono.length);
    const mask = maskOf(kind);
    for (let t = 0; t < frames; t++) {
      const re = reF[t].slice();
      const im = imF[t].slice();
      for (let k = 0; k < bins; k++) {
        const m = mask(t, k);
        re[k] *= m;
        im[k] *= m;
        if (k > 0) {
          re[n - k] *= m;
          im[n - k] *= m;
        }
      }
      fft(re, im, true);
      const start = t * hop;
      for (let i = 0; i < n; i++) {
        out[start + i] += re[i] * win[i];
        norm[start + i] += win[i] * win[i];
      }
    }
    for (let i = 0; i < out.length; i++) if (norm[i] > 1e-8) out[i] /= norm[i];
    return out;
  };
  return {
    drums: istft("drums"),
    bass: istft("bass"),
    melody: istft("melody"),
    other: istft("other"),
  };
}

export function fftRoundtripError() {
  const n = 1024;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 10 * i) / n);
  const orig = re.slice();
  fft(re, im, false);
  fft(re, im, true);
  let err = 0;
  for (let i = 0; i < n; i++) err += Math.abs(re[i] - orig[i]);
  return err;
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("hpss.js")) {
  const err = fftRoundtripError();
  if (err > 1e-2) throw new Error(`fft roundtrip ${err}`);
  const sr = 44100;
  const len = sr;
  const sine = new Float32Array(len);
  for (let i = 0; i < len; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  const parts = splitStems(sine, sr);
  const energy = (a) => a.reduce((s, x) => s + x * x, 0);
  const e = {
    drums: energy(parts.drums),
    bass: energy(parts.bass),
    melody: energy(parts.melody),
    other: energy(parts.other),
  };
  console.log("sine energy", e);
  if (!(e.melody > e.drums && e.melody > e.bass)) throw new Error("440 Hz sine should land in melody");
  const click = new Float32Array(len);
  click[4000] = 1;
  click[4001] = -0.8;
  click[4002] = 0.6;
  const c = splitStems(click, sr);
  const ce = { drums: energy(c.drums), melody: energy(c.melody) };
  console.log("click energy", ce);
  if (!(ce.drums > ce.melody)) throw new Error("click should land in drums");
  console.log("hpss ok");
}
