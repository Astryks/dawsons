import { Engine } from "./audio-engine.js";
import { DEMO_SONGS } from "./demo-songs.js";
import { renderVoice, renderDrumHit } from "./synth.js";
import { reverseBuffer, pitchShiftBuffer, trimBuffer, buildEffectChain } from "./effects.js";
import { detectNotes, snapNotesToScale, MAJOR_SCALE, MINOR_SCALE } from "./pitch.js";
import { STARTERS } from "./starter-patterns.js";
import { paletteFor, soundLabel, createPattern, toggleStep, autoFillEveryBeats, setBpm, getStepSec, rebuildBuffer } from "./pattern-editor.js";
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
    loop: t.loop,
    startOffsetSec: t.startOffsetSec,
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
          <button class="instrument-track__mute${track.loop ? " is-looping" : ""}" data-loop="${i}" title="Repeat this track for as long as the rest of the project plays">Loop</button>
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
  el.querySelectorAll("button[data-loop]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.loop);
      const track = engine.tracks[i];
      pushUndo();
      track.loop = !track.loop;
      if (track.source) track.source.loop = track.loop; // takes effect immediately if already playing
      btn.classList.toggle("is-looping", track.loop);
      updateScrubber();
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
      const leftPct = ((track.startOffsetSec || 0) / maxDur) * 100;
      const icon = family ? instrumentIconSvg(family, `instrument-icon--${family}`) : "";
      // Only a plain (non-pattern) track's bar is draggable to
      // reposition — pattern tracks render as a full-width step grid
      // that always starts at 0; giving those a real start-offset too
      // is a separate, bigger change to how that grid is laid out.
      const body = track.pattern
        ? renderPatternGridHtml(track, i)
        : `<div class="timeline-layer__bar layer-color-${i % 6}" data-drag-track="${i}" style="width:${pct}%; left:${leftPct}%" title="Drag the middle to move this clip, or its right edge to trim its length">
            <div class="timeline-layer__resize-handle" data-resize-track="${i}"></div>
          </div>`;
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

// --- Drag a plain (non-pattern) track's clip left/right to place it
// wherever in the project's timeline it belongs — a real start-offset
// the engine's play() honors (see audio-engine.js), not just a visual
// move. Only the dragged bar's own inline style updates during the
// drag itself (a full renderTimeline() mid-drag would replace the very
// element under the pointer and break the drag); everything else
// re-syncs once on release. ---
let dragState = null;
let resizeState = null;
document.getElementById("timeline").addEventListener("pointerdown", (e) => {
  const handle = e.target.closest("[data-resize-track]");
  if (handle) {
    const trackIndex = Number(handle.dataset.resizeTrack);
    const track = engine.tracks[trackIndex];
    const trackEl = handle.closest(".timeline-layer__track");
    if (!track || !trackEl) return;
    resizeState = {
      trackIndex,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startDurationSec: track.durationSec,
      rowWidthPx: trackEl.getBoundingClientRect().width,
      maxDur: engine.maxDurationSec(),
    };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* some input sources (synthetic events, certain browsers) don't
         register an active pointer to capture — the drag still works
         via the timeline's own delegated move/up listeners. */
    }
    e.stopPropagation(); // don't also start a move-drag on the parent bar
    return;
  }
  const bar = e.target.closest("[data-drag-track]");
  if (!bar) return;
  const trackIndex = Number(bar.dataset.dragTrack);
  const track = engine.tracks[trackIndex];
  const trackEl = bar.closest(".timeline-layer__track");
  if (!track || !trackEl) return;
  pushUndo();
  dragState = {
    trackIndex,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startOffsetSec: track.startOffsetSec || 0,
    rowWidthPx: trackEl.getBoundingClientRect().width,
    maxDur: engine.maxDurationSec(),
  };
  try {
    bar.setPointerCapture(e.pointerId);
  } catch {
    /* see the resize handle's identical try/catch above */
  }
});
document.getElementById("timeline").addEventListener("pointermove", (e) => {
  if (resizeState && e.pointerId === resizeState.pointerId) {
    const deltaSec = ((e.clientX - resizeState.startClientX) / resizeState.rowWidthPx) * resizeState.maxDur;
    const newDurationSec = Math.max(0.1, Math.min(resizeState.startDurationSec, resizeState.startDurationSec + deltaSec));
    const bar = document.querySelector(`[data-drag-track="${resizeState.trackIndex}"]`);
    if (bar) bar.style.width = `${(newDurationSec / resizeState.maxDur) * 100}%`;
    return;
  }
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const deltaSec = ((e.clientX - dragState.startClientX) / dragState.rowWidthPx) * dragState.maxDur;
  const track = engine.tracks[dragState.trackIndex];
  if (!track) return;
  track.startOffsetSec = Math.max(0, dragState.startOffsetSec + deltaSec);
  const bar = document.querySelector(`[data-drag-track="${dragState.trackIndex}"]`);
  if (bar) bar.style.left = `${(track.startOffsetSec / dragState.maxDur) * 100}%`;
});
document.getElementById("timeline").addEventListener("pointerup", async (e) => {
  if (resizeState && e.pointerId === resizeState.pointerId) {
    const deltaSec = ((e.clientX - resizeState.startClientX) / resizeState.rowWidthPx) * resizeState.maxDur;
    const newDurationSec = Math.max(0.1, Math.min(resizeState.startDurationSec, resizeState.startDurationSec + deltaSec));
    const track = engine.tracks[resizeState.trackIndex];
    resizeState = null;
    if (track && !track.pattern && newDurationSec < track.durationSec - 0.01) {
      pushUndo();
      // Trim the untouched dry source (not whatever pitched/effected
      // buffer is currently playing) so a later pitch/reverb/delay
      // change still starts from the right material — same invariant
      // refreshTrackAudio() everywhere else already relies on.
      track.originalBuffer = trimBuffer(engine.ctx, track.originalBuffer, 0, newDurationSec);
      await refreshTrackAudio(track);
    }
    renderTimeline();
    return;
  }
  if (!dragState) return;
  dragState = null;
  if (engine.playing) engine.play(engine.positionSec()); // reschedule sources with the new offset
  renderTimeline();
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
  // Right-clicking empty space below the last track (no row there at
  // all) still guides you straight to the instrument browser — you
  // shouldn't have to already have a track to right-click on one.
  if (!layer || layer.dataset.trackIndex === undefined) {
    e.preventDefault();
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.innerHTML = `<button data-menu-idx="0">+ Add an instrument</button>`;
    document.body.appendChild(menu);
    contextMenuEl = menu;
    menu.querySelector("button").onclick = () => {
      instrumentBrowserOpen = true;
      closeContextMenu();
      renderTimeline();
    };
    return;
  }
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

// --- Record audio actually playing in a browser tab, another window,
// or the whole screen — the Screen Capture API's own "share tab/system
// audio" option, built into every modern browser, no extension needed.
// Feeds the exact same trim/reverse/pitch/effects pipeline as an
// uploaded file (handleDecodedAudio), so it inherits all of that for
// free instead of needing its own duplicate controls. ---
let tabAudioRecorder = null;
let tabAudioChunks = [];
const tabRecordBtn = document.getElementById("anysound-tab-record-btn");
const tabRecordBtnIdleHtml = tabRecordBtn.innerHTML;

tabRecordBtn.onclick = async () => {
  const statusEl = document.getElementById("anysound-status");
  if (tabAudioRecorder && tabAudioRecorder.state === "recording") {
    tabAudioRecorder.stop();
    return;
  }
  let stream;
  try {
    // The Screen Capture API requires requesting `video` to offer
    // tab/window/screen sharing at all — the video track is never
    // rendered anywhere here and gets stopped the moment recording
    // ends; only the audio track is actually used.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    statusEl.textContent = "Screen/tab sharing was cancelled or denied.";
    return;
  }
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent =
      'That share had no audio track — pick a browser tab and check "Share tab audio" (or check "Share system audio" when sharing a whole screen) in the picker.';
    return;
  }
  await engine.resume();
  tabAudioChunks = [];
  tabAudioRecorder = new MediaRecorder(stream);
  tabAudioRecorder.ondataavailable = (e) => tabAudioChunks.push(e.data);
  tabAudioRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    tabRecordBtn.innerHTML = tabRecordBtnIdleHtml;
    statusEl.textContent = "Processing…";
    const blob = new Blob(tabAudioChunks, { type: "audio/webm" });
    await handleDecodedAudio(await blob.arrayBuffer(), "Tab audio");
  };
  // The browser's own "Stop sharing" bar is a second way to end this —
  // treat that exactly like pressing our Stop button.
  stream.getAudioTracks()[0].addEventListener("ended", () => {
    if (tabAudioRecorder && tabAudioRecorder.state === "recording") tabAudioRecorder.stop();
  });
  tabAudioRecorder.start();
  tabRecordBtn.innerHTML = `${uiIconSvg("stop")} Stop recording`;
  statusEl.textContent = "Recording tab/system audio — play the sound you want to capture now…";
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
      document.getElementById("producer-build-btn").disabled = false;
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

  const rawNotes = detectNotes(sourceBuffer);
  let notes = rawNotes;
  if (document.getElementById("voice-autotune").checked) {
    const tonic = Number(document.getElementById("voice-tonic").value);
    const scale = document.getElementById("voice-scale").value === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    notes = snapNotesToScale(rawNotes, tonic, scale);
  }
  if (!notes.length) {
    voiceStatus.textContent = "No clear pitch detected — try singing louder or more sustained notes.";
    return null;
  }

  const family = document.getElementById("voice-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  let rawBuffer;
  let totalSamples;
  if (family === "__voice__") {
    // Keep the singer's own voice instead of resynthesizing through an
    // instrument — a real Auto-Tune-style pitch *correction*: each
    // detected note segment of the ORIGINAL recording gets pitch-
    // shifted by just the amount needed to snap it onto the chosen
    // scale, not replaced by a synth tone. With Auto-tune unchecked,
    // `notes === rawNotes` (zero correction everywhere), so this is
    // just "add my voice as-is."
    totalSamples = sourceBuffer.length;
    rawBuffer = pitchCorrectBuffer(engine.ctx, sourceBuffer, rawNotes, notes, sampleRate);
  } else {
    const totalDurationSec = Math.max(...notes.map((n) => n.startSec + n.durationSec)) + 0.5;
    totalSamples = Math.ceil(totalDurationSec * sampleRate);
    rawBuffer = engine.ctx.createBuffer(2, totalSamples, sampleRate);
    for (const n of notes) {
      renderVoice(engine.ctx, rawBuffer, family, [n.note], n.startSec, n.durationSec, sampleRate);
    }
  }

  const voiceOpts = effectStackOptsFrom("voice");
  let finalBuffer = rawBuffer;
  if (effectStackHasAny(voiceOpts)) {
    const offlineCtx = new OfflineAudioContext(rawBuffer.numberOfChannels, totalSamples, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = rawBuffer;
    const chainOut = buildEffectChain(offlineCtx, source, voiceOpts);
    chainOut.connect(offlineCtx.destination);
    source.start();
    finalBuffer = await offlineCtx.startRendering();
  }
  return { finalBuffer, family };
}

// Real pitch correction on the original recording, not a resynthesis:
// for each detected note segment, extracts that slice of audio and
// pitch-shifts *just it* by (corrected - detected) semitones via the
// existing varispeed pitchShiftBuffer, then writes it back at the
// segment's original start sample — clamped/truncated to the
// segment's original length so segments stay aligned in time despite
// pitch-shifting changing a slice's natural duration. Anything between
// detected notes (breaths, consonants, silence) is left as the
// unmodified original audio underneath.
function pitchCorrectBuffer(ctx, buffer, rawNotes, correctedNotes, sampleRate) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch));
  }
  for (let i = 0; i < rawNotes.length; i++) {
    const semitones = correctedNotes[i].note - rawNotes[i].note;
    if (!semitones) continue;
    const startSample = Math.max(0, Math.floor(rawNotes[i].startSec * sampleRate));
    const segSamples = Math.min(Math.floor(rawNotes[i].durationSec * sampleRate), buffer.length - startSample);
    if (segSamples <= 0) continue;
    const segBuffer = ctx.createBuffer(buffer.numberOfChannels, segSamples, sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      segBuffer.getChannelData(ch).set(buffer.getChannelData(ch).subarray(startSample, startSample + segSamples));
    }
    const shifted = pitchShiftBuffer(ctx, segBuffer, semitones);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = shifted.getChannelData(ch);
      const dst = out.getChannelData(ch);
      const n = Math.min(segSamples, src.length);
      for (let k = 0; k < n; k++) dst[startSample + k] = src[k];
    }
  }
  return out;
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
  document.getElementById("producer-build-btn").disabled = true;
  voiceStatus.textContent = "Discarded.";
};

