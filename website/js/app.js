import { Engine } from "./audio-engine.js";
import { DEMO_SONGS } from "./demo-songs.js";
import { renderVoice } from "./synth.js";
import { reverseBuffer, pitchShiftBuffer, trimBuffer, buildEffectChain } from "./effects.js";
import { detectNotes, snapNotesToScale, MAJOR_SCALE, MINOR_SCALE } from "./pitch.js";
import { STARTERS } from "./starter-patterns.js";
import { paletteFor, soundLabel, createPattern, toggleStep, autoFillEveryBeats, setBpm, rebuildBuffer } from "./pattern-editor.js";
import { instrumentIconSvg, uiIconSvg } from "./instrument-icons.js";
import { audioBufferToBase64Wav, base64WavToAudioBuffer, encodeWav } from "./wav-encoder.js";

const engine = new Engine();
let currentSong = null;
let uploadedBuffer = null;
let uploadedName = "";
let playheadTimer = null;
// Which track's row is open in the left sidebar's sound picker, and
// which sound from its palette is currently "armed" to place on tap.
let activeTrackIndex = null;
let armedSound = null;
// Whether the GarageBand-style instrument browser is open in the
// timeline, and the current text in its search box.
let instrumentBrowserOpen = false;
let instrumentSearchQuery = "";
// Tempo, in beats per minute. Only genuinely retimes pattern-backed
// tracks (drums/bass/keys/guitar/any custom pattern track), since their
// audio is synthesized fresh from step data — see pattern-editor.js's
// setBpm. Plain recorded/uploaded/demo-song audio layers keep their
// original tempo; this is a real, disclosed scope limit (see the BPM
// input's title tooltip), not a bug.
let currentBpm = 120;

// --- Undo / redo ---
// A snapshot is a lightweight description of engine.tracks, not a deep
// clone of everything: AudioBuffers are immutable once rendered, so
// it's safe (and cheap) to keep a reference to the exact buffer a track
// had at snapshot time — only pattern.hits actually needs a real copy,
// since toggleStep/autoFillEveryBeats mutate that array in place.
const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];

function snapshotTracks() {
  return engine.tracks.map((t) => ({
    name: t.name,
    buffer: t.buffer,
    muted: t.muted,
    solo: t.solo,
    pan: t.pan,
    pitchSemitones: t.pitchSemitones,
    reverbWet: t.reverbWet,
    delayWet: t.delayWet,
    originalBuffer: t.originalBuffer,
    pattern: t.pattern
      ? { family: t.pattern.family, hits: t.pattern.hits.map((h) => ({ ...h })), totalSteps: t.pattern.totalSteps }
      : null,
  }));
}

function restoreSnapshot(snapshot) {
  engine.stop();
  engine.restoreTracks(snapshot);
}

// pushUndo() must run BEFORE a mutation, capturing the state being left
// behind — the standard "undo restores what came before this action"
// contract. Any fresh action clears redoStack: redo only makes sense
// immediately after an undo, not after the timeline has since changed.
function pushUndo() {
  undoStack.push(snapshotTracks());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function handleUndo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotTracks());
  restoreSnapshot(undoStack.pop());
  activeTrackIndex = null;
  renderTrackList();
  renderTimeline();
  renderSoundPicker();
  updateUndoRedoButtons();
}

function handleRedo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotTracks());
  restoreSnapshot(redoStack.pop());
  activeTrackIndex = null;
  renderTrackList();
  renderTimeline();
  renderSoundPicker();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.key.toLowerCase() !== "z") return;
  e.preventDefault();
  if (e.shiftKey) handleRedo();
  else handleUndo();
});

// The four instruments always ready to go the moment the page loads —
// tap any step, hear it immediately. Everything else is one tap away
// behind "+".
const DEFAULT_FAMILIES = ["drums", "keys", "guitar", "bass"];
const EXTRA_FAMILIES = [
  "lead",
  "pad",
  "brass",
  "bell",
  "flute",
  "saxophone",
  "clarinet",
  "strings",
  "organ",
  "epiano",
  "choir",
  "synthbass",
  "marimba",
  "trumpet",
];
const ALL_FAMILIES = [...DEFAULT_FAMILIES, ...EXTRA_FAMILIES];

// Grouped the way GarageBand's own Sound Library browses instruments —
// by instrument family, not alphabetically — so scanning for "a bass
// sound" or "something brassy" is a category jump, not a full-list
// scroll.
const INSTRUMENT_CATEGORIES = [
  { name: "Drums & Percussion", families: ["drums"] },
  { name: "Bass", families: ["bass", "synthbass"] },
  { name: "Keyboards", families: ["keys", "epiano", "organ"] },
  { name: "Guitars", families: ["guitar"] },
  { name: "Strings & Choir", families: ["strings", "choir"] },
  { name: "Winds & Brass", families: ["saxophone", "clarinet", "flute", "trumpet", "brass"] },
  { name: "Synth Leads & Pads", families: ["lead", "pad"] },
  { name: "Mallets & Bells", families: ["bell", "marimba"] },
];
const FAMILY_DISPLAY_NAME = {
  drums: "Drums",
  keys: "Piano",
  guitar: "Guitar",
  bass: "Bass",
  lead: "Lead",
  pad: "Pad",
  brass: "Brass",
  bell: "Bell",
  flute: "Flute",
  saxophone: "Saxophone",
  clarinet: "Clarinet",
  strings: "Strings",
  organ: "Organ",
  epiano: "Electric Piano",
  choir: "Choir",
  synthbass: "Synth Bass",
  marimba: "Marimba",
  trumpet: "Trumpet",
};

function trackFamily(track, index) {
  return track.pattern?.family || currentSong?.layers[index]?.family || null;
}

function renderSongPicker() {
  const el = document.getElementById("song-picker");
  el.innerHTML = "";
  for (const song of DEMO_SONGS) {
    const div = document.createElement("div");
    div.className = "instrument-track";
    div.innerHTML = `
      <div class="instrument-track__icon">${uiIconSvg("note")}</div>
      <div class="instrument-track__body">
        <div class="instrument-track__name">${song.title}</div>
        <div class="daw-note" style="margin:0">${song.genre}</div>
      </div>`;
    div.onclick = () => loadSong(song);
    el.appendChild(div);
  }
}

async function loadSong(song) {
  await engine.resume();
  pushUndo();
  currentSong = song;
  engine.renderSongToTracks(song);
  renderTrackList();
  renderTimeline();
}

function renderTrackList() {
  const el = document.getElementById("track-list");
  el.innerHTML = "";
  engine.tracks.forEach((track, i) => {
    const family = trackFamily(track, i);
    const icon = family ? instrumentIconSvg(family, `instrument-icon--${family}`) : uiIconSvg("note");
    const div = document.createElement("div");
    div.className = "instrument-track" + (i === activeTrackIndex ? " is-active" : "");
    div.dataset.trackIndex = i;
    div.innerHTML = `
      <div class="instrument-track__icon">${icon}</div>
      <div class="instrument-track__body">
        <div class="instrument-track__name">${track.name}</div>
        <div class="instrument-track__controls">
          <button class="instrument-track__mute${track.muted ? " is-muted" : ""}" data-mute="${i}">Mute</button>
          <button class="instrument-track__mute${track.solo ? " is-solo" : ""}" data-solo="${i}">Solo</button>
          <input class="instrument-track__pan" type="range" min="-100" max="100" value="${Math.round(track.pan * 100)}" data-pan="${i}" title="Pan" />
          <button class="instrument-track__mute" data-move="up" data-index="${i}" title="Move up">↑</button>
          <button class="instrument-track__mute" data-move="down" data-index="${i}" title="Move down">↓</button>
          <button class="instrument-track__mute" data-remove="${i}" title="Remove">✕</button>
        </div>
      </div>`;
    el.appendChild(div);
  });

  el.querySelectorAll("button[data-mute]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.mute);
      const track = engine.tracks[i];
      pushUndo();
      engine.setMuted(i, !track.muted);
      btn.classList.toggle("is-muted", track.muted);
      renderWaveform();
    };
  });
  el.querySelectorAll("button[data-solo]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.solo);
      const track = engine.tracks[i];
      pushUndo();
      engine.setSolo(i, !track.solo);
      btn.classList.toggle("is-solo", track.solo);
      renderWaveform();
    };
  });
  el.querySelectorAll("input[data-pan]").forEach((input) => {
    // pushUndo on the drag's first pointer-down, not on every `input`
    // tick — a slider drag is one undo-able action, not dozens.
    input.onmousedown = input.ontouchstart = () => pushUndo();
    input.oninput = () => {
      engine.setPan(Number(input.dataset.pan), Number(input.value) / 100);
    };
  });
  el.querySelectorAll("button[data-move]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.index);
      const to = btn.dataset.move === "up" ? i - 1 : i + 1;
      if (to < 0 || to >= engine.tracks.length) return;
      pushUndo();
      engine.moveTrack(i, to);
      renderTrackList();
      renderTimeline();
    };
  });
  el.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.onclick = () => {
      pushUndo();
      engine.removeTrack(Number(btn.dataset.remove));
      renderTrackList();
      renderTimeline();
    };
  });

  // Clicking a track in this left-hand list (not one of its
  // mute/solo/pan/move/remove controls) selects it and opens the
  // sidebar sound picker — same "click it, see its dropdown" behavior
  // the timeline already had, now here too, since this is the list
  // people actually look at first ("YOUR LAYERS").
  el.querySelectorAll(".instrument-track[data-track-index]").forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest("button, input")) return;
      activeTrackIndex = Number(row.dataset.trackIndex);
      renderTrackList();
      renderSoundPicker();
    };
  });
}

