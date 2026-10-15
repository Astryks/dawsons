// Studio wiring: UI <-> audio engine.
import { getCtx, getMaster, resumeAudio, loadSample, decode, noteName } from "./audio.js";
import { KITS, kitById, ensureKit, playPad, GM_TO_PAD } from "./kits.js";
import { INSTRUMENTS, instrumentById, createInstrument } from "./instruments.js";
import { Pads } from "./pads.js";
import { Piano } from "./piano.js";
import { getLayout, saveLayout, padLabels, pianoLabels, resolveKey } from "./keymap.js";
import { snapshotSoon, snapshotNow, undo, redo, canUndo, canRedo, historyHooks, loadSaved, clearSaved, resetHistory } from "./store.js";
import { FX_DEFS, FX_ORDER, CHAIN_PRESETS, applyPreset, applyChainPreset, fxSummary } from "./fx.js";
import { fetchAudioUrl, startTabCapture, canCaptureTab, ImportError } from "./importers.js";
import { bufferToNotes } from "./pitch.js";
import { connectMidi } from "./midi.js";
import { VoiceEngine, BEAT_TO_PAD } from "./voice.js";
import { LOOPS } from "./loops.js";
import { Timeline } from "./timeline.js";
import { encodeWav } from "../../js/wav-encoder.js";
import {
  state, hooks, onChange, changed, createTrack, selectedTrack, trackById, findClip, addAudioClip,
  addNotesClip, setTrackInstrument, setTrackKit, play, stop, record, seek, reprocess, fitLength,
  clipCycle, recordPad, recordNoteOn, recordNoteOff, renderMix, beat, grid, songEnd,
  rebuildFx, applyMasterFx, newId, removeTrack, bufOffset,
} from "./project.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let padKit = "acoustic";
let keysInstrument = "grand";
let keysMode = "drums";
let layout = getLayout();
let voiceInstrumentId = "vlead";
let voiceInst = null;
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
function toast(msg, ms = 3200, action) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = action.label;
    b.onclick = () => {
      t.hidden = true;
      action.run();
    };
    t.append(" ", b);
  }
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
  $("#vm-inst").innerHTML = is.innerHTML + `<optgroup label="Drums"><option value="__drums">Drums — beatbox mode</option></optgroup>`;
  $("#vm-inst").value = voiceInstrumentId;
  $("#fx-chain").innerHTML = `<option value="">Choose…</option>` + Object.keys(CHAIN_PRESETS).map((n) => `<option>${n}</option>`).join("");
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

function applyLayout(l) {
  layout = l;
  saveLayout(l);
  pads.setKeys(padLabels(l));
  piano.setHints(pianoLabels(l));
  $("#keysmode").hidden = l !== "classic";
  document.body.dataset.layout = l;
  $("#pads-hint").innerHTML =
    l === "classic"
      ? `Classic keys: <kbd>1</kbd>–<kbd>6</kbd> · <kbd>Q</kbd>–<kbd>Y</kbd> · <kbd>A</kbd>–<kbd>H</kbd> (switch “Computer keys play” above). Tap lower on a pad to hit harder.`
      : `Left hand drums: <kbd>Q</kbd>–<kbd>Y</kbd> · <kbd>A</kbd>–<kbd>G</kbd> <kbd>\`</kbd> · <kbd>Z</kbd>–<kbd>N</kbd>. Right hand piano: <kbd>H</kbd>–<kbd>'</kbd> (+<kbd>U</kbd> <kbd>I</kbd> <kbd>P</kbd> <kbd>[</kbd> <kbd>]</kbd>), octave <kbd>,</kbd> <kbd>.</kbd> — both at once. Hold <kbd>Shift</kbd> to hit harder.`;
  $("#oct-down").title = `Octave down (${l === "classic" ? "Z" : ","})`;
  $("#oct-up").title = `Octave up (${l === "classic" ? "X" : "."})`;
}

