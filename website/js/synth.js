// Original, from-scratch Web Audio synthesis engine for the browser DAW.
// No SoundFont here (148MB isn't reasonable to ship on a marketing
// page) — instead a small set of instrument "voices" built from basic
// oscillators + envelopes, the same general technique used by countless
// original synthesizers; not derived from any specific product.

function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Karplus-Strong plucked-string synthesis: a real physical-modeling
// technique (a digital waveguide — the same underlying idea real
// acoustic-modeling synths use), not just another oscillator shape.
// Seed a short delay line with noise (the "pluck") and repeatedly
// average-and-decay it; the averaging acts as a simple low-pass that
// naturally darkens the tone as it rings out, exactly like a real
// plucked string losing its high harmonics first. This is what makes
// guitar/bass sound like a plucked instrument instead of a synth
// pretending to be one.
function karplusStrongPluck(freq, durationSec, sampleRate, damping = 0.996) {
  const period = Math.max(2, Math.round(sampleRate / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const out = new Float32Array(totalSamples);
  let idx = 0;
  for (let i = 0; i < totalSamples; i++) {
    const current = ring[idx];
    const next = ring[(idx + 1) % period];
    out[i] = current;
    ring[idx] = (current + next) * 0.5 * damping;
    idx = (idx + 1) % period;
  }
  return out;
}

// Raw waveform sample for one oscillator at a given instantaneous
// frequency and time — factored out of renderVoice so both the plain
// path and the detuned second-oscillator path can share it.
function waveformSample(wave, freq, t) {
  const phase = 2 * Math.PI * freq * t;
  if (wave === "sine") return Math.sin(phase);
  if (wave === "triangle") return (2 / Math.PI) * Math.asin(Math.sin(phase));
  if (wave === "square") return Math.sign(Math.sin(phase));
  // sawtooth
  const cycles = freq * t;
  return 2 * (cycles - Math.floor(cycles + 0.5));
}

const PLUCKED_FAMILIES = new Set(["guitar", "bass"]);

// A time-varying one-pole lowpass, applied sample-by-sample to a raw
// oscillator signal. Real instruments are brightest right at the
// attack (bow scrape, reed buzz, hammer strike, breath chiff) and get
// progressively duller as the note settles — a pure oscillator has
// none of that, holding its full harmonic content for the whole note,
// which is a big part of why it reads as "digital"/"computer game"
// rather than played. `bright` is `{attackHz, sustainHz, tau}`: the
// cutoff starts at attackHz and exponentially relaxes to sustainHz
// with time-constant tau, independent of the note's own ADSR timing.
function brightnessCutoffHz(bright, t) {
  return bright.sustainHz + (bright.attackHz - bright.sustainHz) * Math.exp(-t / bright.tau);
}

function onePoleLowpassStep(prevOut, input, cutoffHz, sampleRate) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  return prevOut + alpha * (input - prevOut);
}

// Renders one note/chord event into an existing AudioBuffer at a given
// offset, using an oscillator + ADSR-style gain envelope shaped by the
// instrument "family", plus a handful of real-instrument-informed
// touches layered on top (brightness envelope, attack-transient noise
// or a short inharmonic "bell" partial, and light humanization) — see
// the per-effect comments below for why each one matters.
function renderVoice(ctx, buffer, family, pitches, startSec, durationSec, sampleRate) {
  const shapes = {
    keys: {
      wave: "triangle",
      attack: 0.004,
      decay: 0.18,
      sustain: 0.35,
      release: 0.25,
      gain: 0.26,
      bright: { attackHz: 6500, sustainHz: 1900, tau: 0.14 },
      noiseAttack: { level: 0.05, durSec: 0.01, decayTau: 0.006 },
    },
    // Guitar/bass are rendered with real Karplus-Strong string synthesis
    // below (see PLUCKED_FAMILIES) — these envelope numbers are unused
    // for them but kept so other code that reads shapes[family] (e.g.
    // gain) still finds a sensible entry.
    guitar: { wave: "sawtooth", attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.15, gain: 0.5 },
    bass: { wave: "sine", attack: 0.01, decay: 0.08, sustain: 0.85, release: 0.1, gain: 0.7 },
    lead: {
      wave: "triangle",
      attack: 0.02,
      decay: 0.1,
      sustain: 0.7,
      release: 0.15,
      gain: 0.2,
      detune: true,
      bright: { attackHz: 6500, sustainHz: 4500, tau: 0.3 },
    },
    pad: {
      wave: "sawtooth",
      attack: 0.25,
      decay: 0.2,
      sustain: 0.8,
      release: 0.4,
      gain: 0.14,
      detune: true,
      vibrato: true,
      bright: { attackHz: 2600, sustainHz: 1300, tau: 0.6 },
    },
    brass: {
      wave: "sawtooth",
      attack: 0.03,
      decay: 0.1,
      sustain: 0.7,
      release: 0.12,
      gain: 0.18,
      detune: true,
      vibrato: true,
      bright: { attackHz: 6500, sustainHz: 2600, tau: 0.09 },
      noiseAttack: { level: 0.045, durSec: 0.02, decayTau: 0.012 },
    },
    bell: {
      wave: "sine",
      attack: 0.002,
      decay: 0.6,
      sustain: 0.2,
      release: 0.4,
      gain: 0.18,
      bright: { attackHz: 9000, sustainHz: 900, tau: 0.35 },
      // A real bell/tine's clang is inharmonic — a second sine that
      // isn't a clean integer multiple of the fundamental — not just a
      // louder version of the same tone. Ratio 3.01 (not exactly 3) is
      // the point: an exact ratio would just be another harmonic.
      fmBell: { ratio: 3.01, decayTau: 0.25, level: 0.4 },
    },
    flute: {
      wave: "sine",
      attack: 0.04,
      decay: 0.1,
      sustain: 0.75,
      release: 0.15,
      gain: 0.2,
      vibrato: true,
      bright: { attackHz: 4200, sustainHz: 3400, tau: 0.2 },
      noiseAttack: { level: 0.06, durSec: 0.06, decayTau: 0.035 },
    },
    // A sax's real timbre is complex (breath noise, reed buzz), but a
    // sawtooth with a slower attack than guitar/brass and a warmer,
    // longer sustain gives it a reasonably distinct "breathy horn" feel
    // in this simple oscillator-based synth.
    saxophone: {
      wave: "sawtooth",
      attack: 0.06,
      decay: 0.15,
      sustain: 0.8,
      release: 0.2,
      gain: 0.19,
      detune: true,
      vibrato: true,
      bright: { attackHz: 4500, sustainHz: 2400, tau: 0.12 },
      noiseAttack: { level: 0.06, durSec: 0.03, decayTau: 0.02 },
    },
    clarinet: {
      wave: "square",
      attack: 0.05,
      decay: 0.08,
      sustain: 0.85,
      release: 0.12,
      gain: 0.16,
      vibrato: true,
      bright: { attackHz: 3800, sustainHz: 2100, tau: 0.15 },
      noiseAttack: { level: 0.035, durSec: 0.025, decayTau: 0.015 },
    },
    // A bowed string's attack is slow and its tail rings on after the
    // note ends — the opposite envelope shape from a plucked instrument
    // like guitar, which is the actual distinguishing feature here.
    strings: {
      wave: "sawtooth",
      attack: 0.18,
      decay: 0.15,
      sustain: 0.85,
      release: 0.5,
      gain: 0.15,
      detune: true,
      vibrato: true,
      bright: { attackHz: 4200, sustainHz: 2200, tau: 0.2 },
      noiseAttack: { level: 0.03, durSec: 0.07, decayTau: 0.05 },
    },
    // An organ's real timbre is additive (multiple fixed-ratio drawbars),
    // which this simple oscillator model can't reproduce — but its
    // signature *envelope* (instant on, full sustain, no decay stage at
    // all until release) is just as recognizable and easy to model.
    // Deliberately no brightness envelope: a real drawbar organ's tone
    // doesn't get duller as a note holds, unlike every acoustic
    // instrument above.
    organ: { wave: "square", attack: 0.002, decay: 0.001, sustain: 1.0, release: 0.08, gain: 0.16 },
    // Electric piano (Rhodes-style): a short bell-like attack transient
    // that decays quickly to a much quieter sustain — quite different
    // from the acoustic `keys` envelope above. The classic Rhodes/DX7
    // "bark" is exactly the fmBell partial below: an inharmonic
    // overtone that's loud at the strike and gone within ~0.1s.
    epiano: {
      wave: "triangle",
      attack: 0.002,
      decay: 0.35,
      sustain: 0.25,
      release: 0.3,
      gain: 0.2,
      bright: { attackHz: 5200, sustainHz: 1300, tau: 0.18 },
      fmBell: { ratio: 3.98, decayTau: 0.1, level: 0.3 },
    },
    choir: {
      wave: "triangle",
      attack: 0.3,
      decay: 0.2,
      sustain: 0.85,
      release: 0.6,
      gain: 0.13,
      detune: true,
      vibrato: true,
      bright: { attackHz: 2400, sustainHz: 1500, tau: 0.4 },
    },
    // A synth bass is punchier and more clipped-sounding than the sine-
    // wave acoustic `bass` above — a square wave with a faster decay
    // and the classic synth-bass "filter pluck" (bright transient
    // snapping down to a round, sub-heavy sustain).
    synthbass: {
      wave: "square",
      attack: 0.005,
      decay: 0.15,
      sustain: 0.5,
      release: 0.08,
      gain: 0.32,
      bright: { attackHz: 3600, sustainHz: 850, tau: 0.07 },
    },
    // Mallet/percussive pitched instrument: near-instant attack straight
    // into a fast decay, almost no sustain — the opposite envelope shape
    // from every sustained wind/string instrument above. The mallet
    // strike itself is noise, not tone — hence the short noiseAttack.
    marimba: {
      wave: "sine",
      attack: 0.001,
      decay: 0.35,
      sustain: 0.05,
      release: 0.15,
      gain: 0.24,
      bright: { attackHz: 5200, sustainHz: 700, tau: 0.06 },
      noiseAttack: { level: 0.05, durSec: 0.006, decayTau: 0.004 },
    },
    // Tuned a little warmer/breathier than a straight fanfare-brass
    // preset — a lower sustained cutoff and more breath noise reads
    // closer to a cool-jazz-style muted trumpet tone (Chet Baker's own
    // signature sound), without literally reproducing any specific
    // recording.
    trumpet: {
      wave: "sawtooth",
      attack: 0.025,
      decay: 0.1,
      sustain: 0.7,
      release: 0.14,
      gain: 0.19,
      detune: true,
      vibrato: true,
      bright: { attackHz: 5800, sustainHz: 2200, tau: 0.11 },
      noiseAttack: { level: 0.06, durSec: 0.035, decayTau: 0.022 },
    },
  };
  const shape = shapes[family] || shapes.keys;
  // +7 cents: a classic, subtle chorus-style detune amount — enough to
  // create real beating/richness between the two oscillators without
  // sounding out of tune.
  const DETUNE_RATIO = Math.pow(2, 7 / 1200);
  const VIBRATO_RATE_HZ = 5.5;
  const VIBRATO_DEPTH_RATIO = Math.pow(2, 0.3 / 12) - 1; // ~0.3 semitone
  const VIBRATO_ONSET_SEC = 0.15; // real players don't add vibrato instantly on note-on
  const VIBRATO_RAMP_SEC = 0.3;

  for (const pitch of pitches) {
    // Two small "humanizations": every note is a few cents off true
    // pitch (no real performance is machine-precise), and when several
    // pitches land at once (a demo song's block chord), they're spread
    // by a few milliseconds like an actual hand can't strike/strum
    // perfectly simultaneously. Single pattern-editor notes (pitches
    // has length 1) get zero timing offset — that grid staying exactly
    // on the beat is a real feature there, not something to blur.
    const pitchJitterRatio = Math.pow(2, ((Math.random() * 2 - 1) * 3) / 1200);
    const freq = midiToFreq(pitch) * pitchJitterRatio;
    const onsetJitterSec = pitches.length > 1 ? Math.random() * 0.012 : 0;
    const startSample = Math.floor((startSec + onsetJitterSec) * sampleRate);
    const totalSamples = Math.floor(durationSec * sampleRate);
    const data0 = buffer.getChannelData(0);
    const data1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data0;

    if (PLUCKED_FAMILIES.has(family)) {
      // Real physical-modeling synthesis instead of an oscillator
      // pretending to be a plucked string — see karplusStrongPluck.
      // Damping jitter means no two plucks of the same note decay at
      // exactly the same rate, same idea as the pitch/timing jitter.
      const baseDamping = family === "bass" ? 0.9985 : 0.996;
      const damping = baseDamping + (Math.random() * 2 - 1) * 0.0006;
      const samples = karplusStrongPluck(freq, durationSec, sampleRate, damping);
      const fadeInSamples = Math.min(samples.length, Math.floor(0.002 * sampleRate));
      const ampJitter = 0.92 + Math.random() * 0.16;
      for (let i = 0; i < samples.length; i++) {
        const fadeIn = i < fadeInSamples ? i / fadeInSamples : 1;
        const value = samples[i] * fadeIn * shape.gain * ampJitter;
        const idx = startSample + i;
        if (idx >= 0 && idx < data0.length) {
          data0[idx] += value;
          data1[idx] += value;
        }
      }
      continue;
    }

    const attackSamples = Math.floor(shape.attack * sampleRate);
    const decaySamples = Math.floor(shape.decay * sampleRate);
    const releaseSamples = Math.floor(shape.release * sampleRate);
    const sustainSamples = Math.max(0, totalSamples - attackSamples - decaySamples - releaseSamples);
    const ampJitter = 0.9 + Math.random() * 0.18;

    // Two cascaded one-pole stages = a real 2-pole (12dB/octave) lowpass
    // — a single pole only rolls off at 6dB/octave, too gentle to make
    // the brightness envelope clearly audible against a harmonic-rich
    // sawtooth/square wave.
    let lpState1 = 0;
    let lpState2 = 0;
    let noiseLpState = 0;

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

      let freqAtT = freq;
      if (shape.vibrato) {
        const vibratoAmount = Math.min(1, Math.max(0, (t - VIBRATO_ONSET_SEC) / VIBRATO_RAMP_SEC));
        const lfo = Math.sin(2 * Math.PI * VIBRATO_RATE_HZ * t);
        freqAtT = freq * (1 + lfo * VIBRATO_DEPTH_RATIO * vibratoAmount);
      }

      let osc = waveformSample(shape.wave, freqAtT, t);
      if (shape.detune) {
        // A second, slightly-detuned oscillator summed in creates real
        // beating/chorus richness — one of two biggest reasons a flat
        // oscillator reads as "digital" while two reads as an ensemble
        // (the other is the brightness envelope right below).
        osc = (osc + waveformSample(shape.wave, freqAtT * DETUNE_RATIO, t)) * 0.5;
      }

      // The brightness (lowpass) envelope: see brightnessCutoffHz above
      // for why this exists. Organ deliberately has no `bright` entry.
      let toneSample = osc;
      if (shape.bright) {
        const cutoffHz = brightnessCutoffHz(shape.bright, t);
        lpState1 = onePoleLowpassStep(lpState1, osc, cutoffHz, sampleRate);
        lpState2 = onePoleLowpassStep(lpState2, lpState1, cutoffHz, sampleRate);
        toneSample = lpState2;
      }

      let sample = toneSample * envelope * shape.gain * ampJitter;

      if (shape.fmBell) {
        const { ratio, decayTau, level } = shape.fmBell;
        const bellEnv = Math.exp(-t / decayTau);
        sample += Math.sin(2 * Math.PI * freq * ratio * t) * bellEnv * level * envelope * shape.gain;
      }

      if (shape.noiseAttack && t < shape.noiseAttack.durSec * 4) {
        // A short burst of lightly-filtered noise right at note-on —
        // breath chiff for winds/brass, mallet/hammer click for
        // percussive keys — decoupled from the note's own ADSR so it's
        // a real transient "thwack"/"chiff" regardless of how slow the
        // tone's own attack is, the way a real attack transient works.
        const rawNoise = Math.random() * 2 - 1;
        noiseLpState = onePoleLowpassStep(noiseLpState, rawNoise, 2500, sampleRate);
        const noiseEnv = Math.exp(-t / shape.noiseAttack.decayTau);
        sample += noiseLpState * noiseEnv * shape.noiseAttack.level;
      }

      const idx = startSample + i;
      if (idx >= 0 && idx < data0.length) {
        data0[idx] += sample;
        data1[idx] += sample;
      }
    }
  }
}

