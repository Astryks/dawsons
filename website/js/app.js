import { Engine } from "./audio-engine.js";
import { DEMO_SONGS } from "./demo-songs.js";
import { INSTRUMENT_ICONS, renderVoice } from "./synth.js";
import { reverseBuffer, pitchShiftBuffer, buildEffectChain } from "./effects.js";
import { detectNotes, snapNotesToScale, MAJOR_SCALE, MINOR_SCALE } from "./pitch.js";
import { STARTERS } from "./starter-patterns.js";
import { paletteFor, soundLabel, createPattern, toggleStep, autoFillEveryBeats } from "./pattern-editor.js";

const engine = new Engine();
let currentSong = null;
let uploadedBuffer = null;
let uploadedName = "";
let playheadTimer = null;
// Which track's row is open in the left sidebar's sound picker, and
// which sound from its palette is currently "armed" to place on tap.
let activeTrackIndex = null;
let armedSound = null;

const familyIcon = {
  keys: INSTRUMENT_ICONS.keys,
  guitar: INSTRUMENT_ICONS.guitar,
  bass: INSTRUMENT_ICONS.bass,
  lead: INSTRUMENT_ICONS.lead,
  pad: INSTRUMENT_ICONS.pad,
  brass: INSTRUMENT_ICONS.brass,
  bell: INSTRUMENT_ICONS.bell,
  flute: INSTRUMENT_ICONS.flute,
};