const keyNotes = new Map();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeOverlays();
  if (e.target.closest?.("input, select, textarea") && !["range", "checkbox", "radio"].includes(e.target.type)) return;
  if (!$("#modal").hidden && e.key !== "Escape") return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    return e.shiftKey ? doRedo() : doUndo();
  }
  if (mod && !e.altKey && e.key.toLowerCase() === "y") {
    e.preventDefault();
    return doRedo();
  }
  if (e.key === "Escape") return closeOverlays();
  if (mod || e.altKey) return;
  if (e.key === "?") {
    e.preventDefault();
    return showHelp();
  }
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
  const act = resolveKey(e, layout, keysMode);
  if (!act) return;
  e.preventDefault();
  if (e.repeat) return;
  if (act.type === "octave") return setOctave(piano.baseOctave + act.d);
  if (act.type === "pad") return hitPad(act.index, e.shiftKey ? 1 : 0.85);
  if (act.type === "note") {
    const n = piano.baseOctave * 12 + 12 + act.offset;
    keyNotes.set(act.id, n);
    noteOn(n, e.shiftKey ? 120 : 96);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " " && !e.target.closest?.("input, select, textarea")) e.preventDefault();
  for (const id of [e.code, e.key.toLowerCase()]) {
    if (keyNotes.has(id)) {
      noteOff(keyNotes.get(id));
      keyNotes.delete(id);
    }
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
  if (!p) {
    $("#tuner-needle").style.opacity = 0.25;
    return;
  }
  $("#vm-note").textContent = noteName(Math.round(p.midiFloat));
  const cents = Math.round((p.midiFloat - Math.round(p.midiFloat)) * 100);
  $("#vm-cents").textContent = ` ${cents >= 0 ? "+" : ""}${cents}¢`;
  const needle = $("#tuner-needle");
  needle.style.opacity = 1;
  needle.style.left = `${50 + cents}%`;
  needle.classList.toggle("is-tuned", Math.abs(cents) < 8);
};
// The instrument your voice plays. If a Keys track is selected, voice
// plays (and records onto) that track; otherwise its own "Play as" sound.
function voiceTarget() {
  const t = selectedTrack();
  if (t && t.kind === "keys") return { inst: t.inst, id: t.instrumentId };
  if (!voiceInst || voiceInst.id !== voiceInstrumentId) {
    try { voiceInst?.inst.stop(); } catch { /* */ }
    const id = voiceInstrumentId;
    const inst = createInstrument(getCtx(), id, getMaster(), (p) => setStatus(`Loading ${instrumentById(id).name}… ${p.loaded}/${p.total}`));
    inst.ready.then(() => setStatus(""), () => setStatus("Couldn't load samples — try another sound"));
    voiceInst = { id, inst };
  }
  return voiceInst;
}
voice.onNoteOn = (n, v, t, cents) => {
  const c = getCtx();
  const { inst, id } = voiceTarget();
  voiceNotes.set(n, inst.start({ note: n, velocity: v, time: c.currentTime, detune: voice.glide ? cents : 0 }));
  piano.highlight(n, true);
  recordNoteOn(n, v, t - (voice.inputLatency || 0), id);
};
voice.onBend = (n, cents) => voiceNotes.get(n)?.bend?.(cents);
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
    if (mode === "melody") voiceTarget();
    $$("[data-vmode]").forEach((x) => x.classList.toggle("is-on", x === b));
    $("#vm-melody").hidden = mode !== "melody";
    $("#vm-beatbox").hidden = mode !== "beatbox";
    if (mode === "beatbox") ensureKit(liveDrumTarget().kitId);
  })
);
$("#vm-inst").onchange = (e) => {
  if (e.target.value === "__drums") {
    e.target.value = voiceInstrumentId;
    return $('[data-vmode="beatbox"]').click();
  }
  voiceInstrumentId = e.target.value;
  voice.releaseNote();
  voiceTarget();
};
$("#vm-glide").onchange = (e) => (voice.glide = e.target.checked);
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
    const st = $("#cb-stretch");
    st.querySelector("[data-custom]")?.remove();
    if (![...st.options].some((o) => Number(o.value) === clip.stretch)) {
      st.insertAdjacentHTML("beforeend", `<option data-custom value="${clip.stretch}">${clip.stretch.toFixed(2)}</option>`);
    }
    st.value = [...st.options].find((o) => Number(o.value) === clip.stretch).value;
    $("#cb-pitch").value = String(clip.pitch);
    $("#cb-reverb").value = String(Math.round((clip.reverbWet || 0) * 100));
    $("#cb-reverb-o").textContent = `${Math.round((clip.reverbWet || 0) * 100)}%`;
  }
  $("#cb-tr-down").hidden = $("#cb-tr-up").hidden = f.track.kind !== "keys";
  bar.classList.toggle("is-drums", clip.kind === "notes" && f.track.kind === "drums");
  if (clip.kind === "audio") {
    const opts = [...$("#cb-fade").options].map((o) => Number(o.value));
    const fv = Math.max(clip.fadeIn || 0, clip.fadeOut || 0);
    $("#cb-fade").value = String(opts.reduce((a, b) => (Math.abs(b - fv) < Math.abs(a - fv) ? b : a), 0));
  }
}

