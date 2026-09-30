// Shared Web Audio plumbing for the Studio: one AudioContext, a master
// bus with a gentle limiter, sample loading, and small helpers.

let ctx = null;
let master = null;
let limiter = null;

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(limiter).connect(ctx.destination);
  }
  return ctx;
}

export function getMaster() {
  getCtx();
  return master;
}

export async function resumeAudio() {
  const c = getCtx();
  if (c.state !== "running") {
    try { await c.resume(); } catch { /* ignored: needs a user gesture */ }
  }
  return c;
}

// Vorbis in Ogg decodes everywhere except older Safari; every vendored
// sample ships as .ogg and .m4a so we can pick whichever this browser
// actually decodes.
let preferredExt = null;
export function sampleExt() {
  if (preferredExt) return preferredExt;
  const a = document.createElement("audio");
  preferredExt = a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
  return preferredExt;
}

const bufferCache = new Map();
export function loadSample(path) {
  // path: relative to studio/samples, no extension
  const url = new URL(`../samples/${path}.${sampleExt()}`, import.meta.url).href;
  return loadUrl(url);
}

export function loadUrl(url) {
  if (!bufferCache.has(url)) {
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.arrayBuffer();
      })
      .then((ab) => decode(ab));
    p.catch(() => bufferCache.delete(url));
    bufferCache.set(url, p);
  }
  return bufferCache.get(url);
}

export function decode(arrayBuffer) {
  const c = getCtx();
  return new Promise((resolve, reject) => {
    // Safari still wants the callback form.
    const res = c.decodeAudioData(arrayBuffer, resolve, reject);
    if (res && res.then) res.then(resolve, reject);
  });
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function noteName(m) {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function cloneBuffer(buf, c = getCtx()) {
  const out = c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch), ch);
  return out;
}

// Plays a short metronome click at `time`.
export function click(c, dest, time, accent) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  o.connect(g).connect(dest);
  o.start(time);
  o.stop(time + 0.08);
}
