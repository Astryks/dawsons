// AudioWorklet: microphone capture + real-time voice analysis.
// Runs on the audio thread so pitch/onset tracking isn't hitched by UI work.
// Per hop (~10.7 ms) it posts: rms, f0 (YIN on a 2x-decimated signal),
// YIN confidence, low/high band energy ratios and zero-crossing rate.
// When recording, it also posts raw mic chunks with their context frame.

const W = 1024; // YIN frame, decimated samples (~43 ms at 24 kHz)
const HOP = 256; // decimated samples between analyses (~10.7 ms)
const YIN_THRESH = 0.15;

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
    this.tauMax = Math.min(W / 2, Math.ceil(this.dsr / 65));
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
      const d = this.diff;
      const tauMax = this.tauMax;
      const L = W - tauMax;
      d[0] = 1;
      let running = 0;
      let tauEst = -1;
      for (let tau = 1; tau <= tauMax; tau++) {
        let sum = 0;
        for (let j = 0; j < L; j++) {
          const v = buf[j] - buf[j + tau];
          sum += v * v;
        }
        running += sum;
        d[tau] = running > 0 ? (sum * tau) / running : 1;
      }
      for (let tau = this.tauMin; tau <= tauMax; tau++) {
        if (d[tau] < YIN_THRESH) {
          while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
          tauEst = tau;
          break;
        }
      }
      if (tauEst > 0) {
        // parabolic interpolation
        const a = d[tauEst - 1] ?? d[tauEst];
        const b = d[tauEst];
        const c = tauEst + 1 <= tauMax ? d[tauEst + 1] : b;
        const denom = a + c - 2 * b;
        const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
        f0 = this.dsr / (tauEst + shift);
        conf = 1 - b;
      }
    }
    this.port.postMessage({ type: "frame", frame, rms, f0, conf, low, high, zcr });
  }
}

registerProcessor("voice-processor", VoiceProcessor);