function renderTimeline() {
  const el = document.getElementById("timeline");
  const maxDur = engine.maxDurationSec();
  const trackRows = engine.tracks
    .map((track, i) => {
      const isActive = i === activeTrackIndex;
      const family = trackFamily(track, i);
      const pct = Math.max(2, (track.durationSec / maxDur) * 100);
      const icon = family ? instrumentIconSvg(family, `instrument-icon--${family}`) : "";
      const body = track.pattern
        ? renderPatternGridHtml(track, i)
        : `<div class="timeline-layer__bar layer-color-${i % 6}" style="width:${pct}%"></div>`;
      return `
        <div class="timeline-layer${isActive ? " timeline-layer--active" : ""}" data-track-index="${i}">
          <div class="timeline-layer__label" data-track-index="${i}">${icon}${track.name}</div>
          <div class="timeline-layer__track">
            ${body}
            <div class="timeline-layer__playhead" id="playhead-${i}" style="display:none"></div>
          </div>
        </div>`;
    })
    .join("");

  const emptyNote = engine.tracks.length
    ? ""
    : '<p class="daw-note">Every track was removed — tap "+" below or pick an example song to start again.</p>';

  el.innerHTML = trackRows + emptyNote + renderInstrumentBrowserHtml();
  renderWaveform();
}

// A GarageBand Sound-Library-style browser: search box + instruments
// grouped by category, each with its own icon and two clear actions
// (a ready-to-go starter riff, or a blank grid to build from nothing)
// instead of one flat alphabet-soup button list. Always lists every
// family, including ones already on the timeline — GarageBand lets you
// add a second Piano track just as easily as a first.
function renderInstrumentCategoriesHtml(query) {
  const q = query.trim().toLowerCase();
  const categoriesHtml = INSTRUMENT_CATEGORIES.map((cat) => {
    const rows = cat.families
      .filter((f) => !q || FAMILY_DISPLAY_NAME[f].toLowerCase().includes(q))
      .map(
        (f) => `
        <div class="instrument-browser__row">
          <div class="instrument-browser__icon instrument-icon--${f}">${instrumentIconSvg(f)}</div>
          <div class="instrument-browser__name">${FAMILY_DISPLAY_NAME[f]}</div>
          <button type="button" class="instrument-browser__action" data-add-family="${f}" title="Add with a ready-to-go starter riff">Starter</button>
          <button type="button" class="instrument-browser__action instrument-browser__action--ghost" data-add-blank-family="${f}" title="Add an empty grid to build from scratch">Blank</button>
        </div>`,
      )
      .join("");
    if (!rows) return "";
    return `<div class="instrument-browser__category"><div class="instrument-browser__category-name">${cat.name}</div>${rows}</div>`;
  }).join("");
  return categoriesHtml || '<p class="daw-note">No instruments match that search.</p>';
}

function renderInstrumentBrowserHtml() {
  if (!instrumentBrowserOpen) {
    return `<button type="button" class="timeline-add-btn" id="add-instrument-btn">+ Add an instrument</button>`;
  }
  return `
    <div class="instrument-browser">
      <div class="instrument-browser__header">
        <input type="text" id="instrument-search" class="instrument-browser__search" placeholder="Search instruments…" value="${instrumentSearchQuery}" autofocus />
        <button type="button" class="side-panel__close" id="instrument-browser-close" title="Close">✕</button>
      </div>
      <div id="instrument-browser-results">${renderInstrumentCategoriesHtml(instrumentSearchQuery)}</div>
    </div>`;
}

function handleAddBlankTrack(family) {
  const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, family, []);
  pushUndo();
  engine.addTrack(FAMILY_DISPLAY_NAME[family] || family, pattern.buffer, pattern);
  activeTrackIndex = engine.tracks.length - 1;
  armedSound = paletteFor(family)[0]?.key || null;
  instrumentBrowserOpen = false;
  renderTrackList();
  renderTimeline();
  renderSoundPicker();
}

// Renders one pattern-backed track's row as a grid of clickable steps —
// tapping an empty step places the currently armed sound, tapping a
// filled step removes it (see the #timeline click-delegation below).
function renderPatternGridHtml(track, trackIndex) {
  const palette = paletteFor(track.pattern.family);
  let html = `<div class="pattern-grid pattern-grid--${track.pattern.family}" data-track-index="${trackIndex}">`;
  for (let step = 0; step < track.pattern.totalSteps; step++) {
    const hit = track.pattern.hits.find((h) => h.step === step);
    if (hit) {
      const entry = palette.find((s) => s.key === hit.sound);
      const initial = entry ? entry.label.charAt(0).toUpperCase() : "";
      html += `<button type="button" class="pattern-grid__step is-filled" data-step="${step}" title="${soundLabel(
        track.pattern.family,
        hit.sound,
      )} — tap to remove">${initial}</button>`;
    } else {
      const armedLabel = armedSound ? soundLabel(track.pattern.family, armedSound) : "a sound";
      html += `<button type="button" class="pattern-grid__step" data-step="${step}" title="Tap to place ${armedLabel}"></button>`;
    }
  }
  html += "</div>";
  return html;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A YouTube/SoundCloud-style bar waveform of the whole current mix —
// summed peak amplitude across every unmuted track at each of
// `numBars` positions across the project's full length. This is a real
// overview of what's actually loaded (not a decorative placeholder),
// recomputed whenever the set of tracks or their patterns change.
function computeWaveformPeaks(numBars) {
  const maxDur = engine.maxDurationSec();
  const peaks = new Array(numBars).fill(0);
  if (!engine.tracks.length) return peaks;

  const anySoloed = engine.tracks.some((t) => t.solo);
  for (const track of engine.tracks) {
    const audible = anySoloed ? track.solo : !track.muted;
    if (!audible) continue;
    const data = track.buffer.getChannelData(0);
    const sampleRate = track.buffer.sampleRate;
    for (let i = 0; i < numBars; i++) {
      const tSec = (i / numBars) * maxDur;
      if (tSec >= track.durationSec) continue;
      const startSample = Math.floor(tSec * sampleRate);
      const endSample = Math.min(data.length, Math.floor(((i + 1) / numBars) * maxDur * sampleRate));
      let peak = 0;
      for (let s = startSample; s < endSample; s += 4) {
        const abs = Math.abs(data[s]);
        if (abs > peak) peak = abs;
      }
      peaks[i] += peak;
    }
  }
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => Math.min(1, p / maxPeak));
}

const WAVEFORM_BARS = 120;

function renderWaveform() {
  const el = document.getElementById("waveform");
  const peaks = computeWaveformPeaks(WAVEFORM_BARS);
  el.innerHTML = peaks
    .map((p) => `<div class="waveform-bar" style="height:${Math.max(6, p * 100)}%"></div>`)
    .join("");
}

function updateScrubber() {
  const maxDur = engine.maxDurationSec();
  const pos = engine.positionSec();
  const pct = engine.tracks.length ? Math.max(0, Math.min(100, (pos / maxDur) * 100)) : 0;
  document.getElementById("scrubber").style.left = `${pct}%`;
  document.getElementById("scrubber-time").textContent = engine.tracks.length
    ? `${formatTime(pos)} / ${formatTime(maxDur)}`
    : "0:00 / 0:00";
}

