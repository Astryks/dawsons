// A playful two-deck DJ mixer — "make it fun, like a virtual console."
// Deliberately additive: a new section below the main timeline, not a
// replacement for it, and it reuses the existing Engine's AudioContext
// and the project's own already-loaded track buffers (via the "Your
// Layers" track list) rather than building a second, parallel
// audio-loading path. Every control here is real and functional, not
// decorative: a real equal-power crossfade, a real per-deck 3-band EQ
// (three BiquadFilterNodes in series, not one tone knob), a real
// scrub-by-dragging jog wheel, real hot cues, and a real (manual-BPM)
// sync that adjusts playback rate — the same vari-speed technique this
// page's pitch/stretch controls already use elsewhere.

// One playable "deck" — its own gain → 3-band EQ → deck-output gain
// chain, connected once at construction into the shared master output.
// AudioBufferSourceNode can only be started once, so play()/pause() has
// to create a fresh source node each time, tracking position manually —
// the same pattern the main Engine's own play/pause already uses.
class DjDeck {
  constructor(ctx, outputNode) {
    this.ctx = ctx;
    this.buffer = null;
    this.name = "";
    this.bpm = null;

    this.volumeGain = ctx.createGain();
    this.lowFilter = ctx.createBiquadFilter();
    this.lowFilter.type = "lowshelf";
    this.lowFilter.frequency.value = 320;
    this.midFilter = ctx.createBiquadFilter();
    this.midFilter.type = "peaking";
    this.midFilter.frequency.value = 1000;
    this.midFilter.Q.value = 0.8;
    this.highFilter = ctx.createBiquadFilter();
    this.highFilter.type = "highshelf";
    this.highFilter.frequency.value = 3200;
    // Crossfader-controlled gain — set from outside (see wireCrossfader).
    this.deckOut = ctx.createGain();
    this.volumeGain.connect(this.lowFilter).connect(this.midFilter).connect(this.highFilter).connect(this.deckOut);
    this.deckOut.connect(outputNode);

    this.source = null;
    this.playing = false;
    this.playbackRate = 1;
    this._startedAtCtxTime = 0;
    this._startedAtPosSec = 0;
    this._pausedPosSec = 0;
    this.cues = [null, null, null, null];
  }

  load(buffer, name) {
    this.stop();
    this.buffer = buffer;
    this.name = name;
    this._pausedPosSec = 0;
    this.cues = [null, null, null, null];
  }

  get durationSec() {
    return this.buffer ? this.buffer.duration : 0;
  }

  positionSec() {
    if (!this.playing) return this._pausedPosSec;
    return this._startedAtPosSec + (this.ctx.currentTime - this._startedAtCtxTime) * this.playbackRate;
  }

  play() {
    if (!this.buffer || this.playing) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.playbackRate;
    src.connect(this.volumeGain);
    const startPos = Math.min(this._pausedPosSec, Math.max(0, this.buffer.duration - 0.01));
    src.start(0, startPos);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this._pausedPosSec = 0;
        this.source = null;
      }
    };
    this.source = src;
    this._startedAtCtxTime = this.ctx.currentTime;
    this._startedAtPosSec = startPos;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this._pausedPosSec = this.positionSec();
    const src = this.source;
    this.source = null;
    this.playing = false;
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already stopped */
    }
  }

  stop() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    this.playing = false;
    this._pausedPosSec = 0;
  }

  // Re-seeking requires tearing down and recreating the live source
  // node (AudioBufferSourceNode has no seek — same constraint noted on
  // play()), so a scratch drag pauses-and-resumes under the hood.
  seekTo(sec) {
    if (!this.buffer) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this._pausedPosSec = Math.max(0, Math.min(this.buffer.duration, sec));
    if (wasPlaying) this.play();
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.25, Math.min(4, rate));
    if (this.source) {
      // Re-anchor position tracking so positionSec() stays accurate
      // across a live rate change.
      this._pausedPosSec = this.positionSec();
      this._startedAtCtxTime = this.ctx.currentTime;
      this._startedAtPosSec = this._pausedPosSec;
      this.source.playbackRate.value = this.playbackRate;
    }
  }

  toggleCue(index) {
    if (!this.buffer) return;
    if (this.cues[index] == null) {
      this.cues[index] = this.positionSec();
    } else {
      this.seekTo(this.cues[index]);
    }
  }
}

// Equal-power crossfade curve (constant perceived loudness across the
// sweep, no volume dip in the middle) — the same principle behind this
// page's own stereo pan law (Web Audio's StereoPannerNode already uses
// an equal-power curve for left/right; this applies the identical
// cos/sin-quarter-circle shape across the two decks instead of two ears).
function equalPowerGains(x) {
  const angle = (Math.max(0, Math.min(1, x)) * Math.PI) / 2;
  return { gainA: Math.cos(angle), gainB: Math.sin(angle) };
}

