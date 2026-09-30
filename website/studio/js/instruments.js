// Keyboard instruments. Sampled instruments come from smplr (MIT), which
// streams properly licensed samples on demand:
//   - Grand Piano: "Splendid Grand Piano" (AKAI Steinway, public domain)
//   - Electric pianos: Greg Sullivan Wurlitzer EP200 (CC-BY 3.0) and
//     VCSL TX81Z FM piano (CC0)
//   - Everything else: FluidR3_GM General MIDI soundfont by Frank Wen
//     (MIT / CC-BY 3.0), pre-rendered by gleitz/midi-js-soundfonts
// The built-in synths are original Web Audio code and need no download,
// so the keyboard always makes sound even offline.

import { SplendidGrandPiano, ElectricPiano, Soundfont } from "../vendor/smplr-1.1.0.mjs";
import { midiToFreq } from "./audio.js";

const sf = (id, name, instrument, group) => ({ id, name, type: "soundfont", instrument, group });

export const INSTRUMENTS = [
  { id: "grand", name: "Grand Piano (sampled Steinway)", type: "piano", group: "Pianos" },
  { id: "wurli", name: "Electric Piano – Wurlitzer", type: "epiano", instrument: "WurlitzerEP200", group: "Pianos" },
  { id: "fmep", name: "FM Electric Piano (TX81Z)", type: "epiano", instrument: "TX81Z", group: "Pianos" },
  sf("rhodes", "Electric Piano 1 (GM)", "electric_piano_1", "Pianos"),
  sf("honky", "Honky-tonk Piano", "honkytonk_piano", "Pianos"),
  sf("organ", "Drawbar Organ", "drawbar_organ", "Organs"),
  sf("rockorgan", "Rock Organ", "rock_organ", "Organs"),
  sf("church", "Church Organ", "church_organ", "Organs"),
  sf("strings", "String Ensemble", "string_ensemble_1", "Strings & Choir"),
  sf("violin", "Violin", "violin", "Strings & Choir"),
  sf("cello", "Cello", "cello", "Strings & Choir"),
  sf("pizz", "Pizzicato Strings", "pizzicato_strings", "Strings & Choir"),
  sf("choir", "Choir Aahs", "choir_aahs", "Strings & Choir"),
  sf("nylon", "Acoustic Guitar (nylon)", "acoustic_guitar_nylon", "Guitars"),
  sf("steel", "Acoustic Guitar (steel)", "acoustic_guitar_steel", "Guitars"),
  sf("cleangtr", "Electric Guitar (clean)", "electric_guitar_clean", "Guitars"),
  sf("odgtr", "Overdriven Guitar", "overdriven_guitar", "Guitars"),
  sf("abass", "Upright Bass", "acoustic_bass", "Bass"),
  sf("ebass", "Electric Bass (finger)", "electric_bass_finger", "Bass"),
  sf("slap", "Slap Bass", "slap_bass_1", "Bass"),
  sf("synbass", "Synth Bass", "synth_bass_1", "Bass"),
  { id: "subbass", name: "Sub Bass (built-in)", type: "synth", preset: "sub", group: "Bass" },
  sf("warmpad", "Warm Pad", "pad_2_warm", "Synths & Pads"),
  sf("polypad", "Polysynth Pad", "pad_3_polysynth", "Synths & Pads"),
  sf("halopad", "Halo Pad", "pad_7_halo", "Synths & Pads"),
  sf("sawlead", "Saw Lead", "lead_2_sawtooth", "Synths & Pads"),
  sf("sqlead", "Square Lead", "lead_1_square", "Synths & Pads"),
  { id: "analog", name: "Analog Synth (built-in)", type: "synth", preset: "analog", group: "Synths & Pads" },
  { id: "chip", name: "Chiptune (built-in)", type: "synth", preset: "chip", group: "Synths & Pads" },
  sf("brass", "Brass Section", "brass_section", "Brass & Winds"),
  sf("trumpet", "Trumpet", "trumpet", "Brass & Winds"),
  sf("sax", "Alto Sax", "alto_sax", "Brass & Winds"),
  sf("flute", "Flute", "flute", "Brass & Winds"),
  sf("marimba", "Marimba", "marimba", "Mallets & Bells"),
  sf("vibes", "Vibraphone", "vibraphone", "Mallets & Bells"),
  sf("musicbox", "Music Box", "music_box", "Mallets & Bells"),
  sf("kalimba", "Kalimba", "kalimba", "Mallets & Bells"),
  sf("steeldrum", "Steel Drums", "steel_drums", "Mallets & Bells"),
];

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];
}