function updatePlayhead() {
  updateScrubber();
  updatePlayPauseButton();
  if (!engine.playing) {
    document.querySelectorAll(".timeline-layer__playhead").forEach((p) => (p.style.display = "none"));
    return;
  }
  const maxDur = engine.maxDurationSec();
  const pos = engine.positionSec();
  const pct = Math.min(100, (pos / maxDur) * 100);
  document.querySelectorAll(".timeline-layer__playhead").forEach((p) => {
    p.style.display = "block";
    p.style.left = `${pct}%`;
  });
  playheadTimer = requestAnimationFrame(updatePlayhead);
}

// One button that toggles, not two separate Play/Pause buttons — you
// shouldn't have to look for a different button to pause than the one
// you pressed to play.
function updatePlayPauseButton() {
  const btn = document.getElementById("play-pause-btn");
  btn.innerHTML = engine.playing ? `${uiIconSvg("pause")} Pause` : `${uiIconSvg("play")} Play`;
}

document.getElementById("play-pause-btn").onclick = async () => {
  if (engine.playing) {
    engine.pause();
  } else {
    await engine.resume();
    engine.play();
    updatePlayhead();
  }
  updatePlayPauseButton();
};
document.getElementById("stop-btn").onclick = () => {
  engine.stop();
  updatePlayhead();
};

// --- Tempo: rescales pattern-editor.js's step duration and rebuilds
// every pattern-backed track's audio at the new speed. ---
function handleBpmChange(newBpm) {
  const bpm = Math.max(40, Math.min(240, Math.round(newBpm) || currentBpm));
  document.getElementById("bpm-input").value = bpm;
  if (bpm === currentBpm) return;
  pushUndo();
  currentBpm = bpm;
  setBpm(bpm);
  for (const track of engine.tracks) {
    if (!track.pattern) continue;
    track.pattern.buffer = rebuildBuffer(engine.ctx, engine.ctx.sampleRate, track.pattern.family, track.pattern.hits, track.pattern.totalSteps);
    track.buffer = track.pattern.buffer;
  }
  renderTimeline();
  updateScrubber();
}
document.getElementById("bpm-input").addEventListener("change", (e) => {
  handleBpmChange(Number(e.target.value));
});

// --- Draggable preview scrubber: click anywhere on the waveform to jump
// there, or drag the green line left/right to scrub through the project
// — instantly audible, like scrubbing a YouTube video. The whole preview
// area is the drag target (not just the thin line itself). ---
const previewEl = document.getElementById("preview");
let isScrubbing = false;

function seekFromPointer(clientX) {
  if (!engine.tracks.length) return;
  const rect = previewEl.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  engine.seekTo(frac * engine.maxDurationSec());
  updateScrubber();
}

previewEl.addEventListener("pointerdown", (e) => {
  isScrubbing = true;
  try {
    previewEl.setPointerCapture(e.pointerId);
  } catch {
    /* some input sources (synthetic events, certain browsers) don't
       register an active pointer to capture — dragging still works via
       pointermove bubbling, so this is safe to ignore. */
  }
  seekFromPointer(e.clientX);
});
previewEl.addEventListener("pointermove", (e) => {
  if (isScrubbing) seekFromPointer(e.clientX);
});
previewEl.addEventListener("pointerup", (e) => {
  isScrubbing = false;
  try {
    previewEl.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
  if (engine.playing) updatePlayhead(); // restart the rAF loop from the new position
});

// --- Click-to-place beat/note grid: selecting a track's row, toggling
// a step, and the sidebar sound picker (arm a sound / auto-fill). ---
document.getElementById("timeline").addEventListener("click", (e) => {
  const stepBtn = e.target.closest(".pattern-grid__step");
  if (stepBtn) {
    const trackIndex = Number(stepBtn.closest(".pattern-grid").dataset.trackIndex);
    handleStepClick(trackIndex, Number(stepBtn.dataset.step));
    return;
  }
  const label = e.target.closest(".timeline-layer__label");
  if (label && label.dataset.trackIndex !== undefined) {
    activeTrackIndex = Number(label.dataset.trackIndex);
    renderTimeline();
    renderSoundPicker();
    return;
  }
  if (e.target.closest("#add-instrument-btn")) {
    instrumentBrowserOpen = true;
    instrumentSearchQuery = "";
    renderTimeline();
    document.getElementById("instrument-search")?.focus();
    return;
  }
  if (e.target.closest("#instrument-browser-close")) {
    instrumentBrowserOpen = false;
    renderTimeline();
    return;
  }
  const addFamilyBtn = e.target.closest("[data-add-family]");
  if (addFamilyBtn) {
    handleAddInstrumentTrack(addFamilyBtn.dataset.addFamily);
    return;
  }
  const addBlankFamilyBtn = e.target.closest("[data-add-blank-family]");
  if (addBlankFamilyBtn) {
    handleAddBlankTrack(addBlankFamilyBtn.dataset.addBlankFamily);
    return;
  }
  // Clicking anywhere else on a track's row (e.g. a plain audio bar,
  // not a pattern step) still selects it and opens its sidebar picker
  // — "click a part of the song, it guides you to the dropdown on the
  // left" shouldn't only work for pattern-backed tracks.
  const layer = e.target.closest(".timeline-layer");
  if (layer && layer.dataset.trackIndex !== undefined) {
    activeTrackIndex = Number(layer.dataset.trackIndex);
    renderTimeline();
    renderSoundPicker();
  }
});

// Filters the instrument browser's results live as you type — updates
// only the results div (not the whole panel via renderTimeline) so the
// search input never loses focus/cursor position mid-keystroke.
document.getElementById("timeline").addEventListener("input", (e) => {
  if (e.target.id !== "instrument-search") return;
  instrumentSearchQuery = e.target.value;
  const results = document.getElementById("instrument-browser-results");
  if (results) results.innerHTML = renderInstrumentCategoriesHtml(instrumentSearchQuery);
});

// --- Right-click context menu: mute/solo/rename/clear/remove a track,
// or jump straight to adding a new instrument — without needing to
// find the small buttons already in the sidebar row. ---
let contextMenuEl = null;
function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}
document.addEventListener("click", (e) => {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) closeContextMenu();
});
document.getElementById("timeline").addEventListener("contextmenu", (e) => {
  const layer = e.target.closest(".timeline-layer");
  if (!layer || layer.dataset.trackIndex === undefined) return;
  e.preventDefault();
  closeContextMenu();
  const i = Number(layer.dataset.trackIndex);
  const track = engine.tracks[i];
  if (!track) return;

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  const items = [
    { label: track.muted ? "Unmute" : "Mute", action: () => (pushUndo(), engine.setMuted(i, !track.muted)) },
    { label: track.solo ? "Unsolo" : "Solo", action: () => (pushUndo(), engine.setSolo(i, !track.solo)) },
  ];
  if (track.pattern) {
    items.push({
      label: "Clear this track (blank slate)",
      action: () => {
        pushUndo();
        const empty = createPattern(engine.ctx, engine.ctx.sampleRate, track.pattern.family, [], track.pattern.totalSteps);
        track.pattern = empty;
        track.buffer = empty.buffer;
      },
    });
  }
  items.push({
    label: "Remove track",
    action: () => {
      pushUndo();
      engine.removeTrack(i);
    },
  });
  items.push({ label: "+ Add an instrument", action: () => (instrumentBrowserOpen = true) });

  menu.innerHTML = items.map((item, idx) => `<button data-menu-idx="${idx}">${item.label}</button>`).join("");
  document.body.appendChild(menu);
  contextMenuEl = menu;
  menu.querySelectorAll("button").forEach((btn, idx) => {
    btn.onclick = () => {
      items[idx].action();
      closeContextMenu();
      renderTrackList();
      renderTimeline();
    };
  });
});

function handleStepClick(trackIndex, step) {
  const track = engine.tracks[trackIndex];
  if (!track || !track.pattern) return;
  activeTrackIndex = trackIndex;
  pushUndo();
  track.buffer = toggleStep(engine.ctx, engine.ctx.sampleRate, track.pattern, step, armedSound);
  renderTimeline();
  renderSoundPicker();
}

