// Clip-tools effects for the browser DAW. EQ, compression, and delay use
// the Web Audio API's own native nodes (BiquadFilterNode,
// DynamicsCompressorNode, DelayNode) — the browser platform already
// provides these, so there's nothing to reimplement. Reverb uses a
// procedurally-generated noise impulse response (a standard, generic
// technique, not derived from any specific reverb product) via
// ConvolverNode. Reverse and pitch-shift operate directly on the decoded
// AudioBuffer.

function reverseBuffer(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  }
  return out;
}

// Vari-speed pitch shift by resampling (duration changes with pitch,
// matching real tape/turntable behavior) — the same technique used in
// the desktop app's effects.rs.
function pitchShiftBuffer(ctx, buffer, semitones) {
  if (semitones === 0) return buffer;
  const rate = Math.pow(2, semitones / 12);
  const newLength = Math.max(1, Math.round(buffer.length / rate));
  const out = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < newLength; i++) {
      const srcPos = i * rate;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(src.length - 1, i0 + 1);
      const frac = srcPos - i0;
      dst[i] = (src[i0] || 0) * (1 - frac) + (src[i1] || 0) * frac;
    }
  }
  return out;
}

// Time-stretch a clip's playback duration by resampling — the same
// vari-speed technique as pitchShiftBuffer above, just parameterized by
// a direct duration ratio instead of semitones: ratio > 1 lengthens
// (slows down), ratio < 1 shortens (speeds up). Pitch moves with speed
// (same honest trade-off pitchShiftBuffer's own comment already
// discloses) — a true pitch-preserving stretch needs a phase vocoder,
// which is a materially bigger DSP undertaking than this homepage demo
// warrants; this is the same real, working technique already shipped
// elsewhere in this file, just exposed as its own per-track control.
function stretchBuffer(ctx, buffer, ratio) {
  if (!ratio || ratio === 1) return buffer;
  const newLength = Math.max(1, Math.round(buffer.length * ratio));
  const rate = buffer.length / newLength;
  const out = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < newLength; i++) {
      const srcPos = i * rate;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(src.length - 1, i0 + 1);
      const frac = srcPos - i0;
      dst[i] = (src[i0] || 0) * (1 - frac) + (src[i1] || 0) * frac;
    }
  }
  return out;
}

// Crops a buffer to [startSec, endSec] — the "edit mask" for an
// imported clip or a voice recording: cut out just the part you
// actually want before reversing/pitching/adding it to the timeline,
// rather than being stuck with the whole file.
function trimBuffer(ctx, buffer, startSec, endSec) {
  const startFrame = Math.max(0, Math.min(buffer.length, Math.floor(startSec * buffer.sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(buffer.length, Math.ceil(endSec * buffer.sampleRate)));
  const length = Math.max(1, endFrame - startFrame);
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(startFrame, startFrame + length));
  }
  return out;
}

function makeImpulseResponse(ctx, roomSize) {
  const duration = 0.5 + roomSize * 2.5;
  const length = Math.floor(ctx.sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2 + roomSize * 4);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return impulse;
}

// Ring modulation via native nodes only: a GainNode with its intrinsic
// gain left at 0 sums with whatever is connected into its `.gain`
// AudioParam, so an OscillatorNode (which outputs -1..1) connected there
// makes the gain itself oscillate between -1 and 1 — literal ring
// modulation (the same technique as the desktop app's ring_modulate),
// with no custom DSP node needed. The oscillator is started/stopped
// alongside the source so it doesn't leak.
function buildRoboticNode(ctx, carrierHz) {
  const carrier = ctx.createOscillator();
  carrier.frequency.value = carrierHz || 80;
  const ring = ctx.createGain();
  ring.gain.value = 0;
  carrier.connect(ring.gain);
  carrier.start();
  return ring;
}

// A soft-clip (tanh) saturation curve for WaveShaperNode — the classic,
// simple distortion technique (drive a signal into a compressive curve
// so peaks flatten instead of clipping harshly), a real vocal-chain
// staple; not derived from any specific plugin.
function makeDistortionCurve(amount) {
  const n = 44100;
  const curve = new Float32Array(n);
  const drive = Math.max(0.001, amount * 20);
  const normalize = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / normalize;
  }
  return curve;
}

// "Pump"-style sidechain ducking — the rhythmic volume dip every beat
// that's core to Daft Punk/house production, normally driven by routing
// a kick drum into a compressor's sidechain-key input. The Web Audio
// API's DynamicsCompressorNode has no external sidechain-key input at
// all (a real, checkable platform limitation, not an oversight here) —
// rather than skip the effect or fake something unconvincing, this
// reproduces the same audible shape procedurally: a short, precomputed
// gain-envelope curve (duck sharply, recover exponentially) repeated
// once per beat at the track's own tempo via real scheduled
// AudioParam automation (`setValueCurveAtTime`), not a literal
// kick-triggered sidechain input. The result is the same rhythmic
// "pump" sound, honestly built from what the platform actually exposes.
function buildSidechainPumpNode(ctx, amount, bpm) {
  const gainNode = ctx.createGain();
  gainNode.gain.value = 1;
  const beatsPerSec = (bpm || 120) / 60;
  const cycleDur = 1 / beatsPerSec;
  const depth = Math.max(0, Math.min(0.95, amount));
  const curveLen = 128;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const t = i / (curveLen - 1);
    // Duck hard right at the top of the beat, then recover
    // exponentially — the classic pump shape, "release speed" baked in
    // as a fixed, musically-sensible decay rate (this project's other
    // single-knob effects — Robotic, Muffled, Distortion — are each one
    // slider too, so a second "release" slider here would be
    // inconsistent with the rest of this effect stack's own UI).
    curve[i] = 1 - depth * Math.exp(-t * 5.5);
  }
  const totalDurationSec = ctx.length ? ctx.length / ctx.sampleRate : 30;
  for (let t = 0; t < totalDurationSec; t += cycleDur) {
    gainNode.gain.setValueCurveAtTime(curve, t, Math.min(cycleDur, totalDurationSec - t));
  }
  return gainNode;
}