// --- In-house producer: builds a real, original drum/bass/chord/
// melody arrangement — no AI model, just the same rule-based
// composition approach every demo song already uses (a diatonic chord
// builder + genre-specific progressions/rhythms, all standard, public-
// domain music-theory vocabulary, not copied from any real song) —
// then loops the user's own recording on top of it for ~2 minutes.
// Everything it creates lands as ordinary, fully editable tracks.
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_TRIAD_QUALITIES = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const MINOR_TRIAD_QUALITIES = ["min", "dim", "maj", "min", "min", "maj", "maj"];

// Each genre picks a scale, a standard/generic progression (scale-
// degree indices, 0-based — I=0, ii=1, iii/III=2, IV/iv=3, V/v=4,
// vi/VI=5, vii°/VII=6), a family for the sustained chords and for the
// arpeggio/comping pattern, the bass family, and an 8-step drum
// rhythm template (one sound name or null per eighth-note step) —
// the same generic rhythm-vocabulary idea demo-songs.js's own drum
// bar generators already use.
const PRODUCER_GENRES = {
  pop: {
    label: "Pop",
    scale: "major",
    progression: [0, 4, 5, 3], // I-V-vi-IV
    chordFamily: "keys",
    arpFamily: "guitar",
    bassFamily: "bass",
    drumBar: ["kick", "hihat", "snare", "hihat", "kick", "hihat", "snare", "hihat"],
  },
  hiphop: {
    label: "Hip-Hop",
    scale: "minor",
    progression: [0, 5, 2, 6], // i-VI-III-VII
    chordFamily: "epiano",
    arpFamily: "lead",
    bassFamily: "synthbass",
    drumBar: ["kick", "hihat", "clap", "hihat", "kick", "hihat", "snare", "hihat"],
  },
  house: {
    label: "House",
    scale: "minor",
    progression: [0, 3, 6, 2], // i-iv-VII-III
    chordFamily: "organ",
    arpFamily: "epiano",
    bassFamily: "synthbass",
    drumBar: ["kick", "hihat", "clap", "hihat", "kick", "hihat", "clap", "openhat"],
  },
  jazz: {
    label: "Jazz",
    scale: "major",
    progression: [1, 4, 0, 5], // ii-V-I-vi
    chordFamily: "keys",
    arpFamily: "guitar",
    bassFamily: "bass",
    drumBar: ["hihat", "shaker", "rimshot", "shaker", "hihat", "shaker", "rimshot", "shaker"],
  },
  holiday: {
    label: "Holiday",
    scale: "major",
    progression: [3, 0, 4, 5], // IV-I-V-vi
    chordFamily: "keys",
    arpFamily: "bell",
    bassFamily: "bass",
    drumBar: ["kick", "hihat", "snare", "hihat", "kick", "hihat", "snare", "hihat"],
  },
};