function renderSoundPicker() {
  const el = document.getElementById("sound-picker");
  const track = activeTrackIndex !== null ? engine.tracks[activeTrackIndex] : null;
  if (!track || !track.pattern) {
    el.innerHTML = '<p class="daw-note">Click a beat track\'s row in the timeline to edit its sounds.</p>';
    return;
  }
  const palette = paletteFor(track.pattern.family);
  el.innerHTML = `
    <div class="sound-picker__title">${track.name}</div>
    <div class="sound-picker__grid">
      ${palette
        .map(
          (s) =>
            `<button type="button" class="sound-picker__btn${armedSound === s.key ? " is-armed" : ""}" data-sound="${s.key}">${s.label}</button>`,
        )
        .join("")}
    </div>
    <p class="sound-picker__hint">Tap a sound above, then tap any step in the timeline to place it — tap a filled step again to remove it.</p>
    <div class="sound-picker__autofill">
      <span>Auto-fill every:</span>
      ${[2, 4, 6, 8]
        .map((n) => `<button type="button" class="sound-picker__autofill-btn" data-every="${n}">${n} beats</button>`)
        .join("")}
    </div>
  `;
}

document.getElementById("sound-picker").addEventListener("click", (e) => {
  const soundBtn = e.target.closest(".sound-picker__btn");
  if (soundBtn) {
    armedSound = soundBtn.dataset.sound;
    renderSoundPicker();
    renderTimeline();
    return;
  }
  const fillBtn = e.target.closest(".sound-picker__autofill-btn");
  if (!fillBtn || !armedSound || activeTrackIndex === null) return;
  const track = engine.tracks[activeTrackIndex];
  if (!track || !track.pattern) return;
  pushUndo();
  track.buffer = autoFillEveryBeats(engine.ctx, engine.ctx.sampleRate, track.pattern, armedSound, Number(fillBtn.dataset.every));
  renderTimeline();
});

// --- The four instruments ready to go the moment the page loads, and
// the "+" menu for adding any of the rest. ---
function initializeDefaultTracks() {
  for (const family of DEFAULT_FAMILIES) {
    const starter = STARTERS.find((s) => s.family === family);
    const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, family, starter?.hits || []);
    engine.addTrack(FAMILY_DISPLAY_NAME[family], pattern.buffer, pattern);
  }
  renderTrackList();
  renderTimeline();
}

function handleAddInstrumentTrack(family) {
  const starter = STARTERS.find((s) => s.family === family);
  const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, family, starter?.hits || []);
  pushUndo();
  engine.addTrack(FAMILY_DISPLAY_NAME[family] || family, pattern.buffer, pattern);
  activeTrackIndex = engine.tracks.length - 1;
  armedSound = paletteFor(family)[0]?.key || null;
  instrumentBrowserOpen = false;
  renderTrackList();
  renderTimeline();
  renderSoundPicker();
}

// --- Upload + Any Sound row ---
async function handleDecodedAudio(arrayBuffer, name) {
  await engine.resume();
  const statusEl = document.getElementById("anysound-status");
  try {
    uploadedBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
  } catch {
    statusEl.textContent = "Couldn't decode that as audio — check it's a supported audio format.";
    return;
  }
  uploadedName = name;
  statusEl.textContent = `Loaded ${name} (${uploadedBuffer.duration.toFixed(1)}s) — trim, reverse/pitch, then Apply.`;
  document.getElementById("fx-trim-start").value = "0";
  document.getElementById("fx-trim-start").max = String(uploadedBuffer.duration);
  document.getElementById("fx-trim-end").value = uploadedBuffer.duration.toFixed(1);
  document.getElementById("fx-trim-end").max = String(uploadedBuffer.duration);
  document.getElementById("fx-apply-btn").disabled = false;
}

async function handleUploadedFile(file) {
  await handleDecodedAudio(await file.arrayBuffer(), file.name);
}

document.getElementById("upload-track").onclick = () => document.getElementById("upload-input").click();
document.getElementById("anysound-upload-btn").onclick = () => document.getElementById("upload-input").click();
document.getElementById("upload-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (file) await handleUploadedFile(file);
};

// A direct URL to an audio file the user already controls/has rights to
// (e.g. their own Dropbox/Drive direct-download link) — a plain HTTP
// fetch, functionally identical to picking a local file. Streaming
// platforms are explicitly rejected up front: YouTube's ToS prohibits
// extracting audio regardless of purpose, and Spotify's API doesn't
// expose full-track audio to third parties at any tier — neither is a
// "we haven't built it yet" gap, so we say so immediately rather than
// attempting a fetch that was never going to work.
const BLOCKED_AUDIO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "spotify.com",
  "open.spotify.com",
  "soundcloud.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
];

function isBlockedAudioHost(hostname) {
  return BLOCKED_AUDIO_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

async function handleUrlFetch(rawUrl) {
  const statusEl = document.getElementById("anysound-status");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    statusEl.textContent = "That doesn't look like a valid URL.";
    return;
  }

  if (isBlockedAudioHost(url.hostname)) {
    statusEl.textContent =
      "Can't fetch from YouTube/Spotify/SoundCloud/etc. — their terms don't allow extracting audio this way, regardless of purpose. Paste a direct file link instead (e.g. a Dropbox/Drive direct-download link to a file you have rights to).";
    return;
  }

  statusEl.textContent = "Fetching…";
  let response;
  try {
    response = await fetch(url.href);
  } catch {
    statusEl.textContent = "Couldn't fetch that link — check it's public and allows cross-origin access.";
    return;
  }
  if (!response.ok) {
    statusEl.textContent = `Fetch failed (${response.status}) — check the link is correct and public.`;
    return;
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    statusEl.textContent = "That link points to a webpage, not a direct audio file.";
    return;
  }

  const arrayBuffer = await response.arrayBuffer();
  const name = decodeURIComponent(url.pathname.split("/").pop() || "linked-file");
  await handleDecodedAudio(arrayBuffer, name);
}

document.getElementById("anysound-url-btn").onclick = () => {
  const input = document.getElementById("anysound-url-input");
  if (input.value.trim()) handleUrlFetch(input.value.trim());
};

// Drag a file straight onto the timeline as an alternative to the file
// picker — same handling either way.
const timelineDropEl = document.getElementById("timeline");
timelineDropEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  timelineDropEl.classList.add("is-drag-over");
});
timelineDropEl.addEventListener("dragleave", () => timelineDropEl.classList.remove("is-drag-over"));
timelineDropEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  timelineDropEl.classList.remove("is-drag-over");
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) await handleUploadedFile(file);
});

function wireSlider(id, valId, fmt) {
  const slider = document.getElementById(id);
  const val = valId ? document.getElementById(valId) : null;
  if (val) slider.oninput = () => (val.textContent = fmt(slider.value));
}
wireSlider("fx-pitch", "fx-pitch-val", (v) => `${v} st`);

// A real vocal chain (per Sombr's own described process: "distortion
// and reverb and compression, stock compression, stock EQ") stacks
// several effects together, not just one — so each of these is an
// independently toggleable checkbox rather than a single "pick one"
// dropdown, and any combination can be applied at once.
const EFFECT_STACK_DEFS = [
  { key: "robotic", param: "roboticHz", slider: "robotic-hz" },
  { key: "muffled", param: "muffleCutoffHz", slider: "muffle-hz" },
  { key: "distortion", param: "distortionAmount", slider: "distortion", scale: 0.01 },
  { key: "reverb", param: "reverbWet", slider: "reverb", scale: 0.01 },
  { key: "delay", param: "delayWet", slider: "delay", scale: 0.01 },
  // Compression is a plain on/off toggle, no slider — matching how it's
  // actually used ("stock compression": a fixed, sensible default, not
  // something tweaked per-take).
  { key: "compress", param: "compressEnabled", slider: null },
  // EQ, same reasoning: a real vocal-chain reference for this feature
  // (see STATUS.md's Sombr research notes) explicitly described "stock
  // EQ" — a sensible default presence boost, not something tweaked
  // per-take — so a plain toggle matches the actual reference better
  // than a multi-slider frequency/gain/Q control nobody asked to tune.
  { key: "eq", param: "eqGainDb", slider: null, toggleValue: 3 },
];

function wireEffectStack(prefix) {
  for (const def of EFFECT_STACK_DEFS) {
    if (!def.slider) continue;
    const checkbox = document.getElementById(`${prefix}-fx-${def.key}`);
    const slider = document.getElementById(`${prefix}-${def.slider}`);
    checkbox.onchange = () => {
      slider.style.display = checkbox.checked ? "inline-block" : "none";
    };
  }
}
wireEffectStack("fx");
wireEffectStack("voice");

