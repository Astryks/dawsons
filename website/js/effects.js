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

// Builds a Web Audio graph applying the requested effect chain to
// `sourceNode`, returning the final node to connect onward (e.g. to the
// destination or a track's gain node).
function buildEffectChain(ctx, sourceNode, opts) {
  let node = sourceNode;

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

export { reverseBuffer, pitchShiftBuffer, buildEffectChain };
