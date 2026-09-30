// Non-destructive clip processing. The clip keeps its original buffer;
// these functions build the processed buffer that actually plays.
//  - reverse:      sample order flipped
//  - stretch:      WSOLA time-stretch (length changes, pitch stays)
//  - pitch:        semitone shift with length kept (stretch + resample)
// "Tape speed" (varispeed: slower = lower, like slowing a tape) is not
// done here — it's just playbackRate at play/export time.

import { getCtx } from "./audio.js";

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export async function processClipBuffer(src, { reversed = false, stretch = 1, pitch = 0 }) {
  let buf = src;
  if (reversed) buf = reverseBuffer(buf);
  const ratio = Math.pow(2, pitch / 12);
  const factor = stretch * ratio;
  if (Math.abs(factor - 1) > 1e-3) buf = await wsola(buf, factor);
  if (Math.abs(ratio - 1) > 1e-3) buf = await resample(buf, ratio);
  return buf;
}

export function reverseBuffer(buf) {
  const c = getCtx();
  const out = c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    const o = out.getChannelData(ch);
    for (let i = 0, n = d.length; i < n; i++) o[i] = d[n - 1 - i];
  }
  return out;
}

// Plays the buffer faster by `ratio` (pitch up by ratio, shorter).
async function resample(buf, ratio) {
  const len = Math.max(1, Math.round(buf.length / ratio));
  const off = new OfflineAudioContext(buf.numberOfChannels, len, buf.sampleRate);
  const s = off.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = ratio;
  s.connect(off.destination);
  s.start(0);
  return off.startRendering();
}

// Waveform-similarity overlap-add. factor > 1 = longer/slower.
export async function wsola(buf, factor) {
  const sr = buf.sampleRate;
  const N = sr >= 88000 ? 4096 : 2048; // ~46 ms frames
  const Hs = N / 2; // synthesis hop (Hann at 50% overlap sums to 1)
  const Ha = Hs / factor; // analysis hop
  const tol = Math.round(N / 8); // search ± ~6 ms
  const chs = buf.numberOfChannels;
  const inLen = buf.length;
  const outLen = Math.max(N, Math.round(inLen * factor));
  const inputs = [];
  for (let ch = 0; ch < chs; ch++) inputs.push(buf.getChannelData(ch));
  // Mono guide signal for the similarity search.
  const mono = new Float32Array(inLen + N * 2);
  for (let ch = 0; ch < chs; ch++) {
    const d = inputs[ch];
    for (let i = 0; i < inLen; i++) mono[i] += d[i] / chs;
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outs = [];
  for (let ch = 0; ch < chs; ch++) outs.push(new Float32Array(outLen + N));

  let prevPos = 0; // input position of previous chosen frame
  const frames = Math.ceil(outLen / Hs);
  for (let k = 0; k < frames; k++) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // The ideal continuation of the previous frame starts at prevPos + Hs.
      const target = prevPos + Hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(inLen - 1, nominal + tol);
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < Hs; i += 4) score += mono[cand + i] * mono[target + i];
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    const outPos = k * Hs;
    for (let ch = 0; ch < chs; ch++) {
      const d = inputs[ch];
      const o = outs[ch];
      for (let i = 0; i < N; i++) {
        const idx = best + i;
        if (idx >= inLen) break;
        o[outPos + i] += d[idx] * win[i];
      }
    }
    prevPos = best;
    if (k % 200 === 199) await yieldUI();
  }
  const c = getCtx();
  const out = c.createBuffer(chs, outLen, sr);
  for (let ch = 0; ch < chs; ch++) out.copyToChannel(outs[ch].subarray(0, outLen), ch);
  return out;
}

export function peaks(buf, count) {
  const d = buf.getChannelData(0);
  const d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const step = Math.max(1, Math.floor(d.length / count));
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let m = 0;
    const start = i * step;
    const end = Math.min(d.length, start + step);
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(d[j]) + (d2 ? Math.abs(d2[j]) : 0);
      if (v > m) m = v;
    }
    out[i] = d2 ? m / 2 : m;
  }
  return out;
}