function effectStackOptsFrom(prefix) {
  const opts = {
    roboticHz: 0,
    muffleCutoffHz: 0,
    distortionAmount: 0,
    reverbWet: 0,
    reverbRoom: 0.5,
    delayWet: 0,
    delayMs: 250,
    delayFeedback: 0.3,
    compressEnabled: false,
    eqGainDb: 0,
    eqFreqHz: 3000, // presence range — the "stock EQ" bump this preset approximates
    eqQ: 1,
  };
  for (const def of EFFECT_STACK_DEFS) {
    const checked = document.getElementById(`${prefix}-fx-${def.key}`).checked;
    if (!checked) continue;
    if (!def.slider) {
      opts[def.param] = def.toggleValue ?? true;
      continue;
    }
    const slider = document.getElementById(`${prefix}-${def.slider}`);
    opts[def.param] = Number(slider.value) * (def.scale ?? 1);
  }
  return opts;
}

function effectStackHasAny(opts) {
  return (
    opts.roboticHz > 0 ||
    opts.muffleCutoffHz > 0 ||
    opts.distortionAmount > 0 ||
    opts.reverbWet > 0 ||
    opts.delayWet > 0 ||
    opts.compressEnabled ||
    opts.eqGainDb !== 0
  );
}

document.getElementById("fx-apply-btn").onclick = async () => {
  if (!uploadedBuffer) return;
  await engine.resume();

  let buffer = uploadedBuffer;
  const trimStart = Number(document.getElementById("fx-trim-start").value);
  const trimEnd = Number(document.getElementById("fx-trim-end").value);
  if (trimStart > 0 || trimEnd < buffer.duration) {
    buffer = trimBuffer(engine.ctx, buffer, trimStart, trimEnd);
  }
  if (document.getElementById("fx-reverse").checked) buffer = reverseBuffer(engine.ctx, buffer);
  const semitones = Number(document.getElementById("fx-pitch").value);
  if (semitones !== 0) buffer = pitchShiftBuffer(engine.ctx, buffer, semitones);

  const voiceOpts = effectStackOptsFrom("fx");
  let finalBuffer = buffer;
  if (effectStackHasAny(voiceOpts)) {
    // Render the effect chain offline into a new buffer so it becomes a
    // real, independent track (not a live-only effect graph).
    const totalSamples = Math.ceil((buffer.duration + 1.0) * engine.ctx.sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, engine.ctx.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    buildEffectChain(offlineCtx, source, voiceOpts).connect(offlineCtx.destination);
    source.start();
    finalBuffer = await offlineCtx.startRendering();
  }

  pushUndo();
  engine.addTrack(`${uploadedName} (edited)`, finalBuffer);
  renderTrackList();
  renderTimeline();

  uploadedBuffer = null;
  document.getElementById("fx-apply-btn").disabled = true;
  document.getElementById("anysound-status").textContent = "Added to timeline.";
};

// --- Sing to instrument ---
let mediaRecorder = null;
let recordedChunks = [];
let recordedVoiceBuffer = null;

const voiceRecordBtn = document.getElementById("voice-record-btn");
const voiceStatus = document.getElementById("voice-status");
const voiceRenderBtn = document.getElementById("voice-render-btn");

voiceRecordBtn.onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    voiceStatus.textContent = "Microphone permission denied.";
    return;
  }
  await engine.resume();
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    voiceRecordBtn.innerHTML = `${uiIconSvg("mic")} Start recording`;
    voiceStatus.textContent = "Processing…";
    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    try {
      recordedVoiceBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
      voiceStatus.textContent = `Recorded ${recordedVoiceBuffer.duration.toFixed(1)}s`;
      document.getElementById("voice-trim-start").value = "0";
      document.getElementById("voice-trim-start").max = String(recordedVoiceBuffer.duration);
      document.getElementById("voice-trim-end").value = recordedVoiceBuffer.duration.toFixed(1);
      document.getElementById("voice-trim-end").max = String(recordedVoiceBuffer.duration);
      voiceRenderBtn.disabled = false;
    } catch {
      voiceStatus.textContent = "Couldn't decode the recording — try again.";
    }
  };
  mediaRecorder.start();
  voiceRecordBtn.innerHTML = `${uiIconSvg("stop")} Stop recording`;
  voiceStatus.textContent = "Recording…";
};