function reverseClip(id) {
  const f = id ? findClip(id) : sel();
  if (!f || f.clip.kind !== "audio") return;
  f.clip.reversed = !f.clip.reversed;
  reprocess(f.clip);
  toast(f.clip.reversed ? "Reversed ⇆" : "Playing forwards again");
}
$("#cb-reverse").onclick = () => reverseClip();
$("#cb-fade").onchange = (e) => {
  const f = sel();
  if (!f) return;
  const v = Math.min(Number(e.target.value), f.clip.length / 2.2);
  f.clip.fadeIn = f.clip.fadeOut = v;
  changed("all");
};
$("#cb-steps").onclick = () => openSteps();
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
$("#cb-reverb").oninput = (e) => {
  $("#cb-reverb-o").textContent = `${e.target.value}%`;
};
$("#cb-reverb").onchange = (e) => {
  const f = sel();
  if (!f || f.clip.kind !== "audio") return;
  f.clip.reverbWet = Number(e.target.value) / 100;
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
    const right = { ...clip, id: newId("c") };
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
      id: newId("c"),
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
  const copy = { ...clip, id: newId("c"), start: clip.start + clip.length };
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
  onClipMenu: (id, x, y) => openClipMenu(id, x, y),
  onOpenFx: (tid) => openFx(tid),
  onReverse: (id) => reverseClip(id),
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
  if (!$("#step-panel").hidden) renderSteps();
  $("#bpm").value = state.bpm;
  snapshotSoon();
});

// ------------------------------------------------------------------ boot

fillSelects();
showKit(padKit);
showInstrument(keysInstrument);
setOctave(4);
setKeysMode("drums");
applyLayout(layout);
changed("all");
loadSaved()
  .then((rec) => {
    if (!rec) return;
    $("#bpm").value = state.bpm;
    changed("all");
    resetHistory();
    updateUndo();
    toast("Welcome back — your last session was restored.", 6000, { label: "Start new", run: newProject });
  })
  .catch((e) => console.warn("No autosave available", e))
  .finally(() => {
    if (!localStorage.getItem("studio.toured")) setTimeout(startTour, 600);
  });
// Preload the default kit (decoding works before the first user gesture).
ensureKit(padKit).catch(() => {});
// Unlock audio on the first interaction anywhere.
window.addEventListener("pointerdown", () => resumeAudio(), { once: true });
window.addEventListener("keydown", () => resumeAudio(), { once: true });
window.__studio = { state, voice, undo: doUndo, redo: doRedo, openClipMenu, openFx, startTour, showHelp, convertClipToNotes, addAudioFromBuffer };

// =================================================================== v2

// ---------------------------------------------------------- undo / redo

function updateUndo() {
  $("#btn-undo").disabled = !canUndo();
  $("#btn-redo").disabled = !canRedo();
}
function doUndo() {
  if (undo()) toast("Undone", 1200);
  updateUndo();
}
function doRedo() {
  if (redo()) toast("Redone", 1200);
  updateUndo();
}
$("#btn-undo").onclick = doUndo;
$("#btn-redo").onclick = doRedo;
historyHooks.onRestore = () => {
  changed("all");
  updateUndo();
};
historyHooks.onSaved = () => {
  updateUndo();
  $("#save-state").textContent = "✓ saved";
  $("#save-state").title = `Autosaved in this browser at ${new Date().toLocaleTimeString()}`;
};
function newProject() {
  if (state.playing) stop();
  [...state.tracks].forEach((t) => removeTrack(t.id));
  state.selectedClipId = null;
  state.selectedTrackId = null;
  clearSaved().catch(() => {});
  changed("all");
  snapshotNow();
}

// ----------------------------------------------------------- tap tempo