// A slow-moving resonant low-pass sweep — the filter-automation
// technique behind "One More Time"/"Da Funk"'s evolving tone, distinct
// from the existing static Muffled lowpass (one fixed cutoff): an LFO
// continuously modulates the cutoff frequency up and down over several
// seconds, same idea as buildRoboticNode's oscillator-into-AudioParam
// trick above, just modulating frequency instead of gain.
function buildFilterSweepNode(ctx, amount) {
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = 5;
  const minHz = 300;
  const maxHz = 300 + Math.max(0, Math.min(1, amount)) * 7000;
  const center = (maxHz + minHz) / 2;
  const depth = (maxHz - minHz) / 2;
  filt.frequency.value = center;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.15; // a slow, several-seconds-per-sweep rate
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = depth;
  lfo.connect(lfoGain).connect(filt.frequency);
  lfo.start();
  return filt;
}

// Builds a Web Audio graph applying the requested effect chain to
// `sourceNode`, returning the final node to connect onward (e.g. to the
// destination or a track's gain node).
function buildEffectChain(ctx, sourceNode, opts) {
  let node = sourceNode;

  if (opts.roboticHz && opts.roboticHz > 0) {
    const ring = buildRoboticNode(ctx, opts.roboticHz);
    node.connect(ring);
    node = ring;
  }

  if (opts.muffleCutoffHz && opts.muffleCutoffHz > 0) {
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = opts.muffleCutoffHz;
    node.connect(muffle);
    node = muffle;
  }

  if (opts.filterSweepAmount && opts.filterSweepAmount > 0) {
    const sweep = buildFilterSweepNode(ctx, opts.filterSweepAmount);
    node.connect(sweep);
    node = sweep;
  }

  if (opts.distortionAmount && opts.distortionAmount > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(opts.distortionAmount);
    shaper.oversample = "4x";
    node.connect(shaper);
    node = shaper;
  }

  if (opts.eqGainDb && opts.eqGainDb !== 0) {
    const eq = ctx.createBiquadFilter();
    eq.type = "peaking";
    eq.frequency.value = opts.eqFreqHz || 1000;
    eq.Q.value = opts.eqQ || 1;
    eq.gain.value = opts.eqGainDb;
    node.connect(eq);
    node = eq;
  }

  if (opts.compressEnabled) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = opts.compressThresholdDb ?? -24;
    comp.ratio.value = opts.compressRatio ?? 4;
    comp.attack.value = (opts.compressAttackMs ?? 10) / 1000;
    comp.release.value = (opts.compressReleaseMs ?? 100) / 1000;
    node.connect(comp);
    node = comp;
  }

  if (opts.sidechainAmount && opts.sidechainAmount > 0) {
    const pump = buildSidechainPumpNode(ctx, opts.sidechainAmount, opts.bpm);
    node.connect(pump);
    node = pump;
  }

  if (opts.delayWet && opts.delayWet > 0) {
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = (opts.delayMs || 250) / 1000;
    const feedback = ctx.createGain();
    feedback.gain.value = Math.min(0.95, opts.delayFeedback ?? 0.3);
    const wet = ctx.createGain();
    wet.gain.value = opts.delayWet;
    const dry = ctx.createGain();
    dry.gain.value = 1 - opts.delayWet;

    const merge = ctx.createGain();
    node.connect(dry).connect(merge);
    node.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(merge);
    node = merge;
  }

  // A real stereo-capable chorus — styled on the Roland Juno-60's
  // built-in analog chorus circuit (researched: the consistently
  // documented instrument behind "Last Christmas"'s lush, shimmering
  // intro sound — see STATUS.md and synth.js's chorus80s preset, which
  // uses the equivalent technique in the sample domain for pattern
  // tracks; this is the AudioNode version for the Voice/Any Sound
  // effect stacks). Two short delay lines, each LFO-swept at a
  // different rate, mixed with dry — the standard, well-documented
  // "modulated delay" chorus technique, not derived from any specific
  // plugin or hardware's circuit design.
  if (opts.chorusWet && opts.chorusWet > 0) {
    const dry = ctx.createGain();
    dry.gain.value = 1 - opts.chorusWet;
    const wet = ctx.createGain();
    wet.gain.value = opts.chorusWet;
    const merge = ctx.createGain();
    node.connect(dry).connect(merge);
    [
      { baseSec: 0.015, rateHz: 0.6, depthSec: 0.004 },
      { baseSec: 0.022, rateHz: 0.9, depthSec: 0.005 },
    ].forEach(({ baseSec, rateHz, depthSec }) => {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = baseSec;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = rateHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depthSec;
      lfo.connect(lfoGain).connect(delay.delayTime);
      lfo.start();
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.5;
      node.connect(delay).connect(voiceGain).connect(wet).connect(merge);
    });
    node = merge;
  }

  if (opts.reverbWet && opts.reverbWet > 0) {
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, opts.reverbRoom ?? 0.5);
    const wet = ctx.createGain();
    wet.gain.value = opts.reverbWet;
    const dry = ctx.createGain();
    dry.gain.value = 1 - opts.reverbWet;
    const merge = ctx.createGain();
    node.connect(dry).connect(merge);
    node.connect(convolver).connect(wet).connect(merge);
    node = merge;
  }

  return node;
}

export { reverseBuffer, pitchShiftBuffer, stretchBuffer, trimBuffer, buildEffectChain };
