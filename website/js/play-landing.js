// Landing-page toy: a 4x4 drum kit and one octave of keys.
// Original Web Audio voices so the page makes sound with no samples.
const PADS = [
  ["hat", "Hat", "1"], ["open", "Open", "2"], ["clap", "Clap", "3"], ["rim", "Rim", "4"],
  ["crash", "Crash", "Q"], ["ride", "Ride", "W"], ["bell", "Bell", "E"], ["shaker", "Shake", "R"],
  ["tom", "Tom", "A"], ["tommid", "Mid", "S"], ["tomlo", "Floor", "D"], ["snare2", "Snare 2", "F"],
  ["kick", "Kick", "Z"], ["kick2", "Kick 2", "X"], ["snare", "Snare", "C"], ["perc", "Perc", "V"],
];
const ROLES = {
  kick: "kick", kick2: "kick", snare: "snare", snare2: "snare", clap: "snare", rim: "snare",
  hat: "hat", open: "hat", crash: "cym", ride: "cym", bell: "perc", shaker: "perc",
  tom: "tom", tommid: "tom", tomlo: "tom", perc: "perc",
};
const PAD_CODES = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
  KeyQ: 4, KeyW: 5, KeyE: 6, KeyR: 7,
  KeyA: 8, KeyS: 9, KeyD: 10, KeyF: 11,
  KeyZ: 12, KeyX: 13, KeyC: 14, KeyV: 15,
};
const KEY_CODES = { KeyH: 0, KeyU: 1, KeyJ: 2, KeyI: 3, KeyK: 4, KeyL: 5, KeyP: 6, Semicolon: 7, BracketLeft: 8, Quote: 9, BracketRight: 10, Backslash: 11 };

let ctx;
let noiseBuf;
let hits = 0;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== "running") ctx.resume();
  return ctx;
}

function envGain(c, t, attack, decay, peak) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noise(c, t, dur, filterType, freq, peak) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  const g = envGain(c, t, 0.005, dur, peak);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(c, t, freq, dur, type, peak) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = envGain(c, t, 0.005, dur, peak);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function playPad(id, velocity = 0.9) {
  const c = audio();
  const t = c.currentTime;
  const v = Math.max(0.3, Math.min(1, velocity));
  if (id === "kick" || id === "kick2") {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(id === "kick" ? 150 : 120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = envGain(c, t, 0.005, 0.28, 0.9 * v);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.35);
  } else if (id === "snare" || id === "snare2") {
    tone(c, t, id === "snare" ? 190 : 160, 0.15, "triangle", 0.35 * v);
    noise(c, t, 0.18, "highpass", 1800, 0.45 * v);
  } else if (id === "clap") {
    noise(c, t, 0.12, "bandpass", 1400, 0.4 * v);
    noise(c, t + 0.02, 0.1, "bandpass", 1800, 0.3 * v);
  } else if (id === "hat" || id === "open" || id === "shaker") {
    noise(c, t, id === "open" ? 0.28 : 0.05, "highpass", 7000, 0.28 * v);
  } else if (id === "crash" || id === "ride") {
    noise(c, t, id === "crash" ? 0.7 : 0.4, "highpass", 5000, 0.3 * v);
  } else if (id === "rim" || id === "bell" || id === "perc") {
    tone(c, t, id === "bell" ? 980 : 420, 0.12, "square", 0.2 * v);
  } else {
    const f = id === "tom" ? 220 : id === "tommid" ? 160 : 110;
    const o = tone(c, t, f, 0.22, "sine", 0.5 * v);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.18);
  }
  hits += 1;
  window.__landingHits = hits;
}

function playNote(offset, velocity = 0.7) {
  const c = audio();
  const t = c.currentTime;
  const midi = 60 + offset;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 2;
  const g = envGain(c, t, 0.01, 0.45, 0.28 * velocity);
  const g2 = c.createGain();
  g2.gain.value = 0.25;
  o.connect(g).connect(c.destination);
  o2.connect(g2).connect(g);
  o.start(t); o2.start(t);
  o.stop(t + 0.6); o2.stop(t + 0.6);
  hits += 1;
  window.__landingHits = hits;
}

function flash(el) {
  el.classList.remove("is-hit");
  void el.offsetWidth;
  el.classList.add("is-hit");
}

const padRoot = document.querySelector("[data-pads]");
const padButtons = [];
PADS.forEach(([id, name, key], i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "playcard__pad";
  b.dataset.role = ROLES[id];
  b.dataset.pad = id;
  b.innerHTML = `${name}<small>${key}</small>`;
  b.setAttribute("aria-label", `${name}, key ${key}`);
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    flash(b);
    playPad(id);
  });
  padRoot.appendChild(b);
  padButtons[i] = b;
});

const keyRoot = document.querySelector("[data-keys]");
const whites = [0, 2, 4, 5, 7, 9, 11];
const labels = ["H", "J", "K", "L", ";", "'", "\\"];
whites.forEach((semi, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = labels[i];
  b.setAttribute("aria-label", `Piano key ${labels[i]}`);
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    flash(b);
    playNote(semi);
  });
  keyRoot.appendChild(b);
});

const down = new Set();
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (e.repeat || down.has(e.code)) return;
  if (e.code in PAD_CODES) {
    e.preventDefault();
    down.add(e.code);
    const i = PAD_CODES[e.code];
    flash(padButtons[i]);
    playPad(PADS[i][0], e.shiftKey ? 1 : 0.85);
  } else if (e.code in KEY_CODES) {
    e.preventDefault();
    down.add(e.code);
    const semi = KEY_CODES[e.code];
    const white = whites.indexOf(semi);
    if (white >= 0) flash(keyRoot.children[white]);
    playNote(semi, e.shiftKey ? 1 : 0.75);
  }
});
window.addEventListener("keyup", (e) => down.delete(e.code));

const form = document.getElementById("make-form");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = new URLSearchParams({ song: document.getElementById("make-prompt").value || "happy pop" });
  location.href = `studio/?${q}`;
});
document.querySelectorAll("[data-song]").forEach((b) => {
  b.addEventListener("click", () => {
    document.getElementById("make-prompt").value = b.dataset.song;
    form.requestSubmit();
  });
});