let taps = [];
$("#btn-tap").onclick = () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  if (taps.length >= 3) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    state.bpm = Math.round(Math.max(40, Math.min(220, 60000 / avg)));
    changed("all");
    $("#btn-tap").textContent = `Tap ${state.bpm}`;
  } else $("#btn-tap").textContent = "Tap…";
};

// --------------------------------------------------------------- import

function addAudioFromBuffer(buffer, name, pos, trackId) {
  const t = pickAudioTrack(trackId, name);
  const clip = addAudioClip(t, buffer, pos ?? state.playhead, name);
  select(t.id, clip.id);
  return clip;
}

$("#btn-url").onclick = () => {
  $("#import-bar").hidden = !$("#import-bar").hidden;
  if (!$("#import-bar").hidden) $("#url-input").focus();
};
$("#url-close").onclick = () => ($("#import-bar").hidden = true);
$("#url-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await resumeAudio();
  const st = $("#url-status");
  st.classList.remove("is-error");
  try {
    const { buffer, name } = await fetchAudioUrl($("#url-input").value, { onStatus: (m) => (st.textContent = m) });
    addAudioFromBuffer(buffer, name.slice(0, 40));
    st.textContent = `Added “${name}” (${buffer.duration.toFixed(1)} s) at the playhead.`;
    $("#url-input").value = "";
  } catch (err) {
    st.classList.add("is-error");
    st.textContent = err instanceof ImportError ? err.message : `Couldn't import: ${err.message || err}`;
  }
});

let capture = null;
let captureTimer = null;
$("#btn-tab").onclick = async () => {
  if (capture) return;
  await resumeAudio();
  if (!canCaptureTab()) return toast("This browser can't record tab audio — try Chrome or Edge on a computer.", 5000);
  const pos = state.playhead;
  try {
    capture = await startTabCapture({
      onLevel: (rms) => {
        const pct = Math.min(100, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) * (100 / 54)));
        $("#tab-level").style.width = `${pct}%`;
      },
      onEnded: () => finishCapture(),
    });
  } catch (err) {
    capture = null;
    return toast(err.message || "Capture failed", 6000);
  }
  capture.pos = pos;
  const t0 = performance.now();
  $("#tab-bar").hidden = false;
  captureTimer = setInterval(() => ($("#tab-time").textContent = fmtTime((performance.now() - t0) / 1000)), 200);
  toast("Recording the tab you shared — press Stop when you're done.");
};
async function finishCapture() {
  if (!capture) return;
  const cap = capture;
  capture = null;
  clearInterval(captureTimer);
  $("#tab-bar").hidden = true;
  try {
    const { buffer } = await cap.stop();
    addAudioFromBuffer(buffer, "Tab capture", cap.pos);
    toast(`Added ${buffer.duration.toFixed(1)} s from the tab`);
  } catch (err) {
    toast(err.message || "Couldn't save the capture", 5000);
  }
}
$("#tab-stop").onclick = finishCapture;

// drop audio files anywhere on the page (the timeline handles its own drops)
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (e.defaultPrevented || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  importFiles([...e.dataTransfer.files]);
});

// ------------------------------------------------------------ clip menu

const menu = $("#clip-menu");
function openClipMenu(id, x, y) {
  const f = findClip(id);
  if (!f) return;
  const { clip, track } = f;
  const items = [];
  const it = (label, run, opts = {}) => items.push({ label, run, ...opts });
  if (clip.kind === "audio") {
    it(clip.reversed ? "⇆ Un-reverse" : "⇆ Reverse", () => reverseClip(id));
    it("🐢 Half speed (tape)", () => setRate(clip, 0.5));
    it("⏩ Normal speed", () => setRate(clip, 1));
    it("📏 Fit to tempo", () => $("#cb-fit").click());
    it("◢ Fade in + out", () => { clip.fadeIn = clip.fadeOut = Math.min(0.5, clip.length / 4); changed("all"); });
    it("🎤→🎹 Convert voice to instrument notes", () => convertClipToNotes(id));
  } else {
    it("🧲 Quantize", () => $("#cb-quant").click());
    if (track.kind === "drums") it("▦ Edit steps", () => openSteps());
  }
  it(clip.loop ? "↻ Stop looping" : "↻ Loop", () => $("#cb-loop").click());
  it("✂ Split at playhead", () => $("#cb-split").click());
  it("⧉ Duplicate", () => $("#cb-dup").click());
  it(`🎛 Track effects…`, () => openFx(track.id));
  it("🗑 Delete", () => deleteClip(), { danger: true });
  menu.innerHTML = "";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "menuitem";
    b.className = item.danger ? "is-danger" : "";
    b.textContent = item.label;
    b.onclick = () => {
      closeMenu();
      state.selectedClipId = id;
      state.selectedTrackId = track.id;
      item.run();
    };
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.querySelector("button")?.focus();
}
function closeMenu() {
  menu.hidden = true;
}
window.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
});
function setRate(c, r) {
  const oldCycle = clipCycle(c);
  c.rate = r;
  if (c.loop) c.length = (c.length / oldCycle) * clipCycle(c);
  fitLength(c);
  changed("all");
}
function closeOverlays() {
  closeMenu();
  $("#modal").hidden = true;
  if (!$("#tour").hidden) endTour();
}