// Builds one diatonic triad for scale degree `degreeIndex` (0-6) of
// `tonic` (0-11, C=0) in the given scale — real (if simple) music
// theory, not a specific song's voicing.
function diatonicChord(tonic, scale, degreeIndex, octaveBase) {
  const intervals = scale === "minor" ? MINOR_SCALE_INTERVALS : MAJOR_SCALE_INTERVALS;
  const qualities = scale === "minor" ? MINOR_TRIAD_QUALITIES : MAJOR_TRIAD_QUALITIES;
  const root = octaveBase + tonic + intervals[degreeIndex % 7];
  const quality = qualities[degreeIndex % 7];
  const third = root + (quality === "maj" ? 4 : 3);
  const fifth = root + (quality === "dim" ? 6 : 7);
  return [root, third, fifth];
}

async function buildAutoProducerSong() {
  if (!recordedVoiceBuffer) return;
  await engine.resume();
  const genreKey = document.getElementById("producer-genre").value;
  const genre = PRODUCER_GENRES[genreKey];
  const tonic = Number(document.getElementById("voice-tonic").value);
  const sampleRate = engine.ctx.sampleRate;
  const stepSec = getStepSec();
  const barSec = stepSec * 8;
  const targetDurationSec = 120;
  const totalBars = Math.max(4, Math.ceil(targetDurationSec / barSec));
  const totalSteps = totalBars * 8;

  pushUndo();

  // Drums: the same 8-step rhythm tiled across every bar.
  const drumHits = [];
  for (let bar = 0; bar < totalBars; bar++) {
    for (let s = 0; s < 8; s++) {
      const sound = genre.drumBar[s];
      if (sound) drumHits.push({ step: bar * 8 + s, sound });
    }
  }
  const drumPattern = createPattern(engine.ctx, sampleRate, "drums", drumHits, totalSteps);
  engine.addTrack("Producer: Drums", drumPattern.buffer, drumPattern);

  // Bass: a quarter-note root pulse (steps 0/2/4/6) that follows the
  // progression's chord for each bar — the same bassPulse shape every
  // demo song already uses, just generated per bar here instead of
  // hand-written per song.
  const bassHits = [];
  const arpHits = [];
  const chordFamily = genre.chordFamily;
  const chordBuf = engine.ctx.createBuffer(2, Math.ceil(totalBars * barSec * sampleRate), sampleRate);
  for (let bar = 0; bar < totalBars; bar++) {
    const degree = genre.progression[bar % genre.progression.length];
    const [root, third, fifth] = diatonicChord(tonic, genre.scale, degree, 48);
    for (const s of [0, 2, 4, 6]) bassHits.push({ step: bar * 8 + s, note: root - 12 });
    const arpCycle = [root, third, fifth, third, root, third, fifth, third];
    for (let s = 0; s < 8; s++) arpHits.push({ step: bar * 8 + s, note: arpCycle[s] });
    renderVoice(engine.ctx, chordBuf, chordFamily, [root, third, fifth], bar * barSec, barSec, sampleRate);
  }
  const bassPattern = createPattern(engine.ctx, sampleRate, genre.bassFamily, bassHits, totalSteps);
  engine.addTrack("Producer: Bass", bassPattern.buffer, bassPattern);
  const arpPattern = createPattern(engine.ctx, sampleRate, genre.arpFamily, arpHits, totalSteps);
  engine.addTrack("Producer: Arp", arpPattern.buffer, arpPattern);
  engine.addTrack("Producer: Chords", chordBuf);

  // The user's own recording loops on top of the arrangement for its
  // full length, like sampling/looping a vocal hook over a produced
  // backing track — a real, common production technique.
  let vocalBuffer = recordedVoiceBuffer;
  const trimStart = Number(document.getElementById("voice-trim-start").value);
  const trimEnd = Number(document.getElementById("voice-trim-end").value);
  if (trimStart > 0 || trimEnd < vocalBuffer.duration) {
    vocalBuffer = trimBuffer(engine.ctx, vocalBuffer, trimStart, trimEnd);
  }
  engine.addTrack("Producer: Your voice", vocalBuffer);
  const vocalTrack = engine.tracks[engine.tracks.length - 1];
  vocalTrack.loop = true;

  renderTrackList();
  renderTimeline();
  updateScrubber();
  voiceStatus.textContent = `Built a ${totalBars}-bar ${genre.label} arrangement in ${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][tonic]} ${genre.scale} (~${Math.round((totalBars * barSec) / 60)} min) — your voice loops on top. Everything's a normal track: edit, mute, or remove any of it.`;
}