// Shared by Preview and Add-to-timeline so neither button duplicates
// the pitch-detection/render/effects logic — returns null (with a
// status message already set) if there's nothing usable to render yet.
async function buildVoiceInstrumentBuffer() {
  if (!recordedVoiceBuffer) return null;
  await engine.resume();

  let sourceBuffer = recordedVoiceBuffer;
  const trimStart = Number(document.getElementById("voice-trim-start").value);
  const trimEnd = Number(document.getElementById("voice-trim-end").value);
  if (trimStart > 0 || trimEnd < sourceBuffer.duration) {
    sourceBuffer = trimBuffer(engine.ctx, sourceBuffer, trimStart, trimEnd);
  }

  let notes = detectNotes(sourceBuffer);
  if (document.getElementById("voice-autotune").checked) {
    const tonic = Number(document.getElementById("voice-tonic").value);
    const scale = document.getElementById("voice-scale").value === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    notes = snapNotesToScale(notes, tonic, scale);
  }
  if (!notes.length) {
    voiceStatus.textContent = "No clear pitch detected — try singing louder or more sustained notes.";
    return null;
  }

  const family = document.getElementById("voice-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  const totalDurationSec = Math.max(...notes.map((n) => n.startSec + n.durationSec)) + 0.5;
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  const rawBuffer = engine.ctx.createBuffer(2, totalSamples, sampleRate);
  for (const n of notes) {
    renderVoice(engine.ctx, rawBuffer, family, [n.note], n.startSec, n.durationSec, sampleRate);
  }

  const voiceOpts = effectStackOptsFrom("voice");
  let finalBuffer = rawBuffer;
  if (effectStackHasAny(voiceOpts)) {
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = rawBuffer;
    const chainOut = buildEffectChain(offlineCtx, source, voiceOpts);
    chainOut.connect(offlineCtx.destination);
    source.start();
    finalBuffer = await offlineCtx.startRendering();
  }
  return { finalBuffer, family };
}

function playBufferOnce(buffer) {
  const src = engine.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(engine.masterGain);
  src.start();
}

document.getElementById("voice-preview-btn").onclick = async () => {
  const result = await buildVoiceInstrumentBuffer();
  if (!result) return;
  playBufferOnce(result.finalBuffer);
  voiceStatus.textContent = "Previewing…";
};

document.getElementById("voice-discard-btn").onclick = () => {
  recordedVoiceBuffer = null;
  voiceRenderBtn.disabled = true;
  document.getElementById("voice-preview-btn").disabled = true;
  document.getElementById("voice-discard-btn").disabled = true;
  voiceStatus.textContent = "Discarded.";
};

voiceRenderBtn.onclick = async () => {
  const result = await buildVoiceInstrumentBuffer();
  if (!result) return;
  pushUndo();
  engine.addTrack(`Voice as ${FAMILY_DISPLAY_NAME[result.family] || result.family}`, result.finalBuffer);
  renderTrackList();
  renderTimeline();
  voiceStatus.textContent = "Added to timeline.";
};

// --- Playable on-screen MIDI keyboard: click a key (or use the
// computer keyboard) to hear the selected instrument instantly —
// GarageBand's "Musical Typing" on-screen keyboard, plus real
// recording of a live performance into the timeline. ---
const KEYBOARD_KEY_MAP = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
const KEYBOARD_PREVIEW_DURATION_SEC = 0.9;
const heldKeyboardKeys = new Map(); // key: note, value: { startedAtMs, fromComputerKey }
let keyboardRecording = false;
let keyboardRecordStartMs = 0;
let keyboardRecordedNotes = []; // {note, startSec, durationSec}
let keyboardTakeBuffer = null;

function isTypingIntoField() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function keyboardNoteOn(note) {
  if (heldKeyboardKeys.has(note)) return; // already sounding (key-repeat) — don't re-trigger
  heldKeyboardKeys.set(note, { startedAtMs: performance.now() });
  document.querySelectorAll(`.midi-keyboard [data-note="${note}"]`).forEach((el) => el.classList.add("is-active"));

  const family = document.getElementById("keyboard-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  const buf = engine.ctx.createBuffer(2, Math.ceil(KEYBOARD_PREVIEW_DURATION_SEC * sampleRate), sampleRate);
  renderVoice(engine.ctx, buf, family, [note], 0, KEYBOARD_PREVIEW_DURATION_SEC, sampleRate);
  playBufferOnce(buf);
}

function keyboardNoteOff(note) {
  const held = heldKeyboardKeys.get(note);
  if (!held) return;
  heldKeyboardKeys.delete(note);
  document.querySelectorAll(`.midi-keyboard [data-note="${note}"]`).forEach((el) => el.classList.remove("is-active"));
  if (keyboardRecording) {
    const startSec = (held.startedAtMs - keyboardRecordStartMs) / 1000;
    const durationSec = Math.max(0.12, (performance.now() - held.startedAtMs) / 1000);
    keyboardRecordedNotes.push({ note, startSec, durationSec });
  }
}

document.getElementById("midi-keyboard").addEventListener("pointerdown", async (e) => {
  const keyEl = e.target.closest("[data-note]");
  if (!keyEl) return;
  await engine.resume();
  keyboardNoteOn(Number(keyEl.dataset.note));
});
document.getElementById("midi-keyboard").addEventListener("pointerup", (e) => {
  const keyEl = e.target.closest("[data-note]");
  if (keyEl) keyboardNoteOff(Number(keyEl.dataset.note));
});
document.getElementById("midi-keyboard").addEventListener("pointerleave", (e) => {
  const keyEl = e.target.closest("[data-note]");
  if (keyEl) keyboardNoteOff(Number(keyEl.dataset.note));
});

window.addEventListener("keydown", async (e) => {
  if (isTypingIntoField() || e.repeat) return;
  const note = KEYBOARD_KEY_MAP[e.key.toLowerCase()];
  if (note === undefined) return;
  await engine.resume();
  keyboardNoteOn(note);
});
window.addEventListener("keyup", (e) => {
  const note = KEYBOARD_KEY_MAP[e.key.toLowerCase()];
  if (note === undefined) return;
  keyboardNoteOff(note);
});

const keyboardStatus = document.getElementById("keyboard-status");
const keyboardRecordBtn = document.getElementById("keyboard-record-btn");
const keyboardPreviewBtn = document.getElementById("keyboard-preview-btn");
const keyboardAddBtn = document.getElementById("keyboard-add-btn");
const keyboardDiscardBtn = document.getElementById("keyboard-discard-btn");

function buildKeyboardTakeBuffer() {
  if (!keyboardRecordedNotes.length) return null;
  const family = document.getElementById("keyboard-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  const totalDurationSec = Math.max(...keyboardRecordedNotes.map((n) => n.startSec + n.durationSec)) + 0.5;
  const buf = engine.ctx.createBuffer(2, Math.ceil(totalDurationSec * sampleRate), sampleRate);
  for (const n of keyboardRecordedNotes) {
    renderVoice(engine.ctx, buf, family, [n.note], Math.max(0, n.startSec), n.durationSec, sampleRate);
  }
  return { buffer: buf, family };
}

keyboardRecordBtn.onclick = async () => {
  await engine.resume();
  if (!keyboardRecording) {
    keyboardRecording = true;
    keyboardRecordStartMs = performance.now();
    keyboardRecordedNotes = [];
    keyboardTakeBuffer = null;
    keyboardRecordBtn.innerHTML = `${uiIconSvg("stop")} Stop recording`;
    keyboardRecordBtn.classList.add("is-recording");
    keyboardStatus.textContent = "Recording — play the keyboard now…";
    keyboardPreviewBtn.disabled = true;
    keyboardAddBtn.disabled = true;
    keyboardDiscardBtn.disabled = true;
  } else {
    keyboardRecording = false;
    // Finalize any notes still held when Stop was pressed.
    for (const note of [...heldKeyboardKeys.keys()]) keyboardNoteOff(note);
    keyboardRecordBtn.innerHTML = `${uiIconSvg("mic")} Record performance`;
    keyboardRecordBtn.classList.remove("is-recording");
    const result = buildKeyboardTakeBuffer();
    if (!result) {
      keyboardStatus.textContent = "No notes played — try again.";
      return;
    }
    keyboardTakeBuffer = result;
    keyboardStatus.textContent = `Recorded ${keyboardRecordedNotes.length} note(s).`;
    keyboardPreviewBtn.disabled = false;
    keyboardAddBtn.disabled = false;
    keyboardDiscardBtn.disabled = false;
  }
};

keyboardPreviewBtn.onclick = () => {
  if (!keyboardTakeBuffer) return;
  playBufferOnce(keyboardTakeBuffer.buffer);
  keyboardStatus.textContent = "Previewing…";
};

keyboardAddBtn.onclick = () => {
  if (!keyboardTakeBuffer) return;
  pushUndo();
  engine.addTrack(`Keyboard: ${FAMILY_DISPLAY_NAME[keyboardTakeBuffer.family] || keyboardTakeBuffer.family}`, keyboardTakeBuffer.buffer);
  renderTrackList();
  renderTimeline();
  keyboardStatus.textContent = "Added to timeline.";
  keyboardTakeBuffer = null;
  keyboardPreviewBtn.disabled = true;
  keyboardAddBtn.disabled = true;
  keyboardDiscardBtn.disabled = true;
};

keyboardDiscardBtn.onclick = () => {
  keyboardRecordedNotes = [];
  keyboardTakeBuffer = null;
  keyboardPreviewBtn.disabled = true;
  keyboardAddBtn.disabled = true;
  keyboardDiscardBtn.disabled = true;
  keyboardStatus.textContent = "Discarded.";
};

// --- Save / load a project (browser localStorage) ---
// Pattern-backed tracks serialize as their real, compact hit data
// (regenerated into audio on load via the same createPattern() every
// other pattern track already uses). Non-pattern tracks (an uploaded
// clip, a voice-note render, a demo song's sustained piano/lead layer)
// have no such compact representation — their actual audio is encoded
// as a WAV, which is the honest trade a browser-only, no-backend save
// feature has to make: it works, but a project full of long uploaded
// clips will use real localStorage space (typically ~5-10MB quota).
const PROJECT_STORAGE_KEY = "dawsons:projects";

function serializeTrackForSave(track) {
  if (track.pattern) {
    return {
      kind: "pattern",
      name: track.name,
      family: track.pattern.family,
      hits: track.pattern.hits,
      totalSteps: track.pattern.totalSteps,
      muted: track.muted,
      solo: track.solo,
      pan: track.pan,
      pitchSemitones: track.pitchSemitones,
      reverbWet: track.reverbWet,
      delayWet: track.delayWet,
    };
  }
  return {
    kind: "audio",
    name: track.name,
    muted: track.muted,
    solo: track.solo,
    pan: track.pan,
    pitchSemitones: track.pitchSemitones,
    reverbWet: track.reverbWet,
    delayWet: track.delayWet,
    // The untouched dry source, not the current (possibly pitched/
    // effected) buffer — so re-loading and then changing pitch again
    // is relative to the real original, not a compounded re-pitch of
    // an already-shifted buffer.
    audioBase64: audioBufferToBase64Wav(track.originalBuffer),
  };
}

async function deserializeTrackFromSave(data) {
  if (data.kind === "pattern") {
    const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, data.family, data.hits, data.totalSteps);
    engine.addTrack(data.name, pattern.buffer, pattern);
  } else {
    const buffer = await base64WavToAudioBuffer(engine.ctx, data.audioBase64);
    engine.addTrack(data.name, buffer);
  }
  const track = engine.tracks[engine.tracks.length - 1];
  track.muted = data.muted;
  track.solo = data.solo;
  track.pan = data.pan;
  track.pitchSemitones = data.pitchSemitones || 0;
  track.reverbWet = data.reverbWet || 0;
  track.delayWet = data.delayWet || 0;
  if (track.pitchSemitones || track.reverbWet || track.delayWet) await refreshTrackAudio(track);
}

function listSavedProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

async function saveProjectAs(name) {
  const projects = listSavedProjects();
  projects[name] = {
    savedAt: new Date().toISOString(),
    bpm: currentBpm,
    tracks: engine.tracks.map(serializeTrackForSave),
  };
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
    return { ok: true };
  } catch (err) {
    // Quota exceeded is the realistic failure mode for a project full
    // of uploaded/recorded audio — surface it plainly rather than
    // silently losing the save.
    return { ok: false, error: String(err) };
  }
}

async function loadProjectByName(name) {
  const projects = listSavedProjects();
  const project = projects[name];
  if (!project) return false;
  pushUndo();
  engine.stop();
  engine.tracks = [];
  currentSong = null;
  currentBpm = project.bpm || 120;
  setBpm(currentBpm);
  document.getElementById("bpm-input").value = currentBpm;
  for (const trackData of project.tracks) {
    await deserializeTrackFromSave(trackData);
  }
  renderTrackList();
  renderTimeline();
  renderWaveform();
  return true;
}

function deleteSavedProject(name) {
  const projects = listSavedProjects();
  delete projects[name];
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
}

function renderProjectPanel(statusMessage = "") {
  const panel = document.getElementById("project-panel");
  const projects = listSavedProjects();
  const names = Object.keys(projects).sort((a, b) => (projects[b].savedAt || "").localeCompare(projects[a].savedAt || ""));
  panel.innerHTML = `
    <div class="side-panel__header">
      <strong>Saved projects</strong>
      <button class="side-panel__close" id="project-panel-close">✕</button>
    </div>
    <div class="side-panel__body">
      <label class="timeline-layer__inline-range">
        New save name
        <input type="text" id="project-save-name" placeholder="My song" value="${currentSong?.title || "My song"}" />
        <button class="is-primary" id="project-save-btn">${uiIconSvg("save")} Save current project</button>
      </label>
      <p class="daw-note" id="project-save-status">${statusMessage}</p>
      <hr />
      ${
        names.length
          ? names
              .map(
                (name) => `
        <div class="instrument-track">
          <div class="instrument-track__body">
            <div class="instrument-track__name">${name}</div>
            <div class="daw-note" style="margin:0">Saved ${new Date(projects[name].savedAt).toLocaleString()} — ${projects[name].tracks.length} track(s)</div>
          </div>
          <button data-load-project="${name}">Load</button>
          <button data-delete-project="${name}" title="Delete">✕</button>
        </div>`
              )
              .join("")
          : '<p class="daw-note">Nothing saved yet.</p>'
      }
    </div>`;

  document.getElementById("project-panel-close").onclick = () => (panel.style.display = "none");
  document.getElementById("project-save-btn").onclick = async () => {
    const name = document.getElementById("project-save-name").value.trim() || "My song";
    const status = document.getElementById("project-save-status");
    status.textContent = "Saving…";
    const result = await saveProjectAs(name);
    renderProjectPanel(
      result.ok ? `Saved "${name}".` : `Couldn't save — your browser's storage is full. Try deleting an old saved project first.`
    );
  };
  panel.querySelectorAll("[data-load-project]").forEach((btn) => {
    btn.onclick = async () => {
      await loadProjectByName(btn.dataset.loadProject);
      panel.style.display = "none";
    };
  });
  panel.querySelectorAll("[data-delete-project]").forEach((btn) => {
    btn.onclick = () => {
      deleteSavedProject(btn.dataset.deleteProject);
      renderProjectPanel();
    };
  });
}

function hideOtherPanels(except) {
  for (const id of ["mixer-panel", "share-panel", "project-panel"]) {
    if (id !== except) document.getElementById(id).style.display = "none";
  }
}

document.getElementById("save-project-btn").onclick = () => {
  hideOtherPanels("project-panel");
  renderProjectPanel();
  const panel = document.getElementById("project-panel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
};
document.getElementById("load-project-btn").onclick = () => {
  hideOtherPanels("project-panel");
  renderProjectPanel();
  document.getElementById("project-panel").style.display = "block";
};

// --- Mixer / master view ---
// The same per-track controls already in the sidebar track list, laid
// out as one dedicated glanceable mixer strip per track — the "where's
// my mixer" gap every proper DAW has, plus a master gain fader driving
// the engine's actual master bus (not a cosmetic control).
function renderMixerPanel() {
  const panel = document.getElementById("mixer-panel");
  panel.innerHTML = `
    <div class="side-panel__header">
      <strong>Mixer</strong>
      <button class="side-panel__close" id="mixer-panel-close">✕</button>
    </div>
    <div class="mixer-panel__strips">
      ${engine.tracks
        .map((t, i) => {
          const family = trackFamily(t, i);
          const icon = family ? instrumentIconSvg(family, `instrument-icon--${family}`) : uiIconSvg("note");
          return `
        <div class="mixer-strip">
          <div class="mixer-strip__name">${icon}${t.name}</div>
          <input class="mixer-strip__fader" type="range" min="0" max="150" value="${Math.round((t.gain?.gain?.value ?? 1) * 100)}" data-mixer-vol="${i}" title="Volume" orient="vertical" />
          <input class="instrument-track__pan" type="range" min="-100" max="100" value="${Math.round(t.pan * 100)}" data-mixer-pan="${i}" title="Pan" />
          <div class="mixer-strip__buttons">
            <button class="instrument-track__mute${t.muted ? " is-muted" : ""}" data-mixer-mute="${i}">M</button>
            <button class="instrument-track__mute${t.solo ? " is-solo" : ""}" data-mixer-solo="${i}">S</button>
          </div>
          <label class="mixer-strip__param" title="Pitch, in semitones — varispeed-style, so it also changes playback speed a little, same as the Any Sound row's Pitch slider">
            Pitch <span data-mixer-pitch-label="${i}">${t.pitchSemitones > 0 ? "+" : ""}${t.pitchSemitones}</span>
            <input type="range" min="-12" max="12" step="1" value="${t.pitchSemitones}" data-mixer-pitch="${i}" />
          </label>
          <label class="mixer-strip__param" title="Reverb send">
            Reverb
            <input type="range" min="0" max="100" value="${Math.round((t.reverbWet || 0) * 100)}" data-mixer-reverb="${i}" />
          </label>
          <label class="mixer-strip__param" title="Delay send">
            Delay
            <input type="range" min="0" max="100" value="${Math.round((t.delayWet || 0) * 100)}" data-mixer-delay="${i}" />
          </label>
        </div>`;
        })
        .join("")}
      <div class="mixer-strip mixer-strip--master">
        <div class="mixer-strip__name">Master</div>
        <input class="mixer-strip__fader" type="range" min="0" max="150" value="${Math.round(engine.masterGain.gain.value * 100)}" id="mixer-master-fader" title="Master volume" orient="vertical" />
      </div>
    </div>`;

  document.getElementById("mixer-panel-close").onclick = () => (panel.style.display = "none");
  panel.querySelectorAll("[data-mixer-vol]").forEach((input) => {
    input.oninput = () => {
      const i = Number(input.dataset.mixerVol);
      const track = engine.tracks[i];
      const vol = Number(input.value) / 100;
      if (track.gain) track.gain.gain.value = vol;
      track.savedVolume = vol; // read back on next play() if the engine supports it
    };
  });
  panel.querySelectorAll("[data-mixer-pan]").forEach((input) => {
    input.onmousedown = input.ontouchstart = () => pushUndo();
    input.oninput = () => {
      engine.setPan(Number(input.dataset.mixerPan), Number(input.value) / 100);
      renderTrackList();
    };
  });
  panel.querySelectorAll("[data-mixer-mute]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.mixerMute);
      pushUndo();
      engine.setMuted(i, !engine.tracks[i].muted);
      renderMixerPanel();
      renderTrackList();
    };
  });
  panel.querySelectorAll("[data-mixer-solo]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.mixerSolo);
      pushUndo();
      engine.setSolo(i, !engine.tracks[i].solo);
      renderMixerPanel();
      renderTrackList();
    };
  });
  document.getElementById("mixer-master-fader").oninput = (e) => {
    engine.masterGain.gain.value = Number(e.target.value) / 100;
  };
  panel.querySelectorAll("[data-mixer-pitch]").forEach((input) => {
    input.onmousedown = input.ontouchstart = () => pushUndo();
    const i = Number(input.dataset.mixerPitch);
    input.oninput = () => {
      const label = panel.querySelector(`[data-mixer-pitch-label="${i}"]`);
      const v = Number(input.value);
      if (label) label.textContent = `${v > 0 ? "+" : ""}${v}`;
    };
    input.onchange = () => setTrackPitch(i, Number(input.value));
  });
  panel.querySelectorAll("[data-mixer-reverb]").forEach((input) => {
    input.onmousedown = input.ontouchstart = () => pushUndo();
    input.onchange = () => setTrackSend(Number(input.dataset.mixerReverb), "reverbWet", Number(input.value) / 100);
  });
  panel.querySelectorAll("[data-mixer-delay]").forEach((input) => {
    input.onmousedown = input.ontouchstart = () => pushUndo();
    input.onchange = () => setTrackSend(Number(input.dataset.mixerDelay), "delayWet", Number(input.value) / 100);
  });
}

