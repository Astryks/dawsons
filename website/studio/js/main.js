// Studio wiring: UI <-> audio engine.
import { getCtx, getMaster, resumeAudio, loadSample, decode, noteName } from "./audio.js";
import { KITS, kitById, ensureKit, playPad, PAD_KEYS, GM_TO_PAD } from "./kits.js";
import { INSTRUMENTS, instrumentById, createInstrument } from "./instruments.js";
import { Pads } from "./pads.js";
import { Piano, PIANO_KEYS } from "./piano.js";
import { connectMidi } from "./midi.js";
import { VoiceEngine, BEAT_TO_PAD } from "./voice.js";
import { LOOPS } from "./loops.js";
import { Timeline } from "./timeline.js";
import { encodeWav } from "../../js/wav-encoder.js";
import {
  state, hooks, onChange, changed, createTrack, selectedTrack, trackById, findClip, addAudioClip,
  addNotesClip, setTrackInstrument, setTrackKit, play, stop, record, seek, reprocess, fitLength,
  clipCycle, recordPad, recordNoteOn, recordNoteOff, renderMix, beat, grid, songEnd,
} from "./project.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let padKit = "acoustic";
let keysInstrument = "grand";
let keysMode = "drums";
let freeInst = null;
const voice = new VoiceEngine();

hooks.padKit = () => padKit;
hooks.keysInstrument = () => keysInstrument;
hooks.voice = voice;
hooks.micArmed = () => $("#mic-arm").checked;
hooks.status = (msg) => setStatus(msg);

// ------------------------------------------------------------------ utils

function setStatus(msg) {
  $("#status").textContent = msg || "";
}

let toastTimer = null;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

// ------------------------------------------------------------ selectors

function fillSelects() {
  const ks = $("#kit-select");
  ks.innerHTML = KITS.map((k) => `<option value="${k.id}">${k.name}</option>`).join("");
  const is = $("#inst-select");
  const groups = {};
  INSTRUMENTS.forEach((i) => (groups[i.group] = groups[i.group] || []).push(i));
  is.innerHTML = Object.entries(groups)
    .map(([g, list]) => `<optgroup label="${g}">${list.map((i) => `<option value="${i.id}">${i.name}</option>`).join("")}</optgroup>`)
    .join("");
  const ps = $("#cb-pitch");
  for (let st = -12; st <= 12; st++) ps.insertAdjacentHTML("beforeend", `<option value="${st}"${st === 0 ? " selected" : ""}>${st > 0 ? "+" : ""}${st} st</option>`);
}

// --------------------------------------------------------------- drums

const pads = new Pads($("#pads"), { onHit: (i, v) => hitPad(i, v) });

function liveDrumTarget() {
  const t = selectedTrack();
  if (t && t.kind === "drums") return { kitId: t.kitId, dest: t.nodes.input };
  return { kitId: padKit, dest: getMaster() };
}

async function hitPad(i, v = 0.9, ctxTime) {
  const c = await resumeAudio();
  const { kitId, dest } = liveDrumTarget();
  pads.flash(i);
  recordPad(i, Math.round(v * 127), ctxTime ?? c.currentTime, kitId);
  let bufs = null;
  try {
    bufs = await ensureKit(kitId);
  } catch {
    toast("Couldn't load that drum kit — check your connection");
    return;
  }
  playPad(c, kitId, i, c.currentTime, v, dest, bufs);
}

function showKit(kitId) {
  $("#kit-select").value = kitId;
  pads.setNames(kitById(kitId).pads.map((p) => p.name));
}

$("#kit-select").addEventListener("change", async (e) => {
  const id = e.target.value;
  const t = selectedTrack();
  if (t && t.kind === "drums") {
    setTrackKit(t, id);
    changed("all");
  } else padKit = id;
  showKit(id);
  setStatus(`Loading ${kitById(id).name}…`);
  try {
    await ensureKit(id);
    setStatus("");
  } catch {
    setStatus("Couldn't load kit");
  }
});

// ---------------------------------------------------------------- keys

