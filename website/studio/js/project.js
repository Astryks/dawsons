// Project model + transport: tracks, clips, look-ahead scheduler,
// recording and mute/solo. Timeline positions are in seconds; the BPM
// drives the grid, snapping, quantize and the metronome.

import { getCtx, getMaster, click, resumeAudio } from "./audio.js";
import { ensureKit, loadKit, playPad, kitById } from "./kits.js";
import { createInstrument, instrumentById } from "./instruments.js";
import { processClipBuffer } from "./clipfx.js";

export const state = {
  bpm: 100,
  tracks: [],
  selectedTrackId: null,
  selectedClipId: null,
  playhead: 0,
  playing: false,
  recording: false,
  countingIn: false,
  metronome: false,
  countIn: true,
  snap: true,
  quantize: false,
  zoom: 70, // px per second
};

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
}
export function changed(what = "all") {
  listeners.forEach((fn) => fn(what));
}

// Hooks main.js fills in (current pad kit, keyboard instrument, voice engine).
export const hooks = {
  padKit: () => "acoustic",
  keysInstrument: () => "grand",
  voice: null,
  micArmed: () => false,
  status: () => {},
};

let seq = 1;
const uid = (p) => `${p}${seq++}`;
const COLORS = ["#ff7a59", "#ffc145", "#5ce1a9", "#4cc9f0", "#a78bfa", "#f472b6", "#94e36b", "#ff9f1c"];

export const beat = () => 60 / state.bpm;
export const grid = () => beat() / 4;
export const snapT = (t) => (state.snap ? Math.round(t / grid()) * grid() : t);

// ---------------------------------------------------------------- tracks

function buildNodes(c, track, dest) {
  const input = c.createGain();
  const vol = c.createGain();
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  const mute = c.createGain();
  vol.gain.value = track.volume;
  if (pan) pan.pan.value = track.pan;
  input.connect(vol);
  if (pan) vol.connect(pan).connect(mute);
  else vol.connect(mute);
  mute.connect(dest);
  return { input, vol, pan, mute };
}

export function createTrack(kind, opts = {}) {
  const c = getCtx();
  const n = state.tracks.filter((t) => t.kind === kind).length + 1;
  const track = {
    id: uid("t"),
    kind,
    name: opts.name || (kind === "drums" ? "Drums" : kind === "keys" ? "Keys" : "Audio") + (n > 1 ? ` ${n}` : ""),
    color: COLORS[state.tracks.length % COLORS.length],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    clips: [],
    kitId: opts.kitId || (kind === "drums" ? hooks.padKit() : null),
    instrumentId: opts.instrumentId || (kind === "keys" ? hooks.keysInstrument() : null),
  };
  track.nodes = buildNodes(c, track, getMaster());
  if (kind === "keys") setTrackInstrument(track, track.instrumentId);
  if (kind === "drums") ensureKit(track.kitId);
  state.tracks.push(track);
  applyMuteSolo();
  return track;
}

export function setTrackInstrument(track, id) {
  track.instrumentId = id;
  try { track.inst?.stop(); } catch { /* */ }
  track.inst = createInstrument(getCtx(), id, track.nodes.input, (p) =>
    hooks.status(`Loading ${instrumentById(id).name}… ${p.loaded}/${p.total}`)
  );
  track.inst.ready.then(() => hooks.status(""), () => hooks.status("Couldn't load instrument samples"));
}

export function setTrackKit(track, kitId) {
  track.kitId = kitId;
  ensureKit(kitId);
}

export function removeTrack(id) {
  const t = trackById(id);
  if (!t) return;
  try { t.inst?.stop(); } catch { /* */ }
  t.nodes.mute.disconnect();
  state.tracks = state.tracks.filter((x) => x.id !== id);
  if (state.selectedTrackId === id) state.selectedTrackId = null;
  applyMuteSolo();
}

export const trackById = (id) => state.tracks.find((t) => t.id === id);
export const selectedTrack = () => trackById(state.selectedTrackId);

export function findClip(id) {
  for (const t of state.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return { track: t, clip: c };
  }
  return null;
}

export function audible(track) {
  const anySolo = state.tracks.some((t) => t.solo);
  return !track.mute && (!anySolo || track.solo);
}

