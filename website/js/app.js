import { Engine } from "./audio-engine.js";
import { DEMO_SONGS } from "./demo-songs.js";
import { renderVoice } from "./synth.js";
import { reverseBuffer, pitchShiftBuffer, buildEffectChain } from "./effects.js";
import { detectNotes, snapNotesToScale, MAJOR_SCALE, MINOR_SCALE } from "./pitch.js";
import { STARTERS } from "./starter-patterns.js";
import { paletteFor, soundLabel, createPattern, toggleStep, autoFillEveryBeats } from "./pattern-editor.js";
import { instrumentIconSvg, uiIconSvg } from "./instrument-icons.js";

const engine = new Engine();
let currentSong = null;
let uploadedBuffer = null;
let uploadedName = "";
let playheadTimer = null;
// Which track's row is open in the left sidebar's sound picker, and
// which sound from its palette is currently "armed" to place on tap.
let activeTrackIndex = null;
let armedSound = null;
// Whether the "+" add-instrument menu is currently open in the timeline.
let addInstrumentMenuOpen = false;

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
    div.className = "instrument-track";
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
      engine.setMuted(i, !track.muted);
      btn.classList.toggle("is-muted", track.muted);
      renderWaveform();
    };
  });
  el.querySelectorAll("button[data-solo]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.solo);
      const track = engine.tracks[i];
      engine.setSolo(i, !track.solo);
      btn.classList.toggle("is-solo", track.solo);
      renderWaveform();
    };
  });
  el.querySelectorAll("input[data-pan]").forEach((input) => {
    input.oninput = () => {
      engine.setPan(Number(input.dataset.pan), Number(input.value) / 100);
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
        <div class="timeline-layer${isActive ? " timeline-layer--active" : ""}">
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

  el.innerHTML = trackRows + emptyNote + renderAddInstrumentHtml();
  renderWaveform();
}

// The "+" row at the end of the timeline for adding one of the
// instruments not already present — Lead/Pad/Brass/Bell/Flute, beyond
// the four ready to go by default.
function renderAddInstrumentHtml() {
  const present = new Set(engine.tracks.map((t) => t.pattern?.family).filter(Boolean));
  const available = EXTRA_FAMILIES.filter((f) => !present.has(f));
  if (!available.length) return "";
  if (!addInstrumentMenuOpen) {
    return `<button type="button" class="timeline-add-btn" id="add-instrument-btn">+ Add an instrument</button>`;
  }
  const options = available
    .map(
      (f) =>
        `<button type="button" class="daw-starter__btn daw-starter__btn--${f}" data-add-family="${f}">
          ${instrumentIconSvg(f, `instrument-icon--${f}`)}<span>${FAMILY_DISPLAY_NAME[f]}</span>
        </button>`,
    )
    .join("");
  return `<div class="timeline-add-menu">${options}</div>`;
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
    addInstrumentMenuOpen = true;
    renderTimeline();
    return;
  }
  const addFamilyBtn = e.target.closest("[data-add-family]");
  if (addFamilyBtn) {
    handleAddInstrumentTrack(addFamilyBtn.dataset.addFamily);
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
  engine.addTrack(FAMILY_DISPLAY_NAME[family] || family, pattern.buffer, pattern);
  activeTrackIndex = engine.tracks.length - 1;
  armedSound = paletteFor(family)[0]?.key || null;
  addInstrumentMenuOpen = false;
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
  statusEl.textContent = `Loaded ${name} — set reverse/pitch, then Apply.`;
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
  };
  for (const def of EFFECT_STACK_DEFS) {
    const checked = document.getElementById(`${prefix}-fx-${def.key}`).checked;
    if (!checked) continue;
    if (!def.slider) {
      opts[def.param] = true;
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
    opts.compressEnabled
  );
}

document.getElementById("fx-apply-btn").onclick = async () => {
  if (!uploadedBuffer) return;
  await engine.resume();

  let buffer = uploadedBuffer;
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
      voiceRenderBtn.disabled = false;
    } catch {
      voiceStatus.textContent = "Couldn't decode the recording — try again.";
    }
  };
  mediaRecorder.start();
  voiceRecordBtn.innerHTML = `${uiIconSvg("stop")} Stop recording`;
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

  engine.addTrack(`Voice as ${FAMILY_DISPLAY_NAME[family] || family}`, finalBuffer);
  renderTrackList();
  renderTimeline();
  voiceStatus.textContent = "Added to timeline.";
};

renderSongPicker();
initializeDefaultTracks();
updateScrubber();

// If arriving from the Discover page's "Open a similar layered example"
// link, load that song immediately instead of leaving the DAW empty.
const requestedSong = new URLSearchParams(window.location.search).get("song");
if (requestedSong) {
  const match = DEMO_SONGS.find((s) => s.title === requestedSong);
  if (match) loadSong(match);
}