document.getElementById("producer-build-btn").onclick = buildAutoProducerSong;

voiceRenderBtn.onclick = async () => {
  const result = await buildVoiceInstrumentBuffer();
  if (!result) return;
  pushUndo();
  engine.addTrack(`Voice as ${FAMILY_DISPLAY_NAME[result.family] || result.family}`, result.finalBuffer);
  renderTrackList();
  renderTimeline();
  voiceStatus.textContent = "Added to timeline.";
};

// --- Playable on-screen instruments: an MPC-style 8-pad drum grid
// (click a pad, or the computer keys 1234/QWER, for an instant
// kick/snare/clap/hat — the classic hip-hop drum-machine/sampler
// finger-drumming layout) above a piano keyboard (click a key, or
// A S D F G H J K / W E T Y U, GarageBand's "Musical Typing" layout)
// — both feed the same Record/Preview/Discard/Add-to-timeline take,
// so a beat and a melody can be finger-drummed into the same take. ---
const KEYBOARD_KEY_MAP = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
// z/x/c/v (not q/w/e/r) for the pad grid's second row specifically so
// nothing collides with the piano keyboard's own W/E/T/Y/U black-key
// shortcuts below.
const PAD_KEY_MAP = { 1: "kick", 2: "snare", 3: "clap", 4: "hihat", z: "kick2", x: "rimshot", c: "openhat", v: "crash" };
const KEYBOARD_PREVIEW_DURATION_SEC = 0.9;
const heldPads = new Map(); // id ("note:60" or "drum:kick") -> { startedAtMs }
let keyboardRecording = false;
let keyboardRecordStartMs = 0;
let keyboardRecordedEvents = []; // {type: "note"|"drum", note|sound, startSec, durationSec}
let keyboardTakeBuffer = null;