function initDjMixer(engine) {
  const root = document.getElementById("dj-mixer");
  if (!root) return;

  const decks = {
    a: new DjDeck(engine.ctx, engine.masterGain),
    b: new DjDeck(engine.ctx, engine.masterGain),
  };

  function applyCrossfader() {
    const slider = document.getElementById("dj-crossfader");
    const { gainA, gainB } = equalPowerGains(Number(slider.value) / 100);
    decks.a.deckOut.gain.value = gainA;
    decks.b.deckOut.gain.value = gainB;
  }
  document.getElementById("dj-crossfader").addEventListener("input", applyCrossfader);
  applyCrossfader();

  function refreshTrackOptions(letter) {
    const select = root.querySelector(`[data-deck-select="${letter}"]`);
    const current = select.value;
    select.innerHTML = '<option value="">No track loaded</option>';
    engine.tracks.forEach((track, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = track.name;
      select.appendChild(opt);
    });
    // Keep the current selection if that track still exists at the same
    // index — a full re-render of the whole track list is more common
    // than a mid-session reorder while DJing.
    if (current && Number(current) < engine.tracks.length) select.value = current;
  }

  ["a", "b"].forEach((letter) => {
    const deck = decks[letter];
    const select = root.querySelector(`[data-deck-select="${letter}"]`);
    select.addEventListener("mousedown", () => refreshTrackOptions(letter));
    select.addEventListener("change", () => {
      const i = Number(select.value);
      if (Number.isNaN(i) || !engine.tracks[i]) return;
      deck.load(engine.tracks[i].buffer, engine.tracks[i].name);
      updatePlayLabel(letter);
    });

    const playBtn = root.querySelector(`[data-deck-play="${letter}"]`);
    playBtn.addEventListener("click", () => {
      if (!deck.buffer) return;
      if (deck.playing) deck.pause();
      else deck.play();
      updatePlayLabel(letter);
    });

    root.querySelector(`[data-deck-cue="${letter}"]`).addEventListener("click", () => {
      deck.pause();
      deck.seekTo(0);
      updatePlayLabel(letter);
    });

    root.querySelector(`[data-deck-sync="${letter}"]`).addEventListener("click", () => {
      const otherLetter = letter === "a" ? "b" : "a";
      const other = decks[otherLetter];
      const thisBpmInput = root.querySelector(`[data-deck-bpm="${letter}"]`);
      const otherBpmInput = root.querySelector(`[data-deck-bpm="${otherLetter}"]`);
      const thisBpm = Number(thisBpmInput.value) || 120;
      const otherBpm = Number(otherBpmInput.value) || 120;
      deck.bpm = thisBpm;
      other.bpm = otherBpm;
      deck.setPlaybackRate(otherBpm / thisBpm);
    });

    root.querySelector(`[data-deck-volume="${letter}"]`).addEventListener("input", (e) => {
      deck.volumeGain.gain.value = Number(e.target.value) / 100;
    });

    ["high", "mid", "low"].forEach((band) => {
      const slider = root.querySelector(`[data-deck-eq="${letter}-${band}"]`);
      const filt = band === "high" ? deck.highFilter : band === "mid" ? deck.midFilter : deck.lowFilter;
      slider.addEventListener("input", (e) => {
        filt.gain.value = Number(e.target.value);
      });
    });

    for (let i = 0; i < 4; i++) {
      const pad = root.querySelector(`[data-deck-cuepad="${letter}-${i}"]`);
      pad.addEventListener("click", () => {
        deck.toggleCue(i);
        pad.classList.toggle("is-set", deck.cues[i] != null);
        updatePlayLabel(letter);
      });
    }

    // Jog wheel — a single-finger/mouse drag around the platter scrubs
    // playback position. Mapped by angle swept (not raw pixels) so it
    // feels the same regardless of where on the disc you grab it, the
    // same way a real jog wheel works; one full rotation moves the
    // track by a fixed, deliberately-coarse 8 seconds (fine scratching
    // isn't the goal here, confident scrubbing is).
    const platter = root.querySelector(`[data-deck-platter="${letter}"]`);
    const disc = platter.querySelector(".dj-mixer__platter-disc");
    let dragging = false;
    let lastAngle = 0;
    function angleFromEvent(e) {
      const rect = platter.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const point = e.touches ? e.touches[0] : e;
      return Math.atan2(point.clientY - cy, point.clientX - cx);
    }
    function dragStart(e) {
      if (!deck.buffer) return;
      dragging = true;
      lastAngle = angleFromEvent(e);
      e.preventDefault();
    }
    function dragMove(e) {
      if (!dragging) return;
      const angle = angleFromEvent(e);
      let delta = angle - lastAngle;
      // Normalize the wrap-around at ±π so a full rotation doesn't
      // register as a sudden huge jump.
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      lastAngle = angle;
      const secondsPerRotation = 8;
      const deltaSec = (delta / (2 * Math.PI)) * secondsPerRotation;
      deck.seekTo(deck.positionSec() + deltaSec);
      updatePlayLabel(letter);
      e.preventDefault();
    }
    function dragEnd() {
      dragging = false;
    }
    platter.addEventListener("mousedown", dragStart);
    platter.addEventListener("touchstart", dragStart, { passive: false });
    window.addEventListener("mousemove", dragMove);
    window.addEventListener("touchmove", dragMove, { passive: false });
    window.addEventListener("mouseup", dragEnd);
    window.addEventListener("touchend", dragEnd);

    function updatePlayLabel(l) {
      const d = decks[l];
      const btn = root.querySelector(`[data-deck-play="${l}"]`);
      btn.textContent = d.playing ? "Pause" : "Play";
      const discEl = root.querySelector(`[data-deck-platter="${l}"] .dj-mixer__platter-disc`);
      discEl.classList.toggle("is-spinning", d.playing);
      const sel = root.querySelector(`[data-deck-select="${l}"]`);
      sel.title = d.buffer ? `${d.name} — ${d.positionSec().toFixed(1)}s / ${d.durationSec.toFixed(1)}s` : "";
    }
    // Keep the spinning-disc visual and position tooltip live while
    // a deck plays — cheap (one class toggle + one title string),
    // same spirit as the main timeline's own rAF-driven playhead.
    setInterval(() => updatePlayLabel(letter), 250);
  });

  refreshTrackOptions("a");
  refreshTrackOptions("b");
}

export { initDjMixer };
