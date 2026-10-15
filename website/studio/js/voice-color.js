// Real-time voice color. The mic is already open for pitch tracking;
// these presets listen to that same stream and play a transformed copy
// through the master bus. No samples, no network — Web Audio only.

const PRESETS = ["robot", "radio", "telephone", "megaphone", "cave", "chorus", "chipmunk", "giant"];

export class VoiceColor {
  constructor(getMaster) {
    this.getMaster = getMaster;
    this.preset = "off";
    this.source = null;
    this.nodes = [];
    this.started = [];
    this.links = [];
  }

  attach(source) {
    this.source = source;
    if (this.preset !== "off") this.setPreset(this.preset);
  }

  stop() {
    this.preset = "off";
    this.teardown();
  }

  setPreset(name) {
    this.preset = name;
    this.teardown();
    if (!this.source || name === "off" || name === "dry") {
      if (name === "dry" && this.source) this.wireDry(0.9);
      return;
    }
    const ctx = this.source.context;
    const dest = this.getMaster();
    if (name === "chipmunk") return this.wireShift(ctx, dest, 8);
    if (name === "giant") return this.wireShift(ctx, dest, -8);
    if (name === "robot") return this.wireRobot(ctx, dest);
    if (name === "radio" || name === "telephone") return this.wireRadio(ctx, dest, name);
    if (name === "megaphone") return this.wireMega(ctx, dest);
    if (name === "cave") return this.wireCave(ctx, dest);
    if (name === "chorus") return this.wireChorus(ctx, dest);
  }

  teardown() {
    this.links.forEach(([from, to]) => {
      try { from.disconnect(to); } catch { /* already gone */ }
    });
    this.started.forEach((n) => {
      try { n.stop(); } catch { /* already stopped */ }
    });
    this.links = [];
    this.nodes = [];
    this.started = [];
  }

  wire(from, to) {
    from.connect(to);
    this.links.push([from, to]);
    return to;
  }

  keep(...nodes) {
    this.nodes.push(...nodes);
  }

  start(node) {
    node.start();
    this.started.push(node);
  }

  wireDry(gain) {
    const ctx = this.source.context;
    const g = ctx.createGain();
    g.gain.value = gain;
    this.wire(this.source, g);
    this.wire(g, this.getMaster());
    this.keep(g);
  }

  wireRobot(ctx, dest) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 120;
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = 86;
    const out = ctx.createGain();
    out.gain.value = 0.8;
    this.wire(this.source, hp);
    this.wire(hp, ring);
    this.wire(ring, out);
    this.wire(out, dest);
    this.wire(carrier, ring.gain);
    this.start(carrier);
    this.keep(hp, ring, carrier, out);
  }

  wireRadio(ctx, dest, name) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = name === "telephone" ? 1400 : 1800;
    bp.Q.value = name === "telephone" ? 0.7 : 0.85;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortCurve(name === "telephone" ? 8 : 18);
    const out = ctx.createGain();
    out.gain.value = name === "telephone" ? 1.4 : 0.7;
    this.wire(this.source, bp);
    this.wire(bp, shaper);
    this.wire(shaper, out);
    this.wire(out, dest);
    this.keep(bp, shaper, out);
  }

  wireMega(ctx, dest) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortCurve(30);
    const bp = ctx.createBiquadFilter();
    bp.type = "peaking";
    bp.frequency.value = 1800;
    bp.gain.value = 8;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    this.wire(this.source, hp);
    this.wire(hp, shaper);
    this.wire(shaper, bp);
    this.wire(bp, out);
    this.wire(out, dest);
    this.keep(hp, shaper, bp, out);
  }

  wireCave(ctx, dest) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.31;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const wet = ctx.createGain();
    wet.gain.value = 0.8;
    const dry = ctx.createGain();
    dry.gain.value = 0.65;
    this.wire(this.source, dry);
    this.wire(dry, dest);
    this.wire(this.source, delay);
    this.wire(delay, lp);
    this.wire(lp, wet);
    this.wire(wet, dest);
    this.wire(delay, fb);
    this.wire(fb, delay);
    this.keep(delay, fb, lp, wet, dry);
  }

  wireChorus(ctx, dest) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.018;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    const depth = ctx.createGain();
    depth.gain.value = 0.006;
    this.wire(lfo, depth);
    this.wire(depth, delay.delayTime);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    this.wire(this.source, dry);
    this.wire(dry, dest);
    this.wire(this.source, delay);
    this.wire(delay, wet);
    this.wire(wet, dest);
    this.start(lfo);
    this.keep(delay, lfo, depth, wet, dry);
  }

  // Dual-delay pitch shifter. Fun for chipmunk / giant, not a studio-grade tuner.
  wireShift(ctx, dest, semitones) {
    const fade = 0.05;
    const ratio = 2 ** (semitones / 12);
    const rate = Math.abs(1 - ratio) / fade;
    const sign = ratio >= 1 ? 1 : -1;
    const delayA = ctx.createDelay(0.2);
    const delayB = ctx.createDelay(0.2);
    delayA.delayTime.value = fade;
    delayB.delayTime.value = fade;
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = Math.max(0.2, rate);
    const depth = ctx.createGain();
    depth.gain.value = sign * fade * 0.45;
    const invert = ctx.createGain();
    invert.gain.value = -1;
    this.wire(osc, depth);
    this.wire(depth, delayA.delayTime);
    this.wire(depth, invert);
    this.wire(invert, delayB.delayTime);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    this.wire(this.source, delayA);
    this.wire(delayA, gainA);
    this.wire(gainA, out);
    this.wire(this.source, delayB);
    this.wire(delayB, gainB);
    this.wire(gainB, out);
    this.wire(out, dest);
    gainA.gain.value = 0.7;
    gainB.gain.value = 0.7;
    this.start(osc);
    this.keep(delayA, delayB, gainA, gainB, osc, depth, invert, out);
  }
}

export const VOICE_PRESETS = PRESETS;

function distortCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}