function isTypingIntoField() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function padOn(id) {
  if (heldPads.has(id)) return; // already sounding (key-repeat) — don't re-trigger
  heldPads.set(id, { startedAtMs: performance.now() });
  document.querySelectorAll(`[data-pad-id="${id}"]`).forEach((el) => el.classList.add("is-active"));

  const sampleRate = engine.ctx.sampleRate;
  const [kind, value] = id.split(":");
  if (kind === "note") {
    const family = document.getElementById("keyboard-instrument").value;
    const buf = engine.ctx.createBuffer(2, Math.ceil(KEYBOARD_PREVIEW_DURATION_SEC * sampleRate), sampleRate);
    renderVoice(engine.ctx, buf, family, [Number(value)], 0, KEYBOARD_PREVIEW_DURATION_SEC, sampleRate);
    playBufferOnce(buf);
  } else {
    const dur = 1.5; // generous fixed buffer; renderDrumHit's own envelope decides the real length
    const buf = engine.ctx.createBuffer(2, Math.ceil(dur * sampleRate), sampleRate);
    renderDrumHit(buf, value, 0, sampleRate);
    playBufferOnce(buf);
  }
}

function padOff(id) {
  const held = heldPads.get(id);
  if (!held) return;
  heldPads.delete(id);
  document.querySelectorAll(`[data-pad-id="${id}"]`).forEach((el) => el.classList.remove("is-active"));
  if (keyboardRecording) {
    const startSec = (held.startedAtMs - keyboardRecordStartMs) / 1000;
    const durationSec = Math.max(0.12, (performance.now() - held.startedAtMs) / 1000);
    const [kind, value] = id.split(":");
    if (kind === "note") keyboardRecordedEvents.push({ type: "note", note: Number(value), startSec, durationSec });
    else keyboardRecordedEvents.push({ type: "drum", sound: value, startSec });
  }
}

