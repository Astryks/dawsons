// Voice engine: mic recording + "voice to instrument" (Dubler-style).
//  - melody mode: real-time pitch (YIN) -> note on/off with hysteresis,
//    optional scale snapping and octave shift -> plays the keyboard instrument
//  - beatbox mode: onset detection + timbre features (low/high band
//    ratios, zero-crossing rate) -> kick / snare / hat pads. You can teach
//    it your own sounds (nearest-centroid on your examples).

import { getCtx } from "./audio.js";

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export const BEAT_CLASSES = ["kick", "snare", "hat"];
export const BEAT_TO_PAD = { kick: 12, snare: 14, hat: 6 };

export class VoiceEngine {
  constructor() {
    this.mode = "off"; // off | melody | beatbox
    this.sensitivity = 0.5; // 0..1 -> gate
    this.scale = "chromatic";
    this.root = 0;
    this.octave = 0;
    this.onNoteOn = () => {};
    this.onNoteOff = () => {};
    this.onBeat = () => {};
    this.onLevel = () => {};
    this.onPitch = () => {};
    this.current = null;
    this.cand = null;
    this.candCount = 0;
    this.unvoiced = 0;
    this.prevRms = 0;
    this.lastOnset = -1;
    this.pendingOnset = null;
    this.training = null; // {cls, remaining}
    this.examples = { kick: [], snare: [], hat: [] };
    this.chunks = [];
    this.recording = false;
  }

  get gate() {
    // sensitivity 0 -> 0.05 (needs loud), 1 -> 0.004 (very sensitive)
    return 0.05 * Math.pow(0.08, this.sensitivity);
  }

