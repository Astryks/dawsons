// Original, from-scratch Web Audio synthesis engine for the browser DAW.
// No SoundFont here (148MB isn't reasonable to ship on a marketing
// page) — instead a small set of instrument "voices" built from basic
// oscillators + envelopes, the same general technique used by countless
// original synthesizers; not derived from any specific product.

function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Renders one note/chord event into an existing AudioBuffer at a given
// offset, using a simple oscillator + ADSR-style gain envelope shaped by
// the instrument "family". Additive: multiple pitches (a chord) just
// call this once per pitch.
function renderVoice(ctx, buffer, family, pitches, startSec, durationSec, sampleRate) {
  const shapes = {
    keys: { wave: "triangle", attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.2, gain: 0.22 },
    guitar: { wave: "sawtooth", attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.15, gain: 0.16 },
    bass: { wave: "sine", attack: 0.01, decay: 0.08, sustain: 0.85, release: 0.1, gain: 0.35 },
    lead: { wave: "triangle", attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.15, gain: 0.2 },
    pad: { wave: "sawtooth", attack: 0.25, decay: 0.2, sustain: 0.8, release: 0.4, gain: 0.14 },
    brass: { wave: "sawtooth", attack: 0.03, decay: 0.1, sustain: 0.7, release: 0.12, gain: 0.18 },
    bell: { wave: "sine", attack: 0.002, decay: 0.6, sustain: 0.2, release: 0.4, gain: 0.18 },
    flute: { wave: "sine", attack: 0.04, decay: 0.1, sustain: 0.75, release: 0.15, gain: 0.2 },
    // A sax's real timbre is complex (breath noise, reed buzz), but a
    // sawtooth with a slower attack than guitar/brass and a warmer,
    // longer sustain gives it a reasonably distinct "breathy horn" feel
    // in this simple oscillator-based synth.
    saxophone: { wave: "sawtooth", attack: 0.06, decay: 0.15, sustain: 0.8, release: 0.2, gain: 0.19 },
    clarinet: { wave: "square", attack: 0.05, decay: 0.08, sustain: 0.85, release: 0.12, gain: 0.16 },
    // A bowed string's attack is slow and its tail rings on after the
    // note ends — the opposite envelope shape from a plucked instrument
    // like guitar, which is the actual distinguishing feature here.
    strings: { wave: "sawtooth", attack: 0.18, decay: 0.15, sustain: 0.85, release: 0.5, gain: 0.15 },
    // An organ's real timbre is additive (multiple fixed-ratio drawbars),
    // which this simple oscillator model can't reproduce — but its
    // signature *envelope* (instant on, full sustain, no decay stage at
    // all until release) is just as recognizable and easy to model.
    organ: { wave: "square", attack: 0.002, decay: 0.001, sustain: 1.0, release: 0.08, gain: 0.16 },
    // Electric piano (Rhodes-style): a short bell-like attack transient
    // that decays quickly to a much quieter sustain — quite different
    // from the acoustic `keys` envelope above.
    epiano: { wave: "triangle", attack: 0.002, decay: 0.35, sustain: 0.25, release: 0.3, gain: 0.2 },
    choir: { wave: "triangle", attack: 0.3, decay: 0.2, sustain: 0.85, release: 0.6, gain: 0.13 },
    // A synth bass is punchier and more clipped-sounding than the sine-
    // wave acoustic `bass` above — a square wave with a faster decay.
    synthbass: { wave: "square", attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.08, gain: 0.3 },
    // Mallet/percussive pitched instrument: near-instant attack straight
    // into a fast decay, almost no sustain — the opposite envelope shape
    // from every sustained wind/string instrument above.
    marimba: { wave: "sine", attack: 0.001, decay: 0.35, sustain: 0.05, release: 0.15, gain: 0.24 },
    trumpet: { wave: "sawtooth", attack: 0.02, decay: 0.08, sustain: 0.75, release: 0.1, gain: 0.2 },
  };
  const shape = shapes[family] || shapes.keys;

  for (const pitch of pitches) {
    const freq = midiToFreq(pitch);
    const startSample = Math.floor(startSec * sampleRate);
    const totalSamples = Math.floor(durationSec * sampleRate);
    const data0 = buffer.getChannelData(0);
    const data1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data0;

    const attackSamples = Math.floor(shape.attack * sampleRate);
    const decaySamples = Math.floor(shape.decay * sampleRate);
    const releaseSamples = Math.floor(shape.release * sampleRate);
    const sustainSamples = Math.max(0, totalSamples - attackSamples - decaySamples - releaseSamples);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let envelope;
      if (i < attackSamples) {
        envelope = i / Math.max(1, attackSamples);
      } else if (i < attackSamples + decaySamples) {
        const p = (i - attackSamples) / Math.max(1, decaySamples);
        envelope = 1.0 - p * (1.0 - shape.sustain);
      } else if (i < attackSamples + decaySamples + sustainSamples) {
        envelope = shape.sustain;
      } else {
        const p = (i - attackSamples - decaySamples - sustainSamples) / Math.max(1, releaseSamples);
        envelope = shape.sustain * Math.max(0, 1.0 - p);
      }

      let sample;
      const phase = 2 * Math.PI * freq * t;
      if (shape.wave === "sine") {
        sample = Math.sin(phase);
      } else if (shape.wave === "triangle") {
        sample = (2 / Math.PI) * Math.asin(Math.sin(phase));
      } else if (shape.wave === "square") {
        // A clarinet's real timbre is dominated by odd harmonics (it
        // behaves acoustically like a closed pipe) — a square wave is
        // the classic, simple synthesis approximation of that same
        // odd-harmonic-only spectrum, a textbook technique.
        sample = Math.sign(Math.sin(phase));
      } else {
        // sawtooth
        const cycles = freq * t;
        sample = 2 * (cycles - Math.floor(cycles + 0.5));
      }

      const value = sample * envelope * shape.gain;
      const idx = startSample + i;
      if (idx >= 0 && idx < data0.length) {
        data0[idx] += value;
        data1[idx] += value;
      }
    }
  }
}

