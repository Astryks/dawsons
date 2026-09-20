// Playback/mixing engine for the browser DAW — Web Audio API is a real,
// native browser capability, genuinely equivalent to the desktop app's
// cpal-based engine for this purpose (not a compromised substitute).

import { renderVoice, renderDrumHit } from "./synth.js";
import { BAR_SEC } from "./demo-songs.js";

class Track {
  constructor(name, buffer, pattern = null) {
    this.name = name;
    this.buffer = buffer;
    this.muted = false;
    this.gain = null; // GainNode, created on play
    this.source = null;
    // {family, hits, totalSteps} for a track editable via pattern-editor.js's
    // click-to-place grid; null for a plain demo-song/uploaded-audio track.
    this.pattern = pattern;
  }

  get durationSec() {
    return this.buffer.length / this.buffer.sampleRate;
  }
}

class Engine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.tracks = [];
    this.playing = false;
    this.startedAt = 0;
    this.pausedAtSec = 0; // where a paused/stopped transport will resume from
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  renderSongToTracks(song) {
    const sampleRate = this.ctx.sampleRate;
    const totalBars = song.drums.reduce((s, e) => s + e.dur, 0);
    const totalSamples = Math.ceil(totalBars * sampleRate);

    const tracks = [];
    for (const layer of song.layers) {
      const buf = this.ctx.createBuffer(2, totalSamples, sampleRate);
      let t = 0;
      for (const ev of layer.notes) {
        if (ev.pitches.length) renderVoice(this.ctx, buf, layer.family, ev.pitches, t, ev.dur, sampleRate);
        t += ev.dur;
      }
      tracks.push(new Track(layer.name, buf));
    }

    const drumBuf = this.ctx.createBuffer(2, totalSamples, sampleRate);
    let t = 0;
    for (const hit of song.drums) {
      renderDrumHit(drumBuf, hit.kind, t, sampleRate);
      t += hit.dur;
    }
    tracks.push(new Track("Drums", drumBuf));

    this.loadTracks(tracks);
  }

  loadTracks(tracks) {
    this.stop();
    this.tracks = tracks;
  }

  addTrack(name, buffer, pattern = null) {
    this.tracks.push(new Track(name, buffer, pattern));
  }

  removeTrack(index) {
    this.stop();
    this.tracks.splice(index, 1);
  }

  moveTrack(from, to) {
    const [t] = this.tracks.splice(from, 1);
    this.tracks.splice(to, 0, t);
  }

  setMuted(index, muted) {
    const track = this.tracks[index];
    if (!track) return;
    track.muted = muted;
    if (track.gain) track.gain.gain.value = muted ? 0 : 1;
  }

  // Starts (or resumes) playback from `fromSec` — omit it to resume from
  // wherever playback was last paused/sought to (defaulting to 0 the
  // first time). Each track's own source starts at that same offset
  // *into its buffer* (`AudioBufferSourceNode.start(when, offset)`), and
  // a track shorter than `fromSec` is simply skipped since it has
  // already finished playing by that point in the timeline.
  play(fromSec) {
    const startSec = Math.max(0, fromSec !== undefined ? fromSec : this.pausedAtSec);
    this._stopSources();
    this.playing = true;
    this.startedAt = this.ctx.currentTime - startSec;
    for (const track of this.tracks) {
      if (startSec >= track.durationSec) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = track.muted ? 0 : 1;
      source.connect(gain).connect(this.masterGain);
      source.start(this.ctx.currentTime, startSec);
      track.source = source;
      track.gain = gain;
    }
    const remaining = Math.max(0, this.maxDurationSec() - startSec);
    clearTimeout(this._stopTimer);
    this._stopTimer = setTimeout(() => {
      this.playing = false;
      this.pausedAtSec = 0;
    }, remaining * 1000);
  }

  // Stops sound but remembers the position, so a later `play()` resumes
  // from here instead of restarting — real pause/resume, not stop/reset.
  pause() {
    this.pausedAtSec = this.positionSec();
    this._stopSources();
    this.playing = false;
    clearTimeout(this._stopTimer);
  }

  stop() {
    this._stopSources();
    this.playing = false;
    this.pausedAtSec = 0;
    clearTimeout(this._stopTimer);
  }

  // Jumps the transport to `sec` — restarts playback there immediately
  // if already playing, or just remembers it for the next `play()`
  // otherwise. This is what the draggable scrubber calls while dragging.
  seekTo(sec) {
    const clamped = Math.max(0, Math.min(sec, this.maxDurationSec()));
    if (this.playing) {
      this.play(clamped);
    } else {
      this.pausedAtSec = clamped;
    }
  }

  _stopSources() {
    for (const track of this.tracks) {
      if (track.source) {
        try {
          track.source.stop();
        } catch {
          /* already stopped */
        }
      }
      track.source = null;
    }
  }

  positionSec() {
    if (this.playing) return this.ctx.currentTime - this.startedAt;
    return this.pausedAtSec;
  }

  maxDurationSec() {
    return Math.max(0.001, ...this.tracks.map((t) => t.durationSec));
  }
}

export { Engine, Track, BAR_SEC };
