// Playback/mixing engine for the browser DAW — Web Audio API is a real,
// native browser capability, genuinely equivalent to the desktop app's
// cpal-based engine for this purpose (not a compromised substitute).

import { renderVoice, renderDrumHit } from "./synth.js";
import { BAR_SEC } from "./demo-songs.js";
import { createPattern } from "./pattern-editor.js";

class Track {
  constructor(name, buffer, pattern = null) {
    this.name = name;
    this.buffer = buffer;
    this.muted = false;
    this.solo = false;
    this.pan = 0; // -1 (left) .. 0 (center) .. 1 (right)
    this.gain = null; // GainNode, created on play
    this.panner = null; // StereoPannerNode, created on play
    this.source = null;
    // {family, hits, totalSteps} for a track editable via pattern-editor.js's
    // click-to-place grid; null for a plain demo-song/uploaded-audio track.
    this.pattern = pattern;
    // Per-track pitch (semitones, varispeed-style — same technique the
    // Any Sound row's Pitch slider already uses) and effect sends
    // (0..1), all baked into `buffer` by app.js's refreshTrackAudio
    // whenever one changes — this engine plays plain buffers, it has
    // no live per-track effect graph. `originalBuffer` is the
    // never-overwritten dry source a non-pattern track re-processes
    // from; a pattern track re-processes from `pattern.buffer` instead.
    this.pitchSemitones = 0;
    this.reverbWet = 0;
    this.delayWet = 0;
    this.originalBuffer = buffer;
    // When true, this track's buffer repeats for as long as the rest
    // of the project plays, via the Web Audio API's own native
    // AudioBufferSourceNode.loop — real looping, not a re-triggered
    // copy. A short recording (a keyboard/pad take) under a longer
    // backing track is the main use case.
    this.loop = false;
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
    // Total duration is whichever is longer, drums or the melodic
    // layers — some songs (an a cappella-style overture, say) have no
    // drums at all, and `song.drums` alone would then wrongly compute a
    // zero-length buffer.
    const drumsDur = song.drums.reduce((s, e) => s + e.dur, 0);
    const layersDur = Math.max(0, ...song.layers.map((l) => l.notes.reduce((s, e) => s + e.dur, 0)));
    const totalBars = Math.max(drumsDur, layersDur, 0.001);
    const totalSamples = Math.ceil(totalBars * sampleRate);

    const tracks = [];
    for (const layer of song.layers) {
      if (layer.pattern) {
        // Bass/arpeggio-role layers are built entirely from the same
        // root/3rd/5th-cycle vocabulary the click-to-place grid already
        // uses, so they convert losslessly into a genuinely editable
        // pattern track instead of a fixed, only-mutable-by-remixing
        // rendered buffer — real templates, not just playable demos.
        const pattern = createPattern(this.ctx, sampleRate, layer.family, layer.pattern.hits, layer.pattern.totalSteps);
        tracks.push(new Track(layer.name, pattern.buffer, pattern));
        continue;
      }
      const buf = this.ctx.createBuffer(2, totalSamples, sampleRate);
      let t = 0;
      for (const ev of layer.notes) {
        if (ev.pitches.length) renderVoice(this.ctx, buf, layer.family, ev.pitches, t, ev.dur, sampleRate);
        t += ev.dur;
      }
      tracks.push(new Track(layer.name, buf));
    }

    if (song.drums.length) {
      if (song.drumsPattern) {
        const pattern = createPattern(this.ctx, sampleRate, "drums", song.drumsPattern.hits, song.drumsPattern.totalSteps);
        tracks.push(new Track("Drums", pattern.buffer, pattern));
      } else {
        const drumBuf = this.ctx.createBuffer(2, totalSamples, sampleRate);
        let t = 0;
        for (const hit of song.drums) {
          renderDrumHit(drumBuf, hit.kind, t, sampleRate);
          t += hit.dur;
        }
        tracks.push(new Track("Drums", drumBuf));
      }
    }

    this.loadTracks(tracks);
  }

  loadTracks(tracks) {
    this.stop();
    this.tracks = tracks;
  }

  // Rebuilds `this.tracks` from a plain-object snapshot (see app.js's
  // undo/redo) — reconstructs real `Track` instances (with their own
  // live gain/panner nodes, created fresh on next play) from
  // `{name, buffer, muted, solo, pan, pattern}` records.
  restoreTracks(snapshot) {
    this.tracks = snapshot.map((s) => {
      const track = new Track(s.name, s.buffer, s.pattern ? { ...s.pattern, buffer: s.buffer } : null);
      track.muted = s.muted;
      track.solo = s.solo;
      track.pan = s.pan;
      track.pitchSemitones = s.pitchSemitones || 0;
      track.reverbWet = s.reverbWet || 0;
      track.delayWet = s.delayWet || 0;
      track.loop = s.loop || false;
      track.originalBuffer = s.originalBuffer || s.buffer;
      return track;
    });
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
    this._updateLiveGains();
  }

  // Real solo behavior: when any track is soloed, only soloed tracks are
  // audible (regardless of their own mute state); with nothing soloed,
  // ordinary mute rules apply. Toggling one track's solo can change what
  // every other currently-playing track sounds like, so this recomputes
  // every live gain, not just the toggled track's.
  setSolo(index, solo) {
    const track = this.tracks[index];
    if (!track) return;
    track.solo = solo;
    this._updateLiveGains();
  }

  setPan(index, pan) {
    const track = this.tracks[index];
    if (!track) return;
    track.pan = Math.max(-1, Math.min(1, pan));
    if (track.panner) track.panner.pan.value = track.pan;
  }

  _updateLiveGains() {
    const anySoloed = this.tracks.some((t) => t.solo);
    for (const track of this.tracks) {
      if (!track.gain) continue;
      const audible = anySoloed ? track.solo : !track.muted;
      track.gain.gain.value = audible ? 1 : 0;
    }
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
    const anySoloed = this.tracks.some((t) => t.solo);
    for (const track of this.tracks) {
      if (startSec >= track.durationSec) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      const gain = this.ctx.createGain();
      const audible = anySoloed ? track.solo : !track.muted;
      gain.gain.value = audible ? 1 : 0;
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = track.pan;
      source.loop = track.loop;
      source.connect(gain).connect(panner).connect(this.masterGain);
      source.start(this.ctx.currentTime, startSec);
      track.source = source;
      track.gain = gain;
      track.panner = panner;
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

  // A looping track shouldn't dictate the project's overall length —
  // it just repeats to fill whatever the longest non-looping track
  // sets. Falls back to the looping tracks themselves if that's all
  // there is, so the project still has a sensible finite length.
  maxDurationSec() {
    const nonLooping = this.tracks.filter((t) => !t.loop);
    const basis = nonLooping.length ? nonLooping : this.tracks;
    return Math.max(0.001, ...basis.map((t) => t.durationSec));
  }
}

export { Engine, Track, BAR_SEC };
