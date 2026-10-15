// McLeod Pitch Method (MPM, "A smarter way to find pitch", McLeod & Wyvill
// 2005) — original implementation. Used offline for "convert a vocal
// clip to notes"; the same algorithm runs live in voice-worklet.js.

// Returns {f0, clarity} for frame x (Float32Array) at sample rate sr.
export function mpm(x, sr, nsdf, minF = 65, maxF = 1100) {
  const W = x.length;
  const tauMax = Math.min(W - 1, Math.ceil(sr / minF));
  const tauMin = Math.max(2, Math.floor(sr / maxF));
  const n = nsdf || new Float32Array(tauMax + 1);
  for (let tau = 0; tau <= tauMax; tau++) {
    let acf = 0;
    let m = 0;
    for (let j = 0; j < W - tau; j++) {
      const a = x[j];
      const b = x[j + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    n[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // key maxima between positive zero crossings
  const peaks = [];
  let tau = 1;
  while (tau < tauMax && n[tau] > 0) tau++; // skip the zero-lag lobe
  let best = -1;
  let bestVal = 0;
  for (; tau < tauMax; tau++) {
    if (n[tau] > 0 && n[tau - 1] <= 0) {
      best = -1;
      bestVal = 0;
    }
    if (n[tau] > 0) {
      if (n[tau] > bestVal) {
        bestVal = n[tau];
        best = tau;
      }
      if (n[tau + 1] <= 0 && best > 0) {
        peaks.push(best);
        best = -1;
        bestVal = 0;
      }
    }
  }
  if (!peaks.length) return { f0: 0, clarity: 0 };
  let maxV = 0;
  for (const p of peaks) maxV = Math.max(maxV, n[p]);
  const thresh = 0.9 * maxV;
  let pick = peaks.find((p) => n[p] >= thresh && p >= tauMin) ?? -1;
  if (pick < 0) return { f0: 0, clarity: 0 };
  const a = n[pick - 1];
  const b = n[pick];
  const c = n[pick + 1] ?? b;
  const den = a + c - 2 * b;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return { f0: sr / (pick + shift), clarity: b };
}

// Note tracker with hysteresis (shared idea with the live engine):
// start a note after `onFrames` stable frames, change note after
// `changeFrames`, stop after `offFrames` unvoiced frames; the level gate
// opens at `gate` and closes at gate*0.6.
export class NoteTracker {
  constructor({ snap = (m) => Math.round(m), onFrames = 2, changeFrames = 3, offFrames = 3, band = 0.7 } = {}) {
    Object.assign(this, { snap, onFrames, changeFrames, offFrames, band });
    this.current = null;
    this.cur = null;
    this.cand = null;
    this.count = 0;
    this.unvoiced = 0;
    this.open = false;
  }
  // Returns list of events [{type:"on"|"off", note, vel}]
  push({ f0, clarity, rms }, gate, minClarity = 0.8) {
    const out = [];
    if (this.open ? rms < gate * 0.6 : rms > gate) this.open = !this.open;
    const voiced = this.open && f0 > 60 && f0 < 1200 && clarity > minClarity;
    if (!voiced) {
      this.unvoiced++;
      this.cand = null;
      this.count = 0;
      if (this.current !== null && this.unvoiced >= this.offFrames) {
        out.push({ type: "off", note: this.current });
        this.current = null;
      }
      return out;
    }
    this.unvoiced = 0;
    const mf = 69 + 12 * Math.log2(f0 / 440);
    const note = this.snap(mf);
    this.midiFloat = mf;
    if (this.current !== null && (note === this.current || Math.abs(mf - this.curRaw) < this.band)) {
      this.cand = null;
      this.count = 0;
      return out;
    }
    if (this.cand === note) this.count++;
    else {
      this.cand = note;
      this.count = 1;
    }
    if (this.count >= (this.current === null ? this.onFrames : this.changeFrames)) {
      if (this.current !== null) out.push({ type: "off", note: this.current });
      this.current = note;
      this.curRaw = Math.round(mf);
      const db = 20 * Math.log10(rms + 1e-9);
      const vel = Math.round(Math.max(40, Math.min(127, ((db + 45) / 39) * 87 + 40)));
      out.push({ type: "on", note, vel });
      this.cand = null;
      this.count = 0;
    }
    return out;
  }
}

// Offline: AudioBuffer -> [{t, n, v, d}] (seconds from buffer start).
export async function bufferToNotes(buf, { snap, gate = 0.01, minDur = 0.06, onProgress } = {}) {
  const sr0 = buf.sampleRate;
  // mono + 2x decimation (voice fundamentals are < 1.2 kHz)
  const ch = buf.numberOfChannels;
  const len = Math.floor(buf.length / 2);
  const x = new Float32Array(len);
  const datas = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const d of datas) s += d[2 * i] + (d[2 * i + 1] || 0);
    x[i] = s / (2 * ch);
  }
  const sr = sr0 / 2;
  const W = 1024;
  const HOP = Math.round(sr * 0.008);
  const tracker = new NoteTracker({ snap, onFrames: 3, changeFrames: 4, offFrames: 4 });
  const nsdf = new Float32Array(W);
  const notes = [];
  let open = null;
  let lastYield = performance.now();
  for (let pos = 0; pos + W <= len; pos += HOP) {
    const frame = x.subarray(pos, pos + W);
    let e = 0;
    for (let i = 0; i < W; i++) e += frame[i] * frame[i];
    const rms = Math.sqrt(e / W);
    const p = rms > gate * 0.5 ? mpm(frame, sr, nsdf) : { f0: 0, clarity: 0 };
    const t = (pos + W / 2) / sr;
    for (const ev of tracker.push({ ...p, rms }, gate)) {
      if (ev.type === "off" && open) {
        open.d = t - open.t;
        if (open.d >= minDur) notes.push(open);
        open = null;
      } else if (ev.type === "on") open = { t, n: ev.note, v: ev.vel, d: 0 };
    }
    if (performance.now() - lastYield > 30) {
      onProgress?.(pos / len);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  if (open) {
    open.d = len / sr - open.t;
    if (open.d >= minDur) notes.push(open);
  }
  return notes;
}