const held = new Map(); // note -> stopFn
const piano = new Piano($("#piano"), {
  onDown: (n, v) => noteOn(n, v),
  onUp: (n) => noteOff(n),
});

function liveInstrument() {
  const t = selectedTrack();
  if (t && t.kind === "keys") return { inst: t.inst, id: t.instrumentId };
  if (!freeInst || freeInst.id !== keysInstrument) {
    try { freeInst?.inst.stop(); } catch { /* */ }
    const id = keysInstrument;
    const inst = createInstrument(getCtx(), id, getMaster(), (p) => setStatus(`Loading ${instrumentById(id).name}… ${p.loaded}/${p.total}`));
    inst.ready.then(() => setStatus(""), () => setStatus("Couldn't load samples — try another sound"));
    freeInst = { id, inst };
  }
  return freeInst;
}

async function noteOn(n, v = 100, ctxTime) {
  const c = await resumeAudio();
  if (held.has(n)) noteOff(n);
  const { inst, id } = liveInstrument();
  const stopFn = inst.start({ note: n, velocity: v, time: c.currentTime });
  held.set(n, stopFn);
  piano.highlight(n, true);
  recordNoteOn(n, v, ctxTime ?? c.currentTime, id);
}

function noteOff(n, ctxTime) {
  const stopFn = held.get(n);
  if (stopFn) {
    try { stopFn(); } catch { /* */ }
    held.delete(n);
  }
  piano.highlight(n, false);
  recordNoteOff(n, ctxTime ?? getCtx().currentTime);
}

function showInstrument(id) {
  $("#inst-select").value = id;
}

$("#inst-select").addEventListener("change", (e) => {
  const id = e.target.value;
  const t = selectedTrack();
  if (t && t.kind === "keys") {
    setTrackInstrument(t, id);
    changed("all");
  } else {
    keysInstrument = id;
    liveInstrument(); // start loading now
  }
});

function setOctave(o) {
  piano.setOctave(o);
  $("#oct-label").textContent = `Keys: ${noteName(piano.baseOctave * 12 + 12)}`;
}
$("#oct-down").onclick = () => setOctave(piano.baseOctave - 1);
$("#oct-up").onclick = () => setOctave(piano.baseOctave + 1);

// ------------------------------------------------------ computer keyboard

function setKeysMode(m) {
  keysMode = m;
  $("#km-drums").classList.toggle("is-on", m === "drums");
  $("#km-piano").classList.toggle("is-on", m === "piano");
  document.body.dataset.keys = m;
}
$("#km-drums").onclick = () => setKeysMode("drums");
$("#km-piano").onclick = () => setKeysMode("piano");
$("#pads").addEventListener("pointerdown", () => setKeysMode("drums"));
$("#piano").addEventListener("pointerdown", () => setKeysMode("piano"));

const keyNotes = new Map();
window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea") && e.target.type !== "range" && e.target.type !== "checkbox") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === " ") {
    e.preventDefault();
    if (!e.repeat) togglePlay();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (!e.repeat) record();
    return;
  }
  if (e.key === "Home") return seek(0);
  if ((e.key === "Delete" || e.key === "Backspace") && state.selectedClipId) {
    e.preventDefault();
    return deleteClip();
  }
  if (e.repeat) return;
  if (k === "z") return setOctave(piano.baseOctave - 1);
  if (k === "x") return setOctave(piano.baseOctave + 1);
  if (keysMode === "drums") {
    const i = PAD_KEYS.indexOf(k);
    if (i >= 0) {
      e.preventDefault();
      hitPad(i, e.shiftKey ? 1 : 0.85);
    }
  } else if (k in PIANO_KEYS) {
    e.preventDefault();
    const n = piano.baseOctave * 12 + 12 + PIANO_KEYS[k];
    keyNotes.set(k, n);
    noteOn(n, e.shiftKey ? 120 : 96);
  }
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " && !e.target.closest?.("input, select, textarea")) e.preventDefault();
  if (keyNotes.has(k)) {
    noteOff(keyNotes.get(k));
    keyNotes.delete(k);
  }
});
window.addEventListener("blur", () => [...held.keys()].forEach((n) => noteOff(n)));

