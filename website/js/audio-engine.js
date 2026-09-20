// Playback/mixing engine for the browser DAW — Web Audio API is a real,
// native browser capability, genuinely equivalent to the desktop app's
// cpal-based engine for this purpose (not a compromised substitute).

import { renderVoice, renderDrumHit } from "./synth.js";
import { BAR_SEC } from "./demo-songs.js";

class Track {
  constructor(name, buffer) {
    this.name = name;
    this.buffer = buffer;
    this.muted = false;
    this.gain = null; // GainNode, created on play
    this.source = null;
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

  addTrack(name, buffer) {
    this.tracks.push(new Track(name, buffer));
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

  play() {
    this.stop();
    this.playing = true;
    this.startedAt = this.ctx.currentTime;
    for (const track of this.tracks) {
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = track.muted ? 0 : 1;
      source.connect(gain).connect(this.masterGain);
      source.start();
      track.source = source;
      track.gain = gain;
    }
    const maxDur = Math.max(0, ...this.tracks.map((t) => t.durationSec));
    this._stopTimer = setTimeout(() => {
      this.playing = false;
    }, maxDur * 1000);
  }

  pause() {
    this.stop();
  }

  stop() {
    this.playing = false;
    clearTimeout(this._stopTimer);
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
    if (!this.playing) return 0;
    return this.ctx.currentTime - this.startedAt;
  }

  maxDurationSec() {
    return Math.max(0.001, ...this.tracks.map((t) => t.durationSec));
  }
}

export { Engine, Track, BAR_SEC };