// ------------------------------------------- vocal clip -> instrument notes

async function convertClipToNotes(id) {
  const f = findClip(id);
  if (!f || f.clip.kind !== "audio") return;
  const { clip } = f;
  if (clip.processing) return toast("Wait for the clip to finish processing");
  setStatus("Listening to the clip… 0%");
  const inst = voiceInstrumentId;
  try {
    // analyse the part of the buffer the clip actually plays
    const off = bufOffset(clip);
    const dur = Math.min(clip.buf.duration - off, clipCycle(clip) * clip.rate);
    const c = getCtx();
    const sr = clip.buf.sampleRate;
    const seg = c.createBuffer(clip.buf.numberOfChannels, Math.max(1, Math.floor(dur * sr)), sr);
    for (let ch = 0; ch < seg.numberOfChannels; ch++) seg.copyToChannel(clip.buf.getChannelData(ch).subarray(Math.floor(off * sr), Math.floor((off + dur) * sr)), ch);
    const snap = (m) => voice.snap(m) + voice.octave * 12;
    const notes = await bufferToNotes(seg, { snap, gate: Math.max(0.004, voice.gate * 0.8), onProgress: (p) => setStatus(`Listening to the clip… ${Math.round(p * 100)}%`) });
    setStatus("");
    if (!notes.length) return toast("Couldn't hear a clear melody in that clip — try a dry, one-note-at-a-time vocal.", 5000);
    notes.forEach((n) => {
      n.t /= clip.rate;
      n.d /= clip.rate;
    });
    const t = createTrack("keys", { instrumentId: inst, name: `${clip.name.slice(0, 16)} → ${instrumentById(inst).name.split(" (")[0]}` });
    const nc = addNotesClip(t, notes, clip.start, clipCycle(clip));
    if (clip.loop) {
      nc.loop = true;
      nc.length = clip.length;
    }
    select(t.id, nc.id);
    toast(`Made ${notes.length} notes on a new ${instrumentById(inst).name} track. Change the sound with the 🎹 menu.`, 5000);
  } catch (err) {
    console.error(err);
    setStatus("");
    toast("Conversion failed");
  }
}

// ------------------------------------------------------------ effects UI