function wirePadSurface(container, datasetKey) {
  const idFor = (el) => `${datasetKey}:${el.dataset[datasetKey]}`;
  container.addEventListener("pointerdown", async (e) => {
    const el = e.target.closest(`[data-${datasetKey}]`);
    if (!el) return;
    await engine.resume();
    padOn(idFor(el));
  });
  container.addEventListener("pointerup", (e) => {
    const el = e.target.closest(`[data-${datasetKey}]`);
    if (el) padOff(idFor(el));
  });
  container.addEventListener("pointerleave", (e) => {
    const el = e.target.closest(`[data-${datasetKey}]`);
    if (el) padOff(idFor(el));
  });
}
wirePadSurface(document.getElementById("midi-keyboard"), "note");
wirePadSurface(document.getElementById("mpc-pad-grid"), "drum");

window.addEventListener("keydown", async (e) => {
  if (isTypingIntoField() || e.repeat) return;
  const key = e.key.toLowerCase();
  const note = KEYBOARD_KEY_MAP[key];
  const drum = PAD_KEY_MAP[key];
  if (note === undefined && drum === undefined) return;
  await engine.resume();
  if (note !== undefined) padOn(`note:${note}`);
  if (drum !== undefined) padOn(`drum:${drum}`);
});
window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  const note = KEYBOARD_KEY_MAP[key];
  const drum = PAD_KEY_MAP[key];
  if (note !== undefined) padOff(`note:${note}`);
  if (drum !== undefined) padOff(`drum:${drum}`);
});