// ------------------------------------------------------------------ MIDI

$("#btn-midi").onclick = async () => {
  await resumeAudio();
  connectMidi({
    onNoteOn: (n, v, ch) => {
      if (ch === 9 && GM_TO_PAD[n] !== undefined) hitPad(GM_TO_PAD[n], v / 127);
      else noteOn(n, v);
    },
    onNoteOff: (n, ch) => {
      if (ch !== 9) noteOff(n);
    },
    onStatus: (s) => ($("#midi-status").textContent = s),
  });
};

// ----------------------------------------------------------------- voice

const voiceNotes = new Map();
voice.onLevel = (rms) => {
  const pct = Math.min(100, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) * (100 / 54)));
  $("#mic-level").style.width = `${pct}%`;
};
voice.onPitch = (p) => {
  if (!p) return;
  $("#vm-note").textContent = noteName(p.note);
  const cents = Math.round((p.midiFloat - Math.round(p.midiFloat)) * 100);
  $("#vm-cents").textContent = ` ${cents >= 0 ? "+" : ""}${cents}¢`;
};
voice.onNoteOn = (n, v, t) => {
  const c = getCtx();
  const { inst, id } = liveInstrument();
  voiceNotes.set(n, inst.start({ note: n, velocity: v, time: c.currentTime }));
  piano.highlight(n, true);
  recordNoteOn(n, v, t - (voice.inputLatency || 0), id);
};
voice.onNoteOff = (n, t) => {
  const s = voiceNotes.get(n);
  if (s) { try { s(); } catch { /* */ } }
  voiceNotes.delete(n);
  piano.highlight(n, false);
  recordNoteOff(n, t - (voice.inputLatency || 0));
};
voice.onBeat = (cls, vel, t, training) => {
  $("#vm-hit").textContent = training ? `learning ${cls}…` : cls.toUpperCase();
  if (training) {
    $(`#tc-${cls}`).textContent = voice.trainedCount(cls);
    return;
  }
  hitPad(BEAT_TO_PAD[cls], vel / 127, t - (voice.inputLatency || 0));
};
voice.onTrainDone = (cls) => {
  $(`#tc-${cls}`).textContent = voice.trainedCount(cls);
  $$("[data-teach]").forEach((b) => b.classList.remove("is-on"));
  toast(`Got it — learned your ${cls} sound`);
};

$("#btn-mic").onclick = async () => {
  if (voice.isOpen) {
    voice.close();
    $("#btn-mic").textContent = "Enable mic";
    $("#btn-mic").classList.remove("is-on");
    $("#mic-arm").disabled = true;
    $("#mic-arm").checked = false;
    return;
  }
  try {
    await resumeAudio();
    await voice.open();
    $("#btn-mic").textContent = "Mic on";
    $("#btn-mic").classList.add("is-on");
    $("#mic-arm").disabled = false;
    toast("Mic is on. Pick “Sing → keys” or “Beatbox → drums”, or tick “Record my voice”.");
  } catch (err) {
    console.error(err);
    toast("Microphone unavailable — allow mic access in your browser settings.");
  }
};

$$("[data-vmode]").forEach((b) =>
  b.addEventListener("click", async () => {
    const mode = b.dataset.vmode;
    if (mode !== "off" && !voice.isOpen) await $("#btn-mic").onclick();
    if (mode !== "off" && !voice.isOpen) return;
    voice.releaseNote();
    voice.mode = mode;
    $$("[data-vmode]").forEach((x) => x.classList.toggle("is-on", x === b));
    $("#vm-melody").hidden = mode !== "melody";
    $("#vm-beatbox").hidden = mode !== "beatbox";
    if (mode === "beatbox") ensureKit(liveDrumTarget().kitId);
  })
);
$("#vm-scale").onchange = (e) => (voice.scale = e.target.value);
$("#vm-root").onchange = (e) => (voice.root = Number(e.target.value));
$("#vm-oct").onchange = (e) => (voice.octave = Number(e.target.value));
$("#vm-sens").oninput = (e) => (voice.sensitivity = Number(e.target.value));
$$("[data-teach]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!voice.isOpen) return toast("Enable the mic first");
    voice.train(b.dataset.teach, 4);
    $$("[data-teach]").forEach((x) => x.classList.toggle("is-on", x === b));
    toast(`Make your ${b.dataset.teach} sound 4 times, with a short gap between`);
  })
);
$("#teach-reset").onclick = () => {
  voice.clearTraining();
  ["kick", "snare", "hat"].forEach((c) => ($(`#tc-${c}`).textContent = "0"));
};