let fxTarget = null; // track id, or "master"
function openFx(tid) {
  fxTarget = tid;
  closeMenu();
  $("#fx-panel").hidden = false;
  renderFx();
  $("#fx-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
$("#btn-master").onclick = () => openFx("master");
$("#fx-close").onclick = () => ($("#fx-panel").hidden = true);

function fmtParam(v, unit) {
  if (unit === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  if (unit === "s") return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (unit === "dB") return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (unit === ":1") return `${v.toFixed(1)}:1`;
  return `${Math.round(v * 100)}%`;
}

function renderFx() {
  const list = $("#fx-list");
  if (fxTarget === "master") {
    $("#fx-title").textContent = "Master bus";
    $("#fx-chain").parentElement.hidden = true;
    const m = state.master;
    list.innerHTML = `
      <div class="fx-card${m.reverb.on ? " is-on" : ""}" data-m="reverb">
        <div class="fx-card__head"><label class="switch"><input type="checkbox" ${m.reverb.on ? "checked" : ""} data-mon="reverb"/> Master reverb</label></div>
        ${slider("size", 0.3, 8, m.reverb.size, "s", "data-mp=reverb")}${slider("mix", 0, 0.6, m.reverb.mix, "", "data-mp=reverb")}
        <p class="hint">A shared room around the whole mix.</p></div>
      <div class="fx-card${m.limiter.on ? " is-on" : ""}" data-m="limiter">
        <div class="fx-card__head"><label class="switch"><input type="checkbox" ${m.limiter.on ? "checked" : ""} data-mon="limiter"/> Limiter</label></div>
        ${slider("ceiling", -12, 0, m.limiter.ceiling, "dB", "data-mp=limiter")}${slider("volume", 0, 1.5, m.volume, "", "data-mp=_")}
        <p class="hint">Stops the mix clipping. Applies to playback and export.</p></div>`;
    list.querySelectorAll("[data-mon]").forEach((el) => (el.onchange = () => {
      m[el.dataset.mon].on = el.checked;
      applyMasterFx();
      renderFx();
      changed("fx");
      snapshotSoon();
    }));
    list.querySelectorAll("input[type=range]").forEach((el) => (el.oninput = () => {
      const grp = el.dataset.mp;
      const v = Number(el.value);
      if (grp === "_") m.volume = v;
      else m[grp][el.dataset.p] = v;
      el.nextElementSibling.textContent = fmtParam(v, el.dataset.unit);
      clearTimeout(renderFx.t);
      renderFx.t = setTimeout(applyMasterFx, 120);
      snapshotSoon();
    }));
    return;
  }
  const t = trackById(fxTarget);
  if (!t) {
    $("#fx-panel").hidden = true;
    return;
  }
  $("#fx-title").textContent = t.name;
  $("#fx-chain").parentElement.hidden = false;
  $("#fx-chain").value = "";
  list.innerHTML = FX_ORDER.map((k) => {
    const def = FX_DEFS[k];
    const p = t.fx[k];
    return `<div class="fx-card${p.on ? " is-on" : ""}" data-fx="${k}">
      <div class="fx-card__head"><label class="switch"><input type="checkbox" ${p.on ? "checked" : ""} data-on/> ${def.name}</label>
        <select data-preset aria-label="${def.name} preset"><option value="">Preset…</option>${Object.keys(def.presets).map((n) => `<option${p.preset === n ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      ${def.types ? `<label class="fx-row">Type <select data-type>${def.types.map((ty) => `<option${p.type === ty ? " selected" : ""}>${ty}</option>`).join("")}</select></label>` : ""}
      ${Object.entries(def.params).map(([name, [min, max, , unit]]) => slider(name, min, max, p[name], unit)).join("")}
    </div>`;
  }).join("");
  list.querySelectorAll(".fx-card").forEach((card) => {
    const k = card.dataset.fx;
    const p = t.fx[k];
    const commit = (rerender) => {
      rebuildFx(t);
      if (rerender) renderFx();
      changed("fx");
      timeline.render();
      snapshotSoon();
    };
    card.querySelector("[data-on]").onchange = (e) => {
      p.on = e.target.checked;
      commit(true);
    };
    card.querySelector("[data-preset]").onchange = (e) => {
      applyPreset(t.fx, k, e.target.value, state.bpm);
      commit(true);
    };
    const ty = card.querySelector("[data-type]");
    if (ty) ty.onchange = () => { p.type = ty.value; p.on = true; commit(true); };
    card.querySelectorAll("input[type=range]").forEach((el) => {
      el.oninput = () => {
        p[el.dataset.p] = Number(el.value);
        p.preset = "";
        el.nextElementSibling.textContent = fmtParam(Number(el.value), el.dataset.unit);
        if (!p.on) {
          p.on = true;
          card.classList.add("is-on");
          card.querySelector("[data-on]").checked = true;
        }
        clearTimeout(card._t);
        card._t = setTimeout(() => commit(false), 90);
      };
    });
  });
}
function slider(name, min, max, v, unit, extra = "") {
  const step = unit === "Hz" ? 1 : (max - min) / 200;
  return `<label class="fx-row"><span>${name}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-p="${name}" data-unit="${unit}" ${extra}/><output>${fmtParam(Number(v), unit)}</output></label>`;
}
$("#fx-chain").onchange = (e) => {
  const t = trackById(fxTarget);
  if (!t || !e.target.value) return;
  applyChainPreset(t.fx, e.target.value, state.bpm);
  rebuildFx(t);
  renderFx();
  changed("all");
  toast(`${e.target.value} on ${t.name}`);
};

// ------------------------------------------------------- step sequencer

function stepClip() {
  const f = sel();
  return f && f.clip.kind === "notes" && f.track.kind === "drums" ? f : null;
}
function openSteps() {
  if (!stepClip()) return toast("Select a drum clip first (or press “Give me a starter beat”)");
  $("#step-panel").hidden = false;
  renderSteps();
  $("#step-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
$("#step-close").onclick = () => ($("#step-panel").hidden = true);
$("#step-clear").onclick = () => {
  const f = stepClip();
  if (!f) return;
  f.clip.notes = [];
  changed("all");
};
function renderSteps() {
  const f = stepClip();
  const grid_ = $("#step-grid");
  if (!f) {
    grid_.innerHTML = `<p class="hint">Select a drum clip to edit its steps.</p>`;
    return;
  }
  const { clip, track } = f;
  const g = grid();
  const steps = Math.min(64, Math.max(4, Math.round(clip.cycle / g)));
  $("#step-info").textContent = `${clip.name} · ${steps} steps (1/16) · click to add/remove hits`;
  const names = kitById(track.kitId).pads.map((p) => p.name);
  const on = new Set();
  clip.notes.forEach((n) => on.add(`${n.n}:${Math.round(n.t / g)}`));
  // most-used rows first: kicks/snares, hats, toms
  const order = [12, 13, 14, 15, 16, 17, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];
  let html = `<div class="step-grid__inner" style="--steps:${steps}">`;
  for (const pad of order) {
    html += `<div class="step-row"><button class="step-name" data-audition="${pad}">${names[pad]}</button>`;
    for (let i = 0; i < steps; i++) {
      html += `<button class="step${on.has(`${pad}:${i}`) ? " is-on" : ""}${i % 4 === 0 ? " is-beat" : ""}" data-pad="${pad}" data-step="${i}" aria-label="${names[pad]} step ${i + 1}"></button>`;
    }
    html += `</div>`;
  }
  grid_.innerHTML = html + "</div>";
  grid_.querySelectorAll("[data-audition]").forEach((b) => (b.onclick = () => hitPad(Number(b.dataset.audition), 0.9)));
  grid_.querySelectorAll(".step").forEach((b) =>
    (b.onclick = () => {
      const pad = Number(b.dataset.pad);
      const i = Number(b.dataset.step);
      const idx = clip.notes.findIndex((n) => n.n === pad && Math.round(n.t / g) === i);
      if (idx >= 0) clip.notes.splice(idx, 1);
      else {
        clip.notes.push({ t: i * g, n: pad, v: i % 4 === 0 ? 115 : 95, d: 0.1 });
        hitPad(pad, 0.8);
      }
      changed("all");
    })
  );
}

// ---------------------------------------------------- help / settings

function modal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal").hidden = false;
  $("#modal-close").focus();
}
$("#modal-close").onclick = () => ($("#modal").hidden = true);
$("#modal").addEventListener("pointerdown", (e) => {
  if (e.target.id === "modal") $("#modal").hidden = true;
});

function showHelp() {
  const compact = layout === "compact";
  const k = (x) => `<kbd>${x}</kbd>`;
  modal("Keyboard shortcuts", `
    <div class="help-grid">
      <section><h3>Play</h3>
        ${compact ? `<p>Drums (left hand): ${["Q W E R T Y", "A S D F G `", "Z X C V B N"].map((r) => r.split(" ").map(k).join("")).join("<br>")}</p>
        <p>Piano (right hand): white ${"H J K L ; '".split(" ").map(k).join("")} ${k("\\")}<br>black ${"U I P [ ]".split(" ").map(k).join("")}<br>octave ${k(",")} ${k(".")}</p>`
        : `<p>Drums: ${k("1")}–${k("6")} ${k("Q")}–${k("Y")} ${k("A")}–${k("H")}<br>Piano: ${k("A")} ${k("W")} ${k("S")} ${k("E")} ${k("D")}… octave ${k("Z")} ${k("X")}<br>Switch with “Computer keys play”.</p>`}
        <p>${k("Shift")} + key = harder hit</p></section>
      <section><h3>Transport</h3>
        <p>${k("Space")} play / stop<br>${k("Enter")} record<br>${k("Home")} back to start</p>
        <h3>Edit</h3>
        <p>${k("Ctrl/⌘")}+${k("Z")} undo · ${k("Ctrl/⌘")}+${k("Shift")}+${k("Z")} redo<br>${k("Delete")} delete clip<br>Right-click / long-press a clip: clip menu<br>Drag a clip edge: trim or repeat<br>${k("Alt/⌥")}+drag an edge: time-stretch<br>Drag the top corners: fades<br>${k("Esc")} close menus · ${k("?")} this help</p></section>
    </div>
    <div class="row"><button class="btn btn--accent" id="help-tour">Take the 30-second tour</button></div>`);
  $("#help-tour").onclick = () => {
    $("#modal").hidden = true;
    startTour();
  };
}
$("#btn-help").onclick = showHelp;

$("#btn-settings").onclick = () => {
  modal("Settings", `
    <h3>Computer-keyboard layout</h3>
    <label class="check"><input type="radio" name="kl" value="compact" ${layout === "compact" ? "checked" : ""}/> <b>Compact (new)</b> — drums on the left hand, piano on the right, both at once</label>
    <label class="check"><input type="radio" name="kl" value="classic" ${layout === "classic" ? "checked" : ""}/> <b>Classic</b> — 1–6 / Q–Y / A–H pads or A W S E D piano, with a Drums/Piano switch</label>
    <h3>Project</h3>
    <p class="hint">Your project autosaves in this browser (IndexedDB). Clearing site data deletes it — export a WAV to keep a copy.</p>
    <div class="row"><button class="chip chip--danger" id="set-new">Start a new empty project</button></div>`);
  $$('input[name="kl"]').forEach((r) => (r.onchange = () => {
    applyLayout(r.value);
    toast(r.value === "compact" ? "Compact layout: drums left hand, piano right hand" : "Classic layout");
  }));
  $("#set-new").onclick = () => {
    if (!confirm("Start a new project? Undo can bring the old one back until you close the tab.")) return;
    $("#modal").hidden = true;
    newProject();
  };
};

// ------------------------------------------------------------------ tour

const TOUR = [
  ["#pads", "Tap the pads — or play them from your keyboard. Every pad shows its key."],
  ["#piano", "The piano is on your right hand (H J K L ; '), so you can drum and play keys at the same time."],
  ["#btn-rec", "Press ● (or Enter) to record what you play onto the timeline."],
  ["#voice-panel", "Sing or hum into any instrument, or beatbox into the drums."],
  [".st-arrange__bar", "Bring sound in: upload or drop files, paste a link, record a tab, or use the free loop library."],
  ["#timeline", "Right-click (or long-press) a clip for reverse, fades and more. Alt/Option-drag an edge to stretch. Each track's FX button opens effects."],
  ["#btn-help", "Press ? any time for shortcuts. Everything autosaves in this browser."],
];
let tourIdx = -1;
function startTour() {
  tourIdx = 0;
  $("#tour").hidden = false;
  showTourStep();
}
function showTourStep() {
  const [selq, text] = TOUR[tourIdx];
  const el = $(selq);
  if (!el) return nextTour();
  el.scrollIntoView({ block: "nearest" });
  const r = el.getBoundingClientRect();
  const ring = $(".tour__ring");
  Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  $("#tour-text").textContent = text;
  $("#tour-step").textContent = `${tourIdx + 1} / ${TOUR.length}`;
  $("#tour-next").textContent = tourIdx === TOUR.length - 1 ? "Let's go" : "Next";
  const b = $(".tour__bubble");
  const bh = 150;
  const below = r.bottom + bh + 16 < innerHeight;
  b.style.top = `${below ? r.bottom + 14 : Math.max(8, r.top - bh - 14)}px`;
  b.style.left = `${Math.max(8, Math.min(innerWidth - 340, r.left))}px`;
}
function nextTour() {
  tourIdx++;
  if (tourIdx >= TOUR.length) return endTour();
  showTourStep();
}
function endTour() {
  $("#tour").hidden = true;
  tourIdx = -1;
  try { localStorage.setItem("studio.toured", "1"); } catch { /* */ }
}
$("#tour-next").onclick = nextTour;
$("#tour-skip").onclick = endTour;
window.addEventListener("resize", () => tourIdx >= 0 && showTourStep());