const keyboardStatus = document.getElementById("keyboard-status");
const keyboardRecordBtn = document.getElementById("keyboard-record-btn");
const keyboardPreviewBtn = document.getElementById("keyboard-preview-btn");
const keyboardAddBtn = document.getElementById("keyboard-add-btn");
const keyboardDiscardBtn = document.getElementById("keyboard-discard-btn");

function buildKeyboardTakeBuffer() {
  if (!keyboardRecordedEvents.length) return null;
  const family = document.getElementById("keyboard-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  const totalDurationSec = Math.max(...keyboardRecordedEvents.map((n) => n.startSec + (n.durationSec || 0.3))) + 0.5;
  const buf = engine.ctx.createBuffer(2, Math.ceil(totalDurationSec * sampleRate), sampleRate);
  for (const ev of keyboardRecordedEvents) {
    const startSec = Math.max(0, ev.startSec);
    if (ev.type === "note") renderVoice(engine.ctx, buf, family, [ev.note], startSec, ev.durationSec, sampleRate);
    else renderDrumHit(buf, ev.sound, startSec, sampleRate);
  }
  return { buffer: buf, family };
}

keyboardRecordBtn.onclick = async () => {
  await engine.resume();
  if (!keyboardRecording) {
    keyboardRecording = true;
    keyboardRecordStartMs = performance.now();
    keyboardRecordedEvents = [];
    keyboardTakeBuffer = null;
    keyboardRecordBtn.innerHTML = `${uiIconSvg("stop")} Stop recording`;
    keyboardRecordBtn.classList.add("is-recording");
    keyboardStatus.textContent = "Recording — play the pads or keyboard now…";
    keyboardPreviewBtn.disabled = true;
    keyboardAddBtn.disabled = true;
    keyboardDiscardBtn.disabled = true;
  } else {
    keyboardRecording = false;
    // Finalize any pads/keys still held when Stop was pressed.
    for (const id of [...heldPads.keys()]) padOff(id);
    keyboardRecordBtn.innerHTML = `${uiIconSvg("mic")} Record performance`;
    keyboardRecordBtn.classList.remove("is-recording");
    const result = buildKeyboardTakeBuffer();
    if (!result) {
      keyboardStatus.textContent = "Nothing played — try again.";
      return;
    }
    keyboardTakeBuffer = result;
    keyboardStatus.textContent = `Recorded ${keyboardRecordedEvents.length} hit(s)/note(s).`;
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
      loop: track.loop,
      startOffsetSec: track.startOffsetSec,
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
    loop: track.loop,
    startOffsetSec: track.startOffsetSec,
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
  track.loop = data.loop || false;
  track.startOffsetSec = data.startOffsetSec || 0;
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
            loop: t.loop,
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
    track.startOffsetSec = trackData.startOffsetSec || 0;
    track.loop = trackData.loop || false;
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