// ------------------------------------------------------------- transport

function togglePlay() {
  if (state.playing) stop();
  else play();
}
$("#btn-play").onclick = togglePlay;
$("#btn-rec").onclick = () => record();
$("#btn-home").onclick = () => seek(0);
$("#bpm").addEventListener("change", (e) => {
  state.bpm = Math.max(40, Math.min(220, Number(e.target.value) || 100));
  e.target.value = state.bpm;
  changed("all");
});
function toggleChip(id, key) {
  $(id).onclick = () => {
    state[key] = !state[key];
    $(id).classList.toggle("is-on", state[key]);
  };
}
toggleChip("#btn-metro", "metronome");
toggleChip("#btn-countin", "countIn");
toggleChip("#btn-snap", "snap");
toggleChip("#btn-quant", "quantize");

// ------------------------------------------------------------ tracks

$$("[data-add]").forEach((b) =>
  b.addEventListener("click", async () => {
    await resumeAudio();
    const kind = b.dataset.add;
    if (kind === "audio") return $("#file-input").click();
    const t = createTrack(kind);
    select(t.id, null);
    toast(kind === "drums" ? "Drum track selected — press ● and play the pads" : "Keys track selected — press ● and play the keyboard");
  })
);

function select(trackId, clipId) {
  state.selectedTrackId = trackId;
  state.selectedClipId = clipId;
  const t = trackById(trackId);
  if (t?.kind === "drums") showKit(t.kitId);
  else showKit(padKit);
  if (t?.kind === "keys") showInstrument(t.instrumentId);
  else showInstrument(keysInstrument);
  changed("all");
}

// ------------------------------------------------------------ audio import

async function importFiles(files, pos, trackId) {
  await resumeAudio();
  let start = pos ?? state.playhead;
  for (const f of files) {
    try {
      setStatus(`Decoding ${f.name}…`);
      const buf = await decode(await f.arrayBuffer());
      const t = pickAudioTrack(trackId, f.name);
      const clip = addAudioClip(t, buf, start, f.name.replace(/\.[^.]+$/, ""));
      select(t.id, clip.id);
      trackId = null;
      start = pos ?? state.playhead;
    } catch (e) {
      toast(`Couldn't read ${f.name} — try WAV, MP3, M4A or OGG`);
    }
  }
  setStatus("");
}

function pickAudioTrack(trackId, name) {
  const t = trackById(trackId) || selectedTrack();
  if (t && t.kind === "audio") return t;
  return createTrack("audio", { name: (name || "Audio").replace(/\.[^.]+$/, "").slice(0, 24) });
}

$("#file-input").addEventListener("change", (e) => {
  importFiles([...e.target.files]);
  e.target.value = "";
});

async function addLoop(path, pos, trackId) {
  const loop = LOOPS.find((l) => l.path === path);
  await resumeAudio();
  setStatus(`Loading ${loop?.name || "loop"}…`);
  try {
    const buf = await loadSample(path);
    const t = pickAudioTrack(trackId, loop?.name);
    const clip = addAudioClip(t, buf, pos ?? state.playhead, loop?.name || "Loop");
    clip.loop = true;
    clip.length = clipCycle(clip) * 4;
    select(t.id, clip.id);
    setStatus("");
    toast("Loop added ×4 — drag its right edge to make it longer");
  } catch {
    setStatus("");
    toast("Couldn't load that loop");
  }
}

// ----------------------------------------------------------- loop library