// A GarageBand-style kit — more than the original 4 sounds, still
// entirely synthesized (no sample library), each voice distinguished
// by real DSP: a pitch-dropping sine for tonal drums (kick/tom/
// cowbell), shaped noise bursts for percussive ones (snare/hats/
// clap/shaker/crash), sized and layered differently per sound so they
// read as genuinely different drums, not the same hit re-pitched.
function writeBurst(data0, data1, startSample, sampleFn, dur, sampleRate) {
  const n = Math.floor(dur * sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const value = sampleFn(t);
    const idx = startSample + i;
    if (idx >= 0 && idx < data0.length) {
      data0[idx] += value;
      data1[idx] += value;
    }
  }
}

const DRUM_VOICES = {
  kick: (t) => Math.sin(2 * Math.PI * (120 * Math.exp(-t * 18)) * t) * Math.exp(-t * 14) * 0.6,
  // A deeper, longer "808-style" kick — a real second kick voice, not
  // the same one re-triggered.
  kick2: (t) => Math.sin(2 * Math.PI * (65 * Math.exp(-t * 9)) * t) * Math.exp(-t * 6) * 0.7,
  snare: (t) => (Math.random() * 2 - 1) * Math.exp(-t * 22) * 0.35,
  // A rimshot is a sharp tonal click plus a touch of noise, much
  // shorter than a full snare hit.
  rimshot: (t) => (Math.sin(2 * Math.PI * 900 * t) * 0.4 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-t * 80),
  hihat: (t) => (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.18,
  // Same noise color as the closed hat, just a much slower decay —
  // the real acoustic difference between an open and closed hi-hat.
  openhat: (t) => (Math.random() * 2 - 1) * Math.exp(-t * 8) * 0.16,
  tom: (t) => Math.sin(2 * Math.PI * (180 * Math.exp(-t * 6)) * t) * Math.exp(-t * 7) * 0.5,
  crash: (t) => (Math.random() * 2 - 1) * Math.exp(-t * 2.5) * 0.22,
  // The classic two-square-wave 808 cowbell tone.
  cowbell: (t) => (Math.sign(Math.sin(2 * Math.PI * 540 * t)) * 0.15 + Math.sign(Math.sin(2 * Math.PI * 800 * t)) * 0.15) * Math.exp(-t * 10),
  // A gentle amplitude flutter (not just a flat decay) is what makes a
  // shaker read as granular grains sliding past each other rather than
  // a single noise burst like the hats.
  shaker: (t) => (Math.random() * 2 - 1) * Math.exp(-t * 45) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 30 * t)) * 0.15,
};