function renderSongPicker() {
  const el = document.getElementById("song-picker");
  el.innerHTML = "";
  for (const song of DEMO_SONGS) {
    const div = document.createElement("div");
    div.className = "instrument-track";
    div.innerHTML = `
      <div class="instrument-track__icon">🎵</div>
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
  currentSong = song;
  engine.renderSongToTracks(song);
  renderTrackList();
  renderTimeline();
}

function renderTrackList() {
  const el = document.getElementById("track-list");
  el.innerHTML = "";
  engine.tracks.forEach((track, i) => {
    const family = currentSong?.layers[i]?.family;
    const icon = familyIcon[family] || "🎵";
    const div = document.createElement("div");
    div.className = "instrument-track";
    div.innerHTML = `
      <div class="instrument-track__icon">${icon}</div>
      <div class="instrument-track__body">
        <div class="instrument-track__name">${track.name}</div>
        <div class="instrument-track__controls">
          <button class="instrument-track__mute" data-index="${i}">Mute</button>
          <button class="instrument-track__mute" data-move="up" data-index="${i}" title="Move up">↑</button>
          <button class="instrument-track__mute" data-move="down" data-index="${i}" title="Move down">↓</button>
          <button class="instrument-track__mute" data-remove="${i}" title="Remove">✕</button>
        </div>
      </div>`;
    el.appendChild(div);
  });

  el.querySelectorAll("button[data-index]:not([data-move])").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.index);
      const track = engine.tracks[i];
      engine.setMuted(i, !track.muted);
      btn.classList.toggle("is-muted", track.muted);
    };
  });
  el.querySelectorAll("button[data-move]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.index);
      const to = btn.dataset.move === "up" ? i - 1 : i + 1;
      if (to < 0 || to >= engine.tracks.length) return;
      engine.moveTrack(i, to);
      renderTrackList();
      renderTimeline();
    };
  });
  el.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.onclick = () => {
      engine.removeTrack(Number(btn.dataset.remove));
      renderTrackList();
      renderTimeline();
    };
  });
}

function renderTimeline() {
  const el = document.getElementById("timeline");
  if (!engine.tracks.length) {
    el.innerHTML =
      '<p class="daw-note">Tap an instrument above, or pick an example song from the sidebar, to see a layered project right away.</p>';
    return;
  }
  const maxDur = engine.maxDurationSec();
  el.innerHTML = engine.tracks
    .map((track, i) => {
      const isActive = i === activeTrackIndex;
      const pct = Math.max(2, (track.durationSec / maxDur) * 100);
      const body = track.pattern
        ? renderPatternGridHtml(track, i)
        : `<div class="timeline-layer__bar layer-color-${i % 6}" style="width:${pct}%"></div>`;
      return `
        <div class="timeline-layer${isActive ? " timeline-layer--active" : ""}">
          <div class="timeline-layer__label" data-track-index="${i}">${track.name}</div>
          <div class="timeline-layer__track">
            ${body}
            <div class="timeline-layer__playhead" id="playhead-${i}" style="display:none"></div>
          </div>
        </div>`;
    })
    .join("");
}

// Renders one pattern-backed track's row as a grid of clickable steps —
// tapping an empty step places the currently armed sound, tapping a
// filled step removes it (see the #timeline click-delegation below).
function renderPatternGridHtml(track, trackIndex) {
  const palette = paletteFor(track.pattern.family);
  let html = `<div class="pattern-grid" data-track-index="${trackIndex}">`;
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

function updateScrubber() {
  const maxDur = engine.maxDurationSec();
  const pos = engine.positionSec();
  const pct = engine.tracks.length ? Math.max(0, Math.min(100, (pos / maxDur) * 100)) : 0;
  document.getElementById("scrubber-fill").style.width = `${pct}%`;
  document.getElementById("scrubber-thumb").style.left = `${pct}%`;
  document.getElementById("scrubber-time").textContent = engine.tracks.length
    ? `${formatTime(pos)} / ${formatTime(maxDur)}`
    : "0:00";
}

function updatePlayhead() {
  updateScrubber();
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

document.getElementById("play-btn").onclick = async () => {
  await engine.resume();
  engine.play();
  updatePlayhead();
};
document.getElementById("pause-btn").onclick = () => {
  engine.pause();
  updatePlayhead();
};
document.getElementById("stop-btn").onclick = () => {
  engine.stop();
  updatePlayhead();
};

// --- Draggable scrubber: click anywhere on the bar to jump there, or
// drag the thumb to scrub through the project while it plays. ---
const scrubberEl = document.getElementById("scrubber");
let isScrubbing = false;

function seekFromPointer(clientX) {
  if (!engine.tracks.length) return;
  const rect = scrubberEl.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  engine.seekTo(frac * engine.maxDurationSec());
  updateScrubber();
}

scrubberEl.addEventListener("pointerdown", (e) => {
  isScrubbing = true;
  scrubberEl.setPointerCapture(e.pointerId);
  seekFromPointer(e.clientX);
});
scrubberEl.addEventListener("pointermove", (e) => {
  if (isScrubbing) seekFromPointer(e.clientX);
});
scrubberEl.addEventListener("pointerup", (e) => {
  isScrubbing = false;
  try {
    scrubberEl.releasePointerCapture(e.pointerId);
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
  }
});

function handleStepClick(trackIndex, step) {
  const track = engine.tracks[trackIndex];
  if (!track || !track.pattern) return;
  activeTrackIndex = trackIndex;
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
  track.buffer = autoFillEveryBeats(engine.ctx, engine.ctx.sampleRate, track.pattern, armedSound, Number(fillBtn.dataset.every));
  renderTimeline();
});

// --- "Tap an instrument, hear it right away" starter strip ---
function renderStarterGrid() {
  const el = document.getElementById("starter-grid");
  el.innerHTML = STARTERS.map(
    (s) =>
      `<button type="button" class="daw-starter__btn daw-starter__btn--${s.key}" data-starter="${s.key}">
        <span class="daw-starter__icon">${s.icon}</span><span>${s.label}</span>
      </button>`,
  ).join("");
  el.querySelectorAll("button[data-starter]").forEach((btn) => {
    btn.onclick = () => handleAddStarterInstrument(btn.dataset.starter);
  });
}

async function handleAddStarterInstrument(starterKey) {
  const starter = STARTERS.find((s) => s.key === starterKey);
  if (!starter) return;
  await engine.resume();
  const pattern = createPattern(engine.ctx, engine.ctx.sampleRate, starter.family, starter.hits);
  engine.addTrack(starter.label, pattern.buffer, pattern);
  activeTrackIndex = engine.tracks.length - 1;
  armedSound = paletteFor(starter.family)[0]?.key || null;
  renderTrackList();
  renderTimeline();
  renderSoundPicker();
  engine.play();
  updatePlayhead();
}

// --- Upload + clip tools ---
async function handleUploadedFile(file) {
  await engine.resume();
  const arrayBuffer = await file.arrayBuffer();
  uploadedBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
  uploadedName = file.name;
  document.getElementById("effects-panel").style.display = "block";
}

document.getElementById("upload-track").onclick = () => document.getElementById("upload-input").click();
document.getElementById("upload-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (file) await handleUploadedFile(file);
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
  const val = document.getElementById(valId);
  slider.oninput = () => (val.textContent = fmt(slider.value));
}
wireSlider("fx-pitch", "fx-pitch-val", (v) => `${v} st`);
wireSlider("fx-eq-gain", "fx-eq-gain-val", (v) => `${v} dB`);
wireSlider("fx-eq-freq", "fx-eq-freq-val", (v) => `${v} Hz`);
wireSlider("fx-reverb", "fx-reverb-val", (v) => `${v}%`);
wireSlider("fx-delay", "fx-delay-val", (v) => `${v}%`);
wireSlider("fx-robotic-hz", "fx-robotic-hz-val", (v) => `${v} Hz`);
wireSlider("fx-muffle-hz", "fx-muffle-hz-val", (v) => `${v} Hz`);
wireSlider("voice-robotic-hz", "voice-robotic-hz-val", (v) => `${v} Hz`);
wireSlider("voice-muffle-hz", "voice-muffle-hz-val", (v) => `${v} Hz`);

// Toggles which voice-effect dial row is visible based on the paired
// <select>'s value, for both the clip-tools panel and the voice panel.
function wireVoiceEffectSelect(selectId, roboticRowId, muffleRowId) {
  const select = document.getElementById(selectId);
  const roboticRow = document.getElementById(roboticRowId);
  const muffleRow = document.getElementById(muffleRowId);
  select.onchange = () => {
    roboticRow.style.display = select.value === "robotic" ? "flex" : "none";
    muffleRow.style.display = select.value === "muffled" ? "flex" : "none";
  };
}
wireVoiceEffectSelect("fx-voice-effect", "fx-robotic-row", "fx-muffle-row");
wireVoiceEffectSelect("voice-effect", "voice-robotic-row", "voice-muffle-row");

function voiceEffectOptsFrom(selectId, roboticHzId, muffleHzId) {
  const effect = document.getElementById(selectId).value;
  return {
    roboticHz: effect === "robotic" ? Number(document.getElementById(roboticHzId).value) : 0,
    muffleCutoffHz: effect === "muffled" ? Number(document.getElementById(muffleHzId).value) : 0,
  };
}

document.getElementById("fx-apply-btn").onclick = async () => {
  if (!uploadedBuffer) return;
  await engine.resume();

  let buffer = uploadedBuffer;
  if (document.getElementById("fx-reverse").checked) buffer = reverseBuffer(engine.ctx, buffer);
  const semitones = Number(document.getElementById("fx-pitch").value);
  if (semitones !== 0) buffer = pitchShiftBuffer(engine.ctx, buffer, semitones);

  const eqGainDb = Number(document.getElementById("fx-eq-gain").value);
  const eqFreqHz = Number(document.getElementById("fx-eq-freq").value);
  const reverbWet = Number(document.getElementById("fx-reverb").value) / 100;
  const delayWet = Number(document.getElementById("fx-delay").value) / 100;

  // Render the effect chain offline into a new buffer so it becomes a
  // real, independent track (not a live-only effect graph).
  const tailSec = 2.0 + (reverbWet > 0 ? 3 : 0) + (delayWet > 0 ? 1 : 0);
  const totalSamples = Math.ceil((buffer.duration + tailSec) * engine.ctx.sampleRate);
  const offlineCtx = new OfflineAudioContext(2, totalSamples, engine.ctx.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  const chainOut = buildEffectChain(offlineCtx, source, {
    eqGainDb,
    eqFreqHz,
    eqQ: 1,
    compressEnabled: false,
    reverbWet,
    reverbRoom: 0.5,
    delayWet,
    delayMs: 250,
    delayFeedback: 0.3,
    ...voiceEffectOptsFrom("fx-voice-effect", "fx-robotic-hz", "fx-muffle-hz"),
  });
  chainOut.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();

  engine.addTrack(`${uploadedName} (edited)`, rendered);
  renderTrackList();
  renderTimeline();
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
    voiceRecordBtn.textContent = "🎤 Start recording";
    voiceStatus.textContent = "Processing…";
    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    try {
      recordedVoiceBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
      voiceStatus.textContent = `Recorded ${recordedVoiceBuffer.duration.toFixed(1)}s`;
      voiceRenderBtn.disabled = false;
    } catch {
      voiceStatus.textContent = "Couldn't decode the recording — try again.";
    }
  };
  mediaRecorder.start();
  voiceRecordBtn.textContent = "⏹ Stop recording";
  voiceStatus.textContent = "Recording…";
};

voiceRenderBtn.onclick = async () => {
  if (!recordedVoiceBuffer) return;
  await engine.resume();

  let notes = detectNotes(recordedVoiceBuffer);
  if (document.getElementById("voice-autotune").checked) {
    const tonic = Number(document.getElementById("voice-tonic").value);
    const scale = document.getElementById("voice-scale").value === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    notes = snapNotesToScale(notes, tonic, scale);
  }
  if (!notes.length) {
    voiceStatus.textContent = "No clear pitch detected — try singing louder or more sustained notes.";
    return;
  }

  const family = document.getElementById("voice-instrument").value;
  const sampleRate = engine.ctx.sampleRate;
  const totalDurationSec = Math.max(...notes.map((n) => n.startSec + n.durationSec)) + 0.5;
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  const rawBuffer = engine.ctx.createBuffer(2, totalSamples, sampleRate);
  for (const n of notes) {
    renderVoice(engine.ctx, rawBuffer, family, [n.note], n.startSec, n.durationSec, sampleRate);
  }

  const voiceOpts = voiceEffectOptsFrom("voice-effect", "voice-robotic-hz", "voice-muffle-hz");
  let finalBuffer = rawBuffer;
  if (voiceOpts.roboticHz > 0 || voiceOpts.muffleCutoffHz > 0) {
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = rawBuffer;
    const chainOut = buildEffectChain(offlineCtx, source, voiceOpts);
    chainOut.connect(offlineCtx.destination);
    source.start();
    finalBuffer = await offlineCtx.startRendering();
  }

  engine.addTrack(`Voice as ${INSTRUMENT_ICONS[family] || ""} ${family}`.trim(), finalBuffer);
  renderTrackList();
  renderTimeline();
  voiceStatus.textContent = "Added to timeline.";
};

renderSongPicker();
renderStarterGrid();
updateScrubber();

// If arriving from the Discover page's "Open a similar layered example"
// link, load that song immediately instead of leaving the DAW empty.
const requestedSong = new URLSearchParams(window.location.search).get("song");
if (requestedSong) {
  const match = DEMO_SONGS.find((s) => s.title === requestedSong);
  if (match) loadSong(match);
}
