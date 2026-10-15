// Project model + transport: tracks, clips, look-ahead scheduler,
// recording and mute/solo. Timeline positions are in seconds; the BPM
// drives the grid, snapping, quantize and the metronome.

import { getCtx, getMaster, click, resumeAudio, setMasterFx } from "./audio.js";
import { buildChain, buildMaster, defaultFx, defaultMaster } from "./fx.js";
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
  master: defaultMaster(),
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
  const chain = buildChain(c, track.fx, input, vol);
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  const mute = c.createGain();
  vol.gain.value = track.volume;
  if (pan) pan.pan.value = track.pan;
  if (pan) vol.connect(pan).connect(mute);
  else vol.connect(mute);
  mute.connect(dest);
  return { input, vol, pan, mute, chain };
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
    fx: opts.fx || defaultFx(),
  };
  if (opts.id) track.id = opts.id;
  if (opts.color) track.color = opts.color;
  track.nodes = buildNodes(c, track, getMaster());
  if (kind === "keys") setTrackInstrument(track, track.instrumentId);
  if (kind === "drums") ensureKit(track.kitId);
  state.tracks.push(track);
  applyMuteSolo();
  return track;
}

// Re-wires a track's effect chain after its fx settings changed.
export function rebuildFx(track) {
  const c = getCtx();
  track.nodes.chain?.dispose();
  track.nodes.chain = buildChain(c, track.fx, track.nodes.input, track.nodes.vol);
}

export function applyMasterFx() {
  setMasterFx(state.master);
}

export function setTrackInstrument(track, id) {
  track.instrumentId = id;
  track._instId = id;
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
  t.nodes.chain?.dispose();
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
    rate: 1,
    loop: false,
    length: buffer.duration,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
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

// Clip volume envelope (fade in/out, short de-click ramps) for the part of
// the clip between timeline positions a..b.
export function fadeGainAt(clip, pos) {
  const fi = Math.max(0.003, clip.fadeIn || 0);
  const fo = Math.max(0.003, clip.fadeOut || 0);
  const x = pos - clip.start;
  const end = clip.length;
  let g = 1;
  if (x < fi) g = Math.min(g, Math.max(0, x / fi));
  if (x > end - fo) g = Math.min(g, Math.max(0, (end - x) / fo));
  return g * clip.gain;
}
function applyFades(param, clip, a, b, toCtx) {
  param.setValueAtTime(fadeGainAt(clip, a), toCtx(a));
  const pts = [clip.start + Math.max(0.003, clip.fadeIn || 0), clip.start + clip.length - Math.max(0.003, clip.fadeOut || 0), b];
  pts.sort((x, y) => x - y);
  for (const p of pts) {
    if (p <= a || p > b + 1e-6) continue;
    param.linearRampToValueAtTime(fadeGainAt(clip, p), toCtx(p));
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
        const dur = Math.max(0.001, Math.min(ev.dur, clip.buf.duration - ev.offset));
        const t0 = Math.max(when, c.currentTime);
        applyFades(g.gain, clip, ev.at + (t0 - when), ev.at + dur / clip.rate, env.toCtx);
        s.connect(g).connect(env.dest);
        s.start(t0, Math.max(0, ev.offset), dur);
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
  const tail = 2 + (state.master.reverb?.on ? state.master.reverb.size : 0);
  const off = new OfflineAudioContext(2, Math.ceil((end + tail) * sr), sr);
  const masterBus = buildMaster(off, state.master, off.destination);
  const masterGain = masterBus.input;
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

// ------------------------------------------------- save / undo snapshots
// Audio buffers are referenced by id so snapshots stay small; the
// registry keeps every buffer a snapshot might need.

const bufIds = new WeakMap();
export const buffers = new Map(); // id -> AudioBuffer
let bufSeq = 1;
export function bufferId(buf) {
  if (!buf) return null;
  let id = bufIds.get(buf);
  if (!id) {
    id = `b${Date.now().toString(36)}${bufSeq++}`;
    bufIds.set(buf, id);
    buffers.set(id, buf);
  }
  return id;
}
export function registerBuffer(id, buf) {
  bufIds.set(buf, id);
  buffers.set(id, buf);
}

const TRACK_KEYS = ["id", "kind", "name", "color", "volume", "pan", "mute", "solo", "kitId", "instrumentId", "fx"];

export function serialize() {
  return {
    v: 2,
    bpm: state.bpm,
    master: state.master,
    tracks: state.tracks.map((t) => {
      const o = {};
      TRACK_KEYS.forEach((k) => (o[k] = t[k]));
      o.clips = t.clips.map((c) => {
        const { src, buf, processing, ...rest } = c;
        if (c.kind === "audio") {
          rest.srcId = bufferId(src);
          rest.bufId = bufferId(buf);
        }
        return rest;
      });
      return o;
    }),
  };
}

// Restores a snapshot, reusing live track objects (and their loaded
// instruments) where the id matches.
export function restore(snap) {
  const c = getCtx();
  if (state.playing) stop();
  state.bpm = snap.bpm || 100;
  state.master = snap.master || defaultMaster();
  applyMasterFx();
  const old = new Map(state.tracks.map((t) => [t.id, t]));
  const next = [];
  const toProcess = [];
  for (const st of snap.tracks || []) {
    let t = old.get(st.id);
    const fx = JSON.parse(JSON.stringify(st.fx || defaultFx()));
    if (t && t.kind === st.kind) {
      old.delete(st.id);
      TRACK_KEYS.forEach((k) => k !== "fx" && (t[k] = st[k]));
      t.fx = fx;
      rebuildFx(t);
      if (t.kind === "keys" && t.inst && t._instId !== st.instrumentId) setTrackInstrument(t, st.instrumentId);
    } else {
      t = { ...st, fx, clips: [] };
      t.nodes = buildNodes(c, t, getMaster());
      if (t.kind === "keys") setTrackInstrument(t, t.instrumentId);
      if (t.kind === "drums") ensureKit(t.kitId).catch(() => {});
    }
    t.clips = (st.clips || []).map((sc) => {
      const clip = JSON.parse(JSON.stringify(sc));
      if (clip.kind === "audio") {
        clip.src = buffers.get(sc.srcId);
        clip.buf = buffers.get(sc.bufId);
        delete clip.srcId;
        delete clip.bufId;
        if (!clip.src) return null;
        if (!clip.buf) {
          clip.buf = clip.src;
          if (clip.reversed || clip.stretch !== 1 || clip.pitch) toProcess.push(clip);
        }
      }
      return clip;
    }).filter(Boolean);
    next.push(t);
  }
  old.forEach((t) => {
    try { t.inst?.stop(); } catch { /* */ }
    try { t.nodes.mute.disconnect(); } catch { /* */ }
    t.nodes.chain?.dispose();
  });
  state.tracks = next;
  // keep new ids unique after loading
  next.forEach((t) => t.clips.forEach((cl) => bumpSeq(cl.id)));
  next.forEach((t) => bumpSeq(t.id));
  if (!trackById(state.selectedTrackId)) state.selectedTrackId = null;
  if (state.selectedClipId && !findClip(state.selectedClipId)) state.selectedClipId = null;
  applyMuteSolo();
  toProcess.forEach((cl) => reprocess(cl));
}
function bumpSeq(id) {
  const n = Number(String(id).replace(/^\D+/, ""));
  if (Number.isFinite(n) && n >= seq) seq = n + 1;
}
export const newId = (p) => uid(p);