let preview = null;
function renderLibrary() {
  const byCat = {};
  LOOPS.forEach((l) => (byCat[l.cat] = byCat[l.cat] || []).push(l));
  $("#loop-list").innerHTML = Object.entries(byCat)
    .map(
      ([cat, list]) =>
        `<div class="loop-cat"><h4>${cat}</h4>${list
          .map(
            (l) =>
              `<div class="loop-item" draggable="true" data-path="${l.path}"><button class="chip" data-prev="${l.path}" title="Preview">▶</button><span>${l.name}</span><button class="chip" data-addloop="${l.path}" title="Add at playhead">+</button></div>`
          )
          .join("")}</div>`
    )
    .join("");
  $$(".loop-item").forEach((el) =>
    el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/x-dawsons-loop", el.dataset.path))
  );
  $$("[data-prev]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = await resumeAudio();
      try { preview?.stop(); } catch { /* */ }
      if (b.classList.contains("is-on")) {
        b.classList.remove("is-on");
        return;
      }
      $$("[data-prev]").forEach((x) => x.classList.remove("is-on"));
      const buf = await loadSample(b.dataset.prev);
      preview = c.createBufferSource();
      preview.buffer = buf;
      preview.connect(getMaster());
      preview.start();
      b.classList.add("is-on");
      preview.onended = () => b.classList.remove("is-on");
    })
  );
  $$("[data-addloop]").forEach((b) => b.addEventListener("click", () => addLoop(b.dataset.addloop)));
}
$("#btn-lib").onclick = () => {
  const lib = $("#loop-lib");
  lib.hidden = !lib.hidden;
  if (!lib.hidden && !$("#loop-list").children.length) renderLibrary();
};
$("#lib-close").onclick = () => ($("#loop-lib").hidden = true);

// ------------------------------------------------------------- clip bar

function sel() {
  return state.selectedClipId ? findClip(state.selectedClipId) : null;
}

function updateClipBar() {
  const f = sel();
  const bar = $("#clip-bar");
  bar.hidden = !f;
  if (!f) return;
  const { clip } = f;
  $("#cb-name").textContent = clip.name;
  bar.classList.toggle("is-audio", clip.kind === "audio");
  bar.classList.toggle("is-notes", clip.kind === "notes");
  $("#cb-loop").classList.toggle("is-on", clip.loop);
  $("#cb-gain").value = clip.gain;
  if (clip.kind === "audio") {
    $("#cb-reverse").classList.toggle("is-on", clip.reversed);
    $("#cb-rate").value = clip.rate;
    $("#cb-rate-o").textContent = `${clip.rate.toFixed(2)}×`;
    $("#cb-stretch").value = String(clip.stretch);
    $("#cb-pitch").value = String(clip.pitch);
  }
  $("#cb-tr-down").hidden = $("#cb-tr-up").hidden = f.track.kind !== "keys";
}