export function applyMuteSolo() {
  const c = getCtx();
  state.tracks.forEach((t) => {
    t.nodes.mute.gain.setTargetAtTime(audible(t) ? 1 : 0, c.currentTime, 0.01);
    t.nodes.vol.gain.setTargetAtTime(t.volume, c.currentTime, 0.01);
    if (t.nodes.pan) t.nodes.pan.pan.setTargetAtTime(t.pan, c.currentTime, 0.01);
  });
}

// ----------------------------------------------------------------- clips

export function addAudioClip(track, buffer, start, name = "Clip") {
  const clip = {
    id: uid("c"),
    kind: "audio",
    name,
    start: Math.max(0, start),
    src: buffer,
    buf: buffer,
    srcOffset: 0,
    srcLen: buffer.duration,
    reversed: false,
    stretch: 1,
    pitch: 0,
    reverbWet: 0,
    reverbRoom: 0.5,
    rate: 1,
    loop: false,
    length: buffer.duration,
    gain: 1,
  };
  track.clips.push(clip);
  return clip;
}

export function addNotesClip(track, notes, start, length, name) {
  const clip = {
    id: uid("c"),
    kind: "notes",
    name: name || (track.kind === "drums" ? kitById(track.kitId).name : instrumentById(track.instrumentId).name),
    start: Math.max(0, start),
    cycle: Math.max(0.25, length),
    length: Math.max(0.25, length),
    loop: false,
    notes,
    gain: 1,
  };
  track.clips.push(clip);
  return clip;
}

export function clipCycle(clip) {
  if (clip.kind === "notes") return clip.cycle;
  return (clip.srcLen * clip.stretch) / clip.rate;
}

export function bufOffset(clip) {
  const srcDur = clip.src.duration;
  return (clip.reversed ? srcDur - clip.srcOffset - clip.srcLen : clip.srcOffset) * clip.stretch;
}

export function fitLength(clip) {
  if (!clip.loop) clip.length = clipCycle(clip);
  else clip.length = Math.max(clip.length, clipCycle(clip) * 0.25);
}

export async function reprocess(clip) {
  clip.processing = true;
  changed("clips");
  const oldCycle = clipCycle(clip);
  clip.buf = await processClipBuffer(clip.src, clip);
  clip.processing = false;
  if (clip.loop) clip.length = Math.max(clip.length, clipCycle(clip) * 0.25);
  else fitLength(clip);
  if (!clip.loop && oldCycle !== clipCycle(clip)) fitLength(clip);
  changed("clips");
}

export function songEnd() {
  let end = 0;
  state.tracks.forEach((t) => t.clips.forEach((c) => (end = Math.max(end, c.start + c.length))));
  return end;
}

// Calls cb for every event of `clip` whose onset lies in [from, to).
// With `underway`, audio segments already sounding at `from` are included
// (started mid-way) — used for the first window after pressing play.
export function clipEvents(clip, from, to, underway, cb) {
  const end = clip.start + clip.length;
  if (end <= from || clip.start >= to) return;
  const cycle = clipCycle(clip);
  if (cycle <= 0.001) return;
  const kStart = Math.max(0, Math.floor((from - clip.start) / cycle) - 1);
  for (let k = kStart; ; k++) {
    const cs = clip.start + k * cycle;
    if (cs >= to || cs >= end) break;
    const ce = Math.min(cs + cycle, end);
    if (clip.kind === "audio") {
      if (cs >= from && cs < to) {
        cb({ at: cs, offset: bufOffset(clip), dur: (ce - cs) * clip.rate });
      } else if (underway && cs < from && ce > from) {
        cb({ at: from, offset: bufOffset(clip) + (from - cs) * clip.rate, dur: (ce - from) * clip.rate });
      }
    } else {
      for (const n of clip.notes) {
        const at = cs + n.t;
        if (at >= ce) continue;
        if (at >= from && at < to) cb({ at, note: n.n, vel: n.v, dur: Math.min(n.d ?? 0.2, ce - at) });
      }
    }
  }
}