  async open() {
    if (this.node) return;
    const c = getCtx();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const settings = this.stream.getAudioTracks()[0]?.getSettings?.() || {};
    this.inputLatency = typeof settings.latency === "number" ? settings.latency : 0.01;
    await c.audioWorklet.addModule(new URL("./voice-worklet.js", import.meta.url));
    this.source = c.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(c, "voice-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const sink = c.createGain();
    sink.gain.value = 0;
    this.source.connect(this.node).connect(sink).connect(c.destination);
    this.node.port.onmessage = (e) => this.handle(e.data);
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.source?.disconnect();
    this.node = null;
    this.releaseNote();
  }

  get isOpen() {
    return !!this.node;
  }

  latency() {
    const c = getCtx();
    return (c.outputLatency || 0) + (c.baseLatency || 0) + (this.inputLatency || 0.01);
  }

  startRecording() {
    this.chunks = [];
    this.recording = true;
    this.node?.port.postMessage({ rec: true });
  }

  // Returns { buffer, startTime (context seconds of first sample) } or null.
  stopRecording() {
    this.recording = false;
    this.node?.port.postMessage({ rec: false });
    return new Promise((resolve) => {
      // let the final chunk arrive
      setTimeout(() => {
        const chunks = this.chunks;
        this.chunks = [];
        if (!chunks.length) return resolve(null);
        const c = getCtx();
        const total = chunks.reduce((n, ch) => n + ch.data.length, 0);
        const buf = c.createBuffer(1, total, c.sampleRate);
        const d = buf.getChannelData(0);
        let o = 0;
        for (const ch of chunks) {
          d.set(ch.data, o);
          o += ch.data.length;
        }
        resolve({ buffer: buf, startTime: chunks[0].frame / c.sampleRate });
      }, 120);
    });
  }

  handle(msg) {
    if (msg.type === "chunk") {
      if (this.recording) this.chunks.push(msg);
      return;
    }
    const c = getCtx();
    const t = msg.frame / c.sampleRate;
    this.onLevel(msg.rms);
    if (this.mode === "melody") this.melody(msg, t);
    else if (this.mode === "beatbox" || this.training) this.beatbox(msg, t);
    this.prevRms = msg.rms;
  }

  // ------------------------------------------------------------ melody

  snap(midiFloat) {
    const scale = SCALES[this.scale] || SCALES.chromatic;
    let best = Math.round(midiFloat);
    let bestDist = Infinity;
    for (let m = Math.floor(midiFloat) - 2; m <= Math.ceil(midiFloat) + 2; m++) {
      const pc = (((m - this.root) % 12) + 12) % 12;
      if (!scale.includes(pc)) continue;
      const dist = Math.abs(m - midiFloat);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    return best;
  }

  melody(msg, t) {
    const voiced = msg.f0 > 60 && msg.f0 < 1200 && msg.conf > 0.8 && msg.rms > this.gate;
    if (!voiced) {
      this.onPitch(null);
      this.unvoiced++;
      this.cand = null;
      this.candCount = 0;
      if (this.current !== null && this.unvoiced >= 3) this.releaseNote(t);
      return;
    }
    this.unvoiced = 0;
    const mf = 69 + 12 * Math.log2(msg.f0 / 440);
    const note = this.snap(mf) + this.octave * 12;
    this.onPitch({ midiFloat: mf, note });
    if (this.current !== null) {
      const curRaw = this.current - this.octave * 12;
      if (note === this.current || Math.abs(mf - curRaw) < 0.7) {
        this.cand = null;
        this.candCount = 0;
        return;
      }
    }
    if (this.cand === note) this.candCount++;
    else {
      this.cand = note;
      this.candCount = 1;
    }
    const need = this.current === null ? 2 : 3;
    if (this.candCount >= need) {
      if (this.current !== null) this.onNoteOff(this.current, t);
      this.current = note;
      const db = 20 * Math.log10(msg.rms + 1e-9);
      const vel = Math.round(Math.max(40, Math.min(127, ((db + 45) / 39) * 87 + 40)));
      this.onNoteOn(note, vel, t);
      this.cand = null;
      this.candCount = 0;
    }
  }

  releaseNote(t) {
    if (this.current !== null) {
      this.onNoteOff(this.current, t ?? getCtx().currentTime);
      this.current = null;
    }
  }

  // ----------------------------------------------------------- beatbox

  beatbox(msg, t) {
    if (this.pendingOnset) {
      const p = this.pendingOnset;
      p.frames.push(msg);
      if (p.frames.length >= 2) {
        this.pendingOnset = null;
        const f = features(p.frames);
        if (this.training) {
          this.examples[this.training.cls].push(f);
          this.training.remaining--;
          this.onBeat(this.training.cls, 100, p.t, true);
          if (this.training.remaining <= 0) {
            const done = this.training.cls;
            this.training = null;
            this.onTrainDone?.(done);
          }
          return;
        }
        const cls = this.classify(f);
        const vel = Math.round(Math.max(50, Math.min(127, 60 + f.loud * 67)));
        this.onBeat(cls, vel, p.t, false);
      }
      return;
    }
    const rising = msg.rms > this.gate * 1.5 && msg.rms > this.prevRms * 1.8;
    if (rising && t - this.lastOnset > 0.09) {
      this.lastOnset = t;
      this.pendingOnset = { t, frames: [msg] };
    }
  }

  train(cls, count = 4) {
    this.examples[cls] = [];
    this.training = { cls, remaining: count };
  }

  clearTraining() {
    this.examples = { kick: [], snare: [], hat: [] };
  }

  trainedCount(cls) {
    return this.examples[cls].length;
  }

  classify(f) {
    const trained = BEAT_CLASSES.filter((c) => this.examples[c].length);
    if (trained.length >= 2) {
      let best = null;
      let bestD = Infinity;
      for (const cls of trained) {
        const ex = this.examples[cls];
        const cen = ex.reduce((a, e) => a.map((v, i) => v + e.vec[i] / ex.length), [0, 0, 0]);
        const d = cen.reduce((s, v, i) => s + (v - f.vec[i]) ** 2, 0);
        if (d < bestD) {
          bestD = d;
          best = cls;
        }
      }
      return best;
    }
    // Default heuristics: "B"/"boom" is bass-heavy with few zero
    // crossings, "ts"/"k" is hiss (lots of highs, high ZCR), "psh"/"ka"
    // sits between.
    if (f.low > 0.5 && f.zcr < 0.08) return "kick";
    if (f.high > 0.35 || f.zcr > 0.25) return "hat";
    return "snare";
  }
}

function features(frames) {
  const n = frames.length;
  const low = frames.reduce((s, f) => s + f.low, 0) / n;
  const high = frames.reduce((s, f) => s + f.high, 0) / n;
  const zcr = frames.reduce((s, f) => s + f.zcr, 0) / n;
  const rms = Math.max(...frames.map((f) => f.rms));
  const loud = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 40) / 34));
  return { low, high, zcr, loud, vec: [low, high, Math.min(1, zcr * 3)] };
}
