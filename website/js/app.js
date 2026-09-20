import { Engine } from "./audio-engine.js";
import { DEMO_SONGS } from "./demo-songs.js";
import { INSTRUMENT_ICONS } from "./synth.js";
import { reverseBuffer, pitchShiftBuffer, buildEffectChain } from "./effects.js";

const engine = new Engine();
let currentSong = null;
let uploadedBuffer = null;
let uploadedName = "";
let playheadTimer = null;

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
    el.innerHTML = '<p class="daw-note">Pick an example song from the sidebar to see a layered project right away.</p>';
    return;
  }
  const maxDur = engine.maxDurationSec();
  el.innerHTML = engine.tracks
    .map((track, i) => {
      const pct = Math.max(2, (track.durationSec / maxDur) * 100);
      return `
        <div class="timeline-layer">
          <div class="timeline-layer__label">${track.name}</div>
          <div class="timeline-layer__track">
            <div class="timeline-layer__bar layer-color-${i % 6}" style="width:${pct}%"></div>
            <div class="timeline-layer__playhead" id="playhead-${i}" style="display:none"></div>
          </div>
        </div>`;
    })
    .join("");
}

function updatePlayhead() {
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
  if (engine.playing) playheadTimer = requestAnimationFrame(updatePlayhead);
}

document.getElementById("play-btn").onclick = async () => {
  await engine.resume();
  engine.play();
  updatePlayhead();
};
document.getElementById("pause-btn").onclick = () => engine.pause();
document.getElementById("stop-btn").onclick = () => engine.stop();

// --- Upload + clip tools ---
document.getElementById("upload-track").onclick = () => document.getElementById("upload-input").click();
document.getElementById("upload-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await engine.resume();
  const arrayBuffer = await file.arrayBuffer();
  uploadedBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
  uploadedName = file.name;
  document.getElementById("effects-panel").style.display = "block";
};

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
  });
  chainOut.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();

  engine.addTrack(`${uploadedName} (edited)`, rendered);
  renderTrackList();
  renderTimeline();
};

renderSongPicker();

// If arriving from the Discover page's "Open a similar layered example"
// link, load that song immediately instead of leaving the DAW empty.
const requestedSong = new URLSearchParams(window.location.search).get("song");
if (requestedSong) {
  const match = DEMO_SONGS.find((s) => s.title === requestedSong);
  if (match) loadSong(match);
}