// Schedules one track's events in [from, to) on context `c`.
// env: { toCtx(pos), sources:Set, inst, kitBufs, dest }
export function scheduleTrack(c, track, from, to, underway, env) {
  for (const clip of track.clips) {
    if (clip.processing) continue;
    clipEvents(clip, from, to, underway, (ev) => {
      const when = env.toCtx(ev.at);
      if (clip.kind === "audio") {
        const s = c.createBufferSource();
        s.buffer = clip.buf;
        s.playbackRate.value = clip.rate;
        const g = c.createGain();
        g.gain.value = clip.gain;
        s.connect(g).connect(env.dest);
        const dur = Math.max(0.001, Math.min(ev.dur, clip.buf.duration - ev.offset));
        s.start(Math.max(when, c.currentTime), Math.max(0, ev.offset), dur);
        env.sources?.add(s);
        s.onended = () => env.sources?.delete(s);
      } else if (track.kind === "drums") {
        const s = playPad(c, track.kitId, ev.note, when, (ev.vel / 127) * clip.gain, env.dest, env.kitBufs);
        if (s) {
          env.sources?.add(s);
          s.onended = () => env.sources?.delete(s);
        }
      } else if (env.inst) {
        env.inst.start({ note: ev.note, velocity: Math.min(127, ev.vel * clip.gain), time: when, duration: ev.dur });
      }
    });
  }
}

// -------------------------------------------------------------- transport

let timer = null;
let raf = null;
let T0 = 0; // context time at which position === startPos
let startPos = 0;
let schedFrom = 0;
let firstWindow = true;
let nextBeat = 0;
const sources = new Set();
const LOOKAHEAD = 0.2;

export const posAt = (ctxTime) => startPos + (ctxTime - T0);
export const ctxAt = (pos) => T0 + (pos - startPos);