const DRUM_DURATIONS = {
  kick: 0.15,
  kick2: 0.3,
  snare: 0.12,
  rimshot: 0.06,
  hihat: 0.05,
  openhat: 0.3,
  tom: 0.25,
  crash: 1.2,
  cowbell: 0.3,
  shaker: 0.08,
  clap: 0.09,
};

function renderDrumHit(buffer, kind, startSec, sampleRate) {
  const data0 = buffer.getChannelData(0);
  const data1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data0;
  const startSample = Math.floor(startSec * sampleRate);
  const dur = DRUM_DURATIONS[kind] ?? 0.1;
  // A real drummer never hits with identical velocity twice — a small
  // per-hit level jitter keeps a repeated hi-hat/kick pattern from
  // sounding like the same sample copy-pasted on a grid.
  const velocityJitter = 0.88 + Math.random() * 0.24;

  if (kind === "clap") {
    // A real handclap is several near-simultaneous noise bursts (multiple
    // hands/fingers not landing at exactly the same instant), so this
    // layers three short, fast-decaying noise bursts a few milliseconds
    // apart rather than one single envelope like the snare above.
    for (const offsetSec of [0, 0.012, 0.024]) {
      writeBurst(
        data0,
        data1,
        startSample + Math.floor(offsetSec * sampleRate),
        (t) => (Math.random() * 2 - 1) * Math.exp(-t * 35) * 0.3 * velocityJitter,
        dur,
        sampleRate,
      );
    }
    return;
  }

  const voice = DRUM_VOICES[kind];
  if (voice) writeBurst(data0, data1, startSample, (t) => voice(t) * velocityJitter, dur, sampleRate);
}

export { renderVoice, renderDrumHit, midiToFreq };
