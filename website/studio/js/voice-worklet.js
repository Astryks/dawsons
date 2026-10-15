// AudioWorklet: microphone capture + real-time voice analysis.
// Runs on the audio thread so pitch/onset tracking isn't hitched by UI work.
// Per hop (~5.3 ms) it posts: rms, f0 (McLeod Pitch Method on a
// 2x-decimated signal, 32 ms window), MPM clarity, low/high band energy ratios and zero-crossing rate.
// When recording, it also posts raw mic chunks with their context frame.

const W = 768; // analysis frame, decimated samples (~32 ms at 24 kHz)
const HOP = 128; // decimated samples between analyses (~5.3 ms)

class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.chunk = new Float32Array(4096);
    this.chunkFill = 0;
    this.chunkFrame = 0;
    this.ring = new Float32Array(W);
    this.ringFill = 0;
    this.ringPos = 0;
    this.lin = new Float32Array(W);
    this.sinceHop = 0;
    this.decPrev = 0;
    this.decPhase = 0;
    this.dsr = sampleRate / 2;
    this.tauMin = Math.floor(this.dsr / 1100);
    this.tauMax = Math.min(W - 2, Math.ceil(this.dsr / 65));
    this.diff = new Float32Array(this.tauMax + 1);
    // band trackers (raw rate)
    this.lpLow = 0;
    this.lpMid = 0;
    this.aLow = 1 - Math.exp((-2 * Math.PI * 250) / sampleRate);
    this.aMid = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
    this.eLow = 0; this.eHigh = 0; this.eAll = 0; this.zc = 0; this.nRaw = 0; this.last = 0;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.rec === "boolean") {
        if (!e.data.rec && this.recording && this.chunkFill > 0) this.flushChunk();
        this.recording = e.data.rec;
        this.chunkFill = 0;
      }
    };
  }

  flushChunk() {
    const out = this.chunk.slice(0, this.chunkFill);
    this.port.postMessage({ type: "chunk", frame: this.chunkFrame, data: out }, [out.buffer]);
    this.chunkFill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const x = input[0];
    const n = x.length;
    if (this.recording) {
      for (let i = 0; i < n; i++) {
        if (this.chunkFill === 0) this.chunkFrame = currentFrame + i;
        this.chunk[this.chunkFill++] = x[i];
        if (this.chunkFill === this.chunk.length) this.flushChunk();
      }
    }
    for (let i = 0; i < n; i++) {
      const s = x[i];
      // band energies
      this.lpLow += this.aLow * (s - this.lpLow);
      this.lpMid += this.aMid * (s - this.lpMid);
      const high = s - this.lpMid;
      this.eLow += this.lpLow * this.lpLow;
      this.eHigh += high * high;
      this.eAll += s * s;
      if ((s >= 0) !== (this.last >= 0)) this.zc++;
      this.last = s;
      this.nRaw++;
      // 2x decimation (simple averaging low-pass)
      if (this.decPhase === 1) {
        const d = 0.5 * (s + this.decPrev);
        this.ring[this.ringPos] = d;
        this.ringPos = (this.ringPos + 1) % W;
        if (this.ringFill < W) this.ringFill++;
        this.sinceHop++;
        if (this.sinceHop >= HOP && this.ringFill >= W) {
          this.sinceHop = 0;
          this.analyse(currentFrame + i);
        }
      }
      this.decPrev = s;
      this.decPhase ^= 1;
    }
    return true;
  }

  analyse(frame) {
    const nRaw = Math.max(1, this.nRaw);
    const rms = Math.sqrt(this.eAll / nRaw);
    const tot = this.eAll + 1e-12;
    const quiet = this.eAll < 1e-7;
    const low = quiet ? 0 : Math.min(1, this.eLow / tot);
    const high = quiet ? 0 : Math.min(1, this.eHigh / tot);
    const zcr = this.zc / nRaw;
    this.eLow = this.eHigh = this.eAll = 0;
    this.zc = 0;
    this.nRaw = 0;

    let f0 = 0;
    let conf = 0;
    if (rms > 0.003) {
      const buf = this.lin;
      const r = this.ring;
      const p0 = this.ringPos; // oldest sample
      for (let k = 0; k < W; k++) buf[k] = r[(p0 + k) % W];
      const n = this.diff;
      const tauMax = this.tauMax;
      for (let tau = 0; tau <= tauMax; tau++) {
        let acf = 0;
        let m = 0;
        for (let j = 0, L = W - tau; j < L; j++) {
          const a = buf[j];
          const b = buf[j + tau];
          acf += a * b;
          m += a * a + b * b;
        }
        n[tau] = m > 0 ? (2 * acf) / m : 0;
      }
      // MPM: highest "key maximum" (between positive zero crossings) that
      // reaches 0.9 x the overall best.
      let tau = 1;
      while (tau < tauMax && n[tau] > 0) tau++;
      let maxV = 0;
      let cnt = 0;
      const peaks = this.peaks || (this.peaks = new Int32Array(64));
      let best = -1;
      let bestVal = 0;
      for (; tau < tauMax && cnt < 64; tau++) {
        if (n[tau] > 0) {
          if (n[tau] > bestVal) { bestVal = n[tau]; best = tau; }
          if (n[tau + 1] <= 0 && best > 0) {
            peaks[cnt++] = best;
            if (bestVal > maxV) maxV = bestVal;
            best = -1;
            bestVal = 0;
          }
        }
      }
      for (let i = 0; i < cnt; i++) {
        const p = peaks[i];
        if (n[p] >= 0.9 * maxV && p >= this.tauMin) {
          const a = n[p - 1];
          const b = n[p];
          const c = n[p + 1];
          const den = a + c - 2 * b;
          const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
          f0 = this.dsr / (p + shift);
          conf = b;
          break;
        }
      }
    }
    this.port.postMessage({ type: "frame", frame, rms, f0, conf, low, high, zcr });
  }
}

registerProcessor("voice-processor", VoiceProcessor);