// Renders a simple drum hit (kick/snare/hihat) as noise/pitch-drop
// bursts, since there's no sample library here — good enough for demo
// songs, not a full drum-machine emulation.
function renderDrumHit(buffer, kind, startSec, sampleRate) {
  const data0 = buffer.getChannelData(0);
  const data1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data0;
  const startSample = Math.floor(startSec * sampleRate);

  if (kind === "kick") {
    const dur = 0.15;
    const n = Math.floor(dur * sampleRate);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const freq = 120 * Math.exp(-t * 18);
      const env = Math.exp(-t * 14);
      const value = Math.sin(2 * Math.PI * freq * t) * env * 0.6;
      const idx = startSample + i;
      if (idx >= 0 && idx < data0.length) {
        data0[idx] += value;
        data1[idx] += value;
      }
    }
  } else if (kind === "snare") {
    const dur = 0.12;
    const n = Math.floor(dur * sampleRate);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 22);
      const value = (Math.random() * 2 - 1) * env * 0.35;
      const idx = startSample + i;
      if (idx >= 0 && idx < data0.length) {
        data0[idx] += value;
        data1[idx] += value;
      }
    }
  } else if (kind === "hihat") {
    const dur = 0.05;
    const n = Math.floor(dur * sampleRate);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 60);
      const value = (Math.random() * 2 - 1) * env * 0.18;
      const idx = startSample + i;
      if (idx >= 0 && idx < data0.length) {
        data0[idx] += value;
        data1[idx] += value;
      }
    }
  } else if (kind === "clap") {
    // A real handclap is several near-simultaneous noise bursts (multiple
    // hands/fingers not landing at exactly the same instant), so this
    // layers three short, fast-decaying noise bursts a few milliseconds
    // apart rather than one single envelope like the snare above.
    const burstOffsetsSec = [0, 0.012, 0.024];
    const dur = 0.09;
    const n = Math.floor(dur * sampleRate);
    for (const offsetSec of burstOffsetsSec) {
      const offsetSamples = Math.floor(offsetSec * sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 35);
        const value = (Math.random() * 2 - 1) * env * 0.3;
        const idx = startSample + offsetSamples + i;
        if (idx >= 0 && idx < data0.length) {
          data0[idx] += value;
          data1[idx] += value;
        }
      }
    }
  }
}

export { renderVoice, renderDrumHit, midiToFreq };