$("#cb-reverse").onclick = () => {
  const f = sel();
  if (!f || f.clip.kind !== "audio") return;
  f.clip.reversed = !f.clip.reversed;
  reprocess(f.clip);
};
$("#cb-rate").oninput = (e) => {
  const f = sel();
  if (!f) return;
  const c = f.clip;
  const oldCycle = clipCycle(c);
  c.rate = Number(e.target.value);
  if (c.loop) c.length = (c.length / oldCycle) * clipCycle(c);
  fitLength(c);
  $("#cb-rate-o").textContent = `${c.rate.toFixed(2)}×`;
  changed("clips");
};
$("#cb-stretch").onchange = (e) => {
  const f = sel();
  if (!f) return;
  const c = f.clip;
  const reps = c.loop ? c.length / clipCycle(c) : 1;
  c.stretch = Number(e.target.value);
  reprocess(c).then(() => {
    if (c.loop) c.length = reps * clipCycle(c);
    changed("clips");
  });
};
$("#cb-pitch").onchange = (e) => {
  const f = sel();
  if (!f) return;
  f.clip.pitch = Number(e.target.value);
  reprocess(f.clip);
};
$("#cb-fit").onclick = () => {
  const f = sel();
  if (!f || f.clip.kind !== "audio") return;
  const c = f.clip;
  const bar = beat() * 4;
  const natural = (c.srcLen / c.rate); // length at stretch 1
  let bars = Math.max(1, Math.round(natural / bar));
  // prefer 1, 2, 4, 8… bar loops
  const pow = Math.pow(2, Math.round(Math.log2(natural / bar)));
  if (Math.abs(pow * bar - natural) / natural < 0.3) bars = Math.max(1, pow);
  const reps = c.loop ? c.length / clipCycle(c) : 1;
  c.stretch = +((bars * bar * c.rate) / c.srcLen).toFixed(4);
  reprocess(c).then(() => {
    if (c.loop) c.length = Math.round(reps) * clipCycle(c);
    changed("clips");
    toast(`Fitted to ${bars} bar${bars > 1 ? "s" : ""} at ${state.bpm} BPM`);
  });
};
$("#cb-loop").onclick = () => {
  const f = sel();
  if (!f) return;
  const c = f.clip;
  c.loop = !c.loop;
  if (c.loop) c.length = clipCycle(c) * 4;
  else fitLength(c);
  changed("all");
  if (c.loop) toast("Looping ×4 — drag the right edge for more repeats");
};
$("#cb-gain").oninput = (e) => {
  const f = sel();
  if (!f) return;
  f.clip.gain = Number(e.target.value);
  changed("clips");
};
$("#cb-quant").onclick = () => {
  const f = sel();
  if (!f || f.clip.kind !== "notes") return;
  const g = grid();
  f.clip.notes.forEach((n) => (n.t = Math.max(0, Math.round(n.t / g) * g)));
  changed("all");
};
function transpose(d) {
  const f = sel();
  if (!f || f.clip.kind !== "notes" || f.track.kind !== "keys") return;
  f.clip.notes.forEach((n) => (n.n = Math.max(0, Math.min(127, n.n + d))));
  changed("all");
}
$("#cb-tr-down").onclick = () => transpose(-1);
$("#cb-tr-up").onclick = () => transpose(1);

$("#cb-split").onclick = () => {
  const f = sel();
  if (!f) return;
  const { clip, track } = f;
  const p = state.playhead;
  if (p <= clip.start + 0.02 || p >= clip.start + clip.length - 0.02) return toast("Move the playhead inside the clip to split it");
  if (clip.loop) return toast("Turn Loop off to split this clip");
  const leftLen = p - clip.start;
  if (clip.kind === "audio") {
    const leftSrc = (leftLen * clip.rate) / clip.stretch;
    const right = { ...clip, id: `c${Date.now()}` };
    if (clip.reversed) {
      right.srcLen = clip.srcLen - leftSrc;
      clip.srcOffset = clip.srcOffset + right.srcLen;
      clip.srcLen = leftSrc;
    } else {
      right.srcOffset = clip.srcOffset + leftSrc;
      right.srcLen = clip.srcLen - leftSrc;
      clip.srcLen = leftSrc;
    }
    right.start = p;
    fitLength(clip);
    fitLength(right);
    track.clips.push(right);
  } else {
    const right = {
      ...clip,
      id: `c${Date.now()}`,
      start: p,
      cycle: clip.cycle - leftLen,
      length: clip.cycle - leftLen,
      notes: clip.notes.filter((n) => n.t >= leftLen).map((n) => ({ ...n, t: n.t - leftLen })),
    };
    clip.notes = clip.notes.filter((n) => n.t < leftLen);
    clip.cycle = clip.length = leftLen;
    track.clips.push(right);
  }
  changed("all");
};
$("#cb-dup").onclick = () => {
  const f = sel();
  if (!f) return;
  const { clip, track } = f;
  const copy = { ...clip, id: `c${Date.now()}`, start: clip.start + clip.length };
  if (clip.notes) copy.notes = clip.notes.map((n) => ({ ...n }));
  track.clips.push(copy);
  select(track.id, copy.id);
};
function deleteClip() {
  const f = sel();
  if (!f) return;
  f.track.clips = f.track.clips.filter((c) => c !== f.clip);
  state.selectedClipId = null;
  changed("all");
}
$("#cb-del").onclick = deleteClip;