// Re-derives a track's playable `buffer` from its untouched dry source
// (a pattern track's `pattern.buffer`, or a plain track's
// `originalBuffer`) plus its current pitch/reverb/delay — this engine
// plays plain buffers with no live per-track effect graph, so pitch and
// sends are "baked in" the same way the Voice/Any Sound rows already
// bake in their own effect stacks before adding a track.
async function refreshTrackAudio(track) {
  const dry = track.pattern ? track.pattern.buffer : track.originalBuffer;
  let processed = track.pitchSemitones ? pitchShiftBuffer(engine.ctx, dry, track.pitchSemitones) : dry;
  if (track.reverbWet || track.delayWet) {
    const offlineCtx = new OfflineAudioContext(processed.numberOfChannels, processed.length, processed.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = processed;
    const chainOut = buildEffectChain(offlineCtx, source, {
      reverbWet: track.reverbWet || 0,
      reverbRoom: 0.5,
      delayWet: track.delayWet || 0,
      delayMs: 250,
      delayFeedback: 0.3,
    });
    chainOut.connect(offlineCtx.destination);
    source.start();
    processed = await offlineCtx.startRendering();
  }
  track.buffer = processed;
}

async function setTrackPitch(i, semitones) {
  const track = engine.tracks[i];
  if (!track) return;
  track.pitchSemitones = Math.max(-12, Math.min(12, semitones));
  await refreshTrackAudio(track);
  renderTimeline();
  renderWaveform();
}

async function setTrackSend(i, key, amount) {
  const track = engine.tracks[i];
  if (!track) return;
  track[key] = Math.max(0, Math.min(1, amount));
  await refreshTrackAudio(track);
  renderTimeline();
  renderWaveform();
}

document.getElementById("mixer-btn").onclick = () => {
  hideOtherPanels("mixer-panel");
  renderMixerPanel();
  const panel = document.getElementById("mixer-panel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
};

// --- Share ---
// A song built entirely from pattern-backed tracks (the default
// instruments, anything added via "+", and a demo song's bass/arp/
// drums layers) can be fully reconstructed from a small amount of
// JSON — real state, not just a screenshot — so the link genuinely
// recreates the project, not just a description of it. A demo song's
// sustained piano/pad/lead layers regenerate from the song's own
// (free, instant) generator function on the receiving end; only
// actually-uploaded or recorded audio can't be included in a link
// (there's no backend to host that file), and the share panel says so
// plainly rather than silently dropping it.
function buildShareUrl() {
  const state = {
    song: currentSong?.title || null,
    bpm: currentBpm,
    tracks: engine.tracks.map((t) =>
      t.pattern
        ? {
            kind: "pattern",
            name: t.name,
            family: t.pattern.family,
            hits: t.pattern.hits,
            totalSteps: t.pattern.totalSteps,
            pitchSemitones: t.pitchSemitones,
            reverbWet: t.reverbWet,
            delayWet: t.delayWet,
          }
        : { kind: "unshareable", name: t.name }
    ),
  };
  const encoded = encodeURIComponent(btoa(JSON.stringify(state)));
  const url = new URL(window.location.href);
  url.search = "";
  if (state.song) url.searchParams.set("song", state.song);
  url.searchParams.set("state", encoded);
  return { url: url.toString(), unshareableCount: state.tracks.filter((t) => t.kind === "unshareable").length };
}

async function applySharedState(encoded) {
  let state;
  try {
    state = JSON.parse(atob(decodeURIComponent(encoded)));
  } catch {
    return;
  }
  if (state.song) {
    const match = DEMO_SONGS.find((s) => s.title === state.song);
    if (match) await loadSong(match);
  } else {
    engine.tracks = [];
    currentSong = null;
  }
  currentBpm = state.bpm || 120;
  setBpm(currentBpm);
  document.getElementById("bpm-input").value = currentBpm;
  for (const trackData of state.tracks) {
    if (trackData.kind !== "pattern") continue;
    const existingIndex = engine.tracks.findIndex((t) => t.name === trackData.name);
    const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, trackData.family, trackData.hits, trackData.totalSteps);
    let track;
    if (existingIndex >= 0) {
      track = engine.tracks[existingIndex];
      track.pattern = pattern;
      track.buffer = pattern.buffer;
    } else {
      engine.addTrack(trackData.name, pattern.buffer, pattern);
      track = engine.tracks[engine.tracks.length - 1];
    }
    track.pitchSemitones = trackData.pitchSemitones || 0;
    track.reverbWet = trackData.reverbWet || 0;
    track.delayWet = trackData.delayWet || 0;
    if (track.pitchSemitones || track.reverbWet || track.delayWet) await refreshTrackAudio(track);
  }
  renderTrackList();
  renderTimeline();
  renderWaveform();
}

function renderSharePanel() {
  const panel = document.getElementById("share-panel");
  const { url, unshareableCount } = buildShareUrl();
  const message = encodeURIComponent(`Check out this song I made on Dawsons: ${url}`);
  panel.innerHTML = `
    <div class="side-panel__header">
      <strong>Share this song</strong>
      <button class="side-panel__close" id="share-panel-close">✕</button>
    </div>
    <div class="side-panel__body">
      ${
        unshareableCount
          ? `<p class="daw-note">${unshareableCount} track(s) with uploaded/recorded audio can't be included in a link (there's no server to host the file) — download the full mix below to share those exactly.</p>`
          : ""
      }
      <label class="timeline-layer__inline-range">
        <input type="text" id="share-link-input" value="${url}" readonly style="width: 100%" />
      </label>
      <div class="debug-panel__buttons">
        <button class="is-primary" id="share-copy-btn">Copy link</button>
        <button id="share-native-btn">Share…</button>
        <button id="share-whatsapp-btn">WhatsApp</button>
        <button id="share-facebook-btn">Facebook</button>
        <button id="share-download-btn">${uiIconSvg("save")} Download mix (WAV)</button>
      </div>
      <p class="daw-note" id="share-status"></p>
    </div>`;

  document.getElementById("share-panel-close").onclick = () => (panel.style.display = "none");
  document.getElementById("share-copy-btn").onclick = async () => {
    await navigator.clipboard.writeText(url);
    document.getElementById("share-status").textContent = "Link copied.";
  };
  document.getElementById("share-whatsapp-btn").onclick = () => {
    window.open(`https://api.whatsapp.com/send?text=${message}`, "_blank", "noopener");
  };
  document.getElementById("share-facebook-btn").onclick = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank", "noopener");
  };
  const nativeBtn = document.getElementById("share-native-btn");
  if (navigator.share) {
    nativeBtn.onclick = () => navigator.share({ title: "My Dawsons song", text: "Check out this song I made", url }).catch(() => {});
  } else {
    // No native share sheet (most desktop browsers) — fall back to a
    // couple more direct share-intent links rather than a dead button.
    nativeBtn.textContent = "Twitter/X";
    nativeBtn.onclick = () => {
      window.open(`https://twitter.com/intent/tweet?text=${message}`, "_blank", "noopener");
    };
  }
  document.getElementById("share-download-btn").onclick = () => {
    const totalSamples = Math.ceil(engine.maxDurationSec() * engine.ctx.sampleRate);
    const mixBuffer = engine.ctx.createBuffer(2, Math.max(1, totalSamples), engine.ctx.sampleRate);
    const anySoloed = engine.tracks.some((t) => t.solo);
    for (const t of engine.tracks) {
      if (t.muted || (anySoloed && !t.solo)) continue;
      for (let ch = 0; ch < 2; ch++) {
        const src = t.buffer.getChannelData(Math.min(ch, t.buffer.numberOfChannels - 1));
        const dst = mixBuffer.getChannelData(ch);
        for (let i = 0; i < src.length && i < dst.length; i++) dst[i] += src[i];
      }
    }
    const wav = encodeWav(mixBuffer);
    const blob = new Blob([wav], { type: "audio/wav" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${currentSong?.title || "dawsons-song"}.wav`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

document.getElementById("share-btn").onclick = () => {
  hideOtherPanels("share-panel");
  renderSharePanel();
  const panel = document.getElementById("share-panel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
};

document.getElementById("undo-btn").onclick = handleUndo;
document.getElementById("redo-btn").onclick = handleRedo;

renderSongPicker();
initializeDefaultTracks();
updateScrubber();
updateUndoRedoButtons();

// If arriving from a share link (full project state) or the Discover
// page's "Open a similar layered example" link (just a demo song
// title), restore accordingly rather than leaving the DAW empty.
const urlParams = new URLSearchParams(window.location.search);
const sharedState = urlParams.get("state");
const requestedSong = urlParams.get("song");
if (sharedState) {
  applySharedState(sharedState);
} else if (requestedSong) {
  const match = DEMO_SONGS.find((s) => s.title === requestedSong);
  if (match) loadSong(match);
}