// Creates a playable instrument on any BaseAudioContext (live or offline).
// Returns { ready: Promise, start({note, velocity, time, duration}) -> stopFn, stop() }.
export function createInstrument(c, id, destination, onProgress) {
  const def = instrumentById(id);
  const common = { destination, onLoadProgress: onProgress };
  let inst;
  try {
    if (def.type === "piano") inst = SplendidGrandPiano(c, { ...common, decayTime: 0.6 });
    else if (def.type === "epiano") inst = ElectricPiano(c, { ...common, instrument: def.instrument });
    else if (def.type === "soundfont") inst = Soundfont(c, { ...common, kit: "FluidR3_GM", instrument: def.instrument });
  } catch (e) {
    console.warn("Sampled instrument failed, using built-in synth", e);
  }
  if (!inst) return new BuiltInSynth(c, destination, def.preset || "analog");
  return wrapSmplr(inst);
}

function wrapSmplr(inst) {
  const ready = (inst.ready || inst.load).then(() => undefined);
  return {
    ready,
    start({ note, velocity = 100, time, duration }) {
      return inst.start({ note, velocity, time, duration: duration ?? undefined });
    },
    stop(target) {
      inst.stop(target);
    },
  };
}

// Small polyphonic subtractive synth (original code).
class BuiltInSynth {
  constructor(c, destination, preset) {
    this.c = c;
    this.out = c.createGain();
    this.out.gain.value = 0.35;
    this.out.connect(destination);
    this.preset = preset;
    this.voices = new Set();
    this.ready = Promise.resolve();
  }

  start({ note, velocity = 100, time, duration }) {
    const c = this.c;
    const t = Math.max(time ?? c.currentTime, c.currentTime);
    const f = midiToFreq(note);
    const v = velocity / 127;
    const g = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    const oscs = [];
    let attack = 0.01;
    let release = 0.25;
    let sustain = 0.6;
    if (this.preset === "sub") {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const o2 = c.createOscillator();
      o2.type = "triangle";
      o2.frequency.value = f;
      const g2 = c.createGain();
      g2.gain.value = 0.25;
      o2.connect(g2).connect(filt);
      oscs.push(o, o2);
      o.connect(filt);
      filt.frequency.value = 900;
      sustain = 0.9;
      release = 0.15;
    } else if (this.preset === "chip") {
      const o = c.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      o.connect(filt);
      oscs.push(o);
      filt.frequency.value = 8000;
      attack = 0.002;
      release = 0.08;
      sustain = 0.5;
    } else {
      [-7, 7].forEach((det) => {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(filt);
        oscs.push(o);
      });
      filt.Q.value = 4;
      filt.frequency.setValueAtTime(Math.min(18000, f * 2), t);
      filt.frequency.exponentialRampToValueAtTime(Math.min(18000, f * 10 + 1500 * v), t + 0.03);
      filt.frequency.exponentialRampToValueAtTime(Math.min(18000, f * 3 + 400), t + 0.6);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v + 0.05, t + attack);
    g.gain.exponentialRampToValueAtTime(sustain * v + 0.02, t + attack + 0.25);
    filt.connect(g).connect(this.out);
    oscs.forEach((o) => o.start(t));
    const voice = { g, oscs, stopped: false };
    this.voices.add(voice);
    const stop = (when) => {
      if (voice.stopped) return;
      voice.stopped = true;
      const te = Math.max(when ?? c.currentTime, t + attack);
      g.gain.cancelScheduledValues(te);
      g.gain.setTargetAtTime(0.0001, te, release / 4);
      oscs.forEach((o) => o.stop(te + release * 2));
      this.voices.delete(voice);
    };
    if (duration != null) stop(t + duration);
    return (when) => stop(typeof when === "number" ? when : undefined);
  }

  stop() {
    [...this.voices].forEach((v) => {
      v.stopped = false;
      v.g.gain.cancelScheduledValues(this.c.currentTime);
      v.g.gain.setTargetAtTime(0.0001, this.c.currentTime, 0.02);
      v.oscs.forEach((o) => { try { o.stop(this.c.currentTime + 0.1); } catch { /* */ } });
    });
    this.voices.clear();
  }
}