export async function play({ countIn = false } = {}) {
  if (state.playing) return;
  const c = await resumeAudio();
  // make sure drum kits used by tracks are decoded before we schedule
  await Promise.all(state.tracks.filter((t) => t.kind === "drums").map((t) => ensureKit(t.kitId)));
  startPos = state.playhead;
  const bar = beat() * 4;
  const lead = countIn ? bar : 0;
  T0 = c.currentTime + 0.08 + lead;
  if (countIn) {
    state.countingIn = true;
    for (let i = 0; i < 4; i++) click(c, getMaster(), T0 - bar + i * beat(), i === 0);
  }
  schedFrom = startPos;
  firstWindow = true;
  nextBeat = Math.ceil(startPos / beat() - 1e-6);
  state.playing = true;
  tick();
  timer = setInterval(tick, 25);
  const frame = () => {
    const pos = posAt(c.currentTime);
    state.countingIn = pos < startPos;
    state.playhead = Math.max(startPos, pos);
    changed("playhead");
    if (!state.recording && state.playhead > songEnd() + 0.6 && songEnd() > 0) {
      stop();
      state.playhead = startPos;
      changed("playhead");
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  changed("transport");
}

function tick() {
  const c = getCtx();
  const to = posAt(c.currentTime + LOOKAHEAD);
  if (to <= schedFrom) return;
  for (const t of state.tracks) {
    scheduleTrack(c, t, schedFrom, to, firstWindow, {
      toCtx: ctxAt,
      sources,
      inst: t.inst,
      dest: t.nodes.input,
    });
  }
  if (state.metronome) {
    while (nextBeat * beat() < to) {
      const p = nextBeat * beat();
      if (p >= schedFrom - 1e-6) click(c, getMaster(), ctxAt(p), nextBeat % 4 === 0);
      nextBeat++;
    }
  } else {
    nextBeat = Math.ceil(to / beat());
  }
  schedFrom = to;
  firstWindow = false;
}

export function stop() {
  if (!state.playing) return;
  clearInterval(timer);
  cancelAnimationFrame(raf);
  const c = getCtx();
  sources.forEach((s) => { try { s.stop(); } catch { /* */ } });
  sources.clear();
  state.tracks.forEach((t) => { try { t.inst?.stop(); } catch { /* */ } });
  state.playing = false;
  state.countingIn = false;
  if (state.recording) finishRecording(posAt(c.currentTime));
  changed("transport");
}

export function seek(pos) {
  const was = state.playing;
  if (was) stop();
  state.playhead = Math.max(0, pos);
  changed("playhead");
  if (was) play();
}

// -------------------------------------------------------------- recording

let take = null;

export async function record() {
  if (state.recording) {
    stop();
    return;
  }
  const c = await resumeAudio();
  const mic = hooks.micArmed() && hooks.voice?.isOpen;
  take = { pads: [], keys: [], open: new Map(), mic, startPos: state.playhead, kitId: null, instrumentId: null };
  state.recording = true;
  if (state.playing) {
    take.startPos = posAt(c.currentTime);
    take.T0 = ctxAt(take.startPos);
  } else {
    await play({ countIn: state.countIn });
    take.startPos = startPos;
    take.T0 = T0;
  }
  if (mic) hooks.voice.startRecording();
  changed("transport");
}

function takePos(ctxTime) {
  return Math.max(take.startPos, posAt(ctxTime ?? getCtx().currentTime));
}

export function recordPad(pad, vel, ctxTime, kitId) {
  if (!state.recording || !take) return;
  take.kitId = take.kitId || kitId;
  take.pads.push({ t: takePos(ctxTime), n: pad, v: vel, d: 0.1 });
}

export function recordNoteOn(note, vel, ctxTime, instrumentId) {
  if (!state.recording || !take) return;
  take.instrumentId = take.instrumentId || instrumentId;
  const ev = { t: takePos(ctxTime), n: note, v: vel, d: 0.2 };
  take.keys.push(ev);
  take.open.set(note, ev);
}

export function recordNoteOff(note, ctxTime) {
  if (!state.recording || !take) return;
  const ev = take.open.get(note);
  if (ev) {
    ev.d = Math.max(0.05, takePos(ctxTime) - ev.t);
    take.open.delete(note);
  }
}

function quantizeNotes(notes) {
  const g = grid();
  notes.forEach((n) => (n.t = Math.max(0, Math.round(n.t / g) * g)));
}

async function finishRecording(endPos) {
  const tk = take;
  take = null;
  state.recording = false;
  if (!tk) return;
  const length = Math.max(beat(), endPos - tk.startPos);
  const rel = (list) => list.map((e) => ({ ...e, t: e.t - tk.startPos }));
  const sel = selectedTrack();

  if (tk.pads.length) {
    let track = sel && sel.kind === "drums" ? sel : null;
    if (!track) track = createTrack("drums", { kitId: tk.kitId || hooks.padKit() });
    const notes = rel(tk.pads);
    if (state.quantize) quantizeNotes(notes);
    addNotesClip(track, notes, tk.startPos, length);
  }
  if (tk.keys.length) {
    tk.open.forEach((ev) => (ev.d = Math.max(0.05, endPos - ev.t)));
    let track = sel && sel.kind === "keys" ? sel : null;
    if (!track) track = createTrack("keys", { instrumentId: tk.instrumentId || hooks.keysInstrument() });
    const notes = rel(tk.keys);
    if (state.quantize) quantizeNotes(notes);
    addNotesClip(track, notes, tk.startPos, length);
  }
  if (tk.mic) {
    const res = await hooks.voice.stopRecording();
    if (res && res.buffer.duration > 0.2) {
      const lat = hooks.voice.latency();
      let start = tk.startPos + (res.startTime - tk.T0) - lat;
      let buffer = res.buffer;
      if (start < tk.startPos) {
        // drop the count-in / pre-roll part
        const cut = Math.round((tk.startPos - start) * buffer.sampleRate);
        if (cut < buffer.length) {
          const c = getCtx();
          const b2 = c.createBuffer(1, buffer.length - cut, buffer.sampleRate);
          b2.copyToChannel(buffer.getChannelData(0).subarray(cut), 0);
          buffer = b2;
        }
        start = tk.startPos;
      }
      const n = state.tracks.filter((t) => t.kind === "audio" && t.name.startsWith("Vocal")).length + 1;
      const track = createTrack("audio", { name: `Vocal ${n}` });
      addAudioClip(track, buffer, start, "Mic take");
    }
  }
  changed("all");
}

export function isRecording() {
  return state.recording;
}

// ---------------------------------------------------------------- export

export async function renderMix() {
  const end = songEnd();
  if (end <= 0) throw new Error("Nothing to export yet — record or add a clip first.");
  const sr = 44100;
  const tail = 2;
  const off = new OfflineAudioContext(2, Math.ceil((end + tail) * sr), sr);
  const bus = off.createDynamicsCompressor();
  bus.threshold.value = -3;
  bus.ratio.value = 20;
  bus.attack.value = 0.002;
  bus.release.value = 0.1;
  const masterGain = off.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(bus).connect(off.destination);
  for (const t of state.tracks) {
    if (!audible(t) || !t.clips.length) continue;
    const nodes = buildNodes(off, t, masterGain);
    const env = { toCtx: (p) => p, dest: nodes.input };
    if (t.kind === "keys") {
      env.inst = createInstrument(off, t.instrumentId, nodes.input);
      await env.inst.ready;
    }
    if (t.kind === "drums") env.kitBufs = await loadKit(t.kitId);
    scheduleTrack(off, t, 0, end + 0.001, true, env);
  }
  return off.startRendering();
}