// --------------------------------------------------------------- starter

$("#btn-starter").onclick = async () => {
  await resumeAudio();
  const t = createTrack("drums", { kitId: padKit });
  const b = beat();
  const notes = [];
  for (let i = 0; i < 16; i++) {
    const at = (i * b) / 2;
    notes.push({ t: at, n: 6, v: i % 2 ? 70 : 100, d: 0.1 }); // hats on 8ths
  }
  [0, 2.5, 4, 6.5].forEach((beatPos) => notes.push({ t: beatPos * b, n: 12, v: 120, d: 0.1 }));
  [1, 3, 5, 7].forEach((beatPos) => notes.push({ t: beatPos * b, n: 14, v: 110, d: 0.1 }));
  const clip = addNotesClip(t, notes, 0, 8 * b, "Starter beat");
  clip.loop = true;
  clip.length = clip.cycle * 4;
  select(t.id, clip.id);
  toast("Starter beat added — press ▶, then play along on the keys");
};

// ---------------------------------------------------------------- export

$("#btn-export").onclick = async () => {
  if (songEnd() <= 0) return toast("Nothing to export yet — record or add a clip first");
  const btn = $("#btn-export");
  btn.disabled = true;
  btn.textContent = "Rendering…";
  try {
    const buf = await renderMix();
    const blob = new Blob([encodeWav(buf)], { type: "audio/wav" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mydawsons-mix-${new Date().toISOString().slice(0, 10)}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    toast(`Exported ${buf.duration.toFixed(1)} s WAV`);
  } catch (e) {
    console.error(e);
    toast(e.message || "Export failed");
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Export WAV";
  }
};

// -------------------------------------------------------------- timeline

const timeline = new Timeline($("#timeline"), {
  onSelect: (tid, cid) => select(tid, cid),
  onDropFiles: (files, pos, tid) => importFiles(files, pos, tid),
  onDropLoop: (path, pos, tid) => addLoop(path, pos, tid),
});
$("#zoom-in").onclick = () => {
  state.zoom = Math.min(400, state.zoom * 1.4);
  changed("all");
};
$("#zoom-out").onclick = () => {
  state.zoom = Math.max(10, state.zoom / 1.4);
  changed("all");
};

function renderTransport() {
  $("#btn-play").textContent = state.playing ? "■" : "▶";
  $("#btn-play").classList.toggle("is-on", state.playing);
  $("#btn-play").setAttribute("aria-label", state.playing ? "Stop" : "Play");
  $("#btn-rec").classList.toggle("is-on", state.recording);
  document.body.classList.toggle("is-recording", state.recording);
}

function renderTime() {
  $("#time-main").textContent = state.countingIn ? "count-in" : fmtTime(state.playhead);
  const b = beat();
  const totalBeats = Math.floor(state.playhead / b + 1e-6);
  $("#time-bars").textContent = `${Math.floor(totalBeats / 4) + 1}.${(totalBeats % 4) + 1}`;
}

onChange((what) => {
  if (what === "playhead") {
    timeline.renderPlayhead();
    renderTime();
    return;
  }
  if (what === "transport") {
    renderTransport();
    timeline.render();
    return;
  }
  timeline.render();
  updateClipBar();
  renderTransport();
  renderTime();
});

window.addEventListener("beforeunload", (e) => {
  if (state.tracks.some((t) => t.clips.length)) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ------------------------------------------------------------------ boot

fillSelects();
showKit(padKit);
showInstrument(keysInstrument);
setOctave(4);
setKeysMode("drums");
changed("all");
// Preload the default kit (decoding works before the first user gesture).
ensureKit(padKit).catch(() => {});
// Unlock audio on the first interaction anywhere.
window.addEventListener("pointerdown", () => resumeAudio(), { once: true });
window.addEventListener("keydown", () => resumeAudio(), { once: true });
window.__studio = { state, voice };
