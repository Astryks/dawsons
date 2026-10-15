// Computer-keyboard layouts.
//  - "compact" (v2, default): drums and piano at the same time, no mode switch.
//      Drums, left hand (3x6, same shape as the pads):
//        Q W E R T Y  -> toms / percussion
//        A S D F G `  -> hats / cymbals   (` = the key left of 1)
//        Z X C V B N  -> kicks / snares / clap / rim
//      Piano, right hand:  U I _ P [ ]   (black keys; O is the E-F gap)
//                         H J K L ; '    (white keys C D E F G A, \ = B)
//      Octave: , (down)  . (up)
//    Matching uses KeyboardEvent.code (physical position), so it works the
//    same on AZERTY/QWERTZ/Dvorak keyboards.
//  - "classic" (v1): one set of keys, toggled between drums and piano.

export const COMPACT_PADS = [
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "Backquote",
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN",
];
export const COMPACT_PIANO = {
  KeyH: 0, KeyU: 1, KeyJ: 2, KeyI: 3, KeyK: 4, KeyL: 5, KeyP: 6,
  Semicolon: 7, BracketLeft: 8, Quote: 9, BracketRight: 10, Backslash: 11,
};
export const CLASSIC_PADS = ["1", "2", "3", "4", "5", "6", "q", "w", "e", "r", "t", "y", "a", "s", "d", "f", "g", "h"];
export const CLASSIC_PIANO = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

const LABEL = { Backquote: "`", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\" };
export const codeLabel = (code) => LABEL[code] || code.replace(/^Key|^Digit/, "");

export function getLayout() {
  try {
    return localStorage.getItem("studio.keyLayout") === "classic" ? "classic" : "compact";
  } catch {
    return "compact";
  }
}
export function saveLayout(l) {
  try { localStorage.setItem("studio.keyLayout", l); } catch { /* private mode */ }
}

// Labels shown on the pads / piano keys for the given layout.
export function padLabels(layout) {
  return layout === "classic" ? CLASSIC_PADS.map((k) => k.toUpperCase()) : COMPACT_PADS.map(codeLabel);
}
export function pianoLabels(layout) {
  const src = layout === "classic" ? CLASSIC_PIANO : COMPACT_PIANO;
  return Object.entries(src).map(([k, off]) => [layout === "classic" ? k.toUpperCase() : codeLabel(k), off]);
}

// Resolves a keydown to an action for the active layout.
// Returns {type:"pad", index} | {type:"note", offset, id} | {type:"octave", d} | null
export function resolveKey(e, layout, keysMode) {
  if (layout === "compact") {
    const p = COMPACT_PADS.indexOf(e.code);
    if (p >= 0) return { type: "pad", index: p };
    if (e.code in COMPACT_PIANO) return { type: "note", offset: COMPACT_PIANO[e.code], id: e.code };
    if (e.code === "Comma") return { type: "octave", d: -1 };
    if (e.code === "Period") return { type: "octave", d: 1 };
    return null;
  }
  const k = e.key.toLowerCase();
  if (k === "z") return { type: "octave", d: -1 };
  if (k === "x") return { type: "octave", d: 1 };
  if (keysMode === "drums") {
    const i = CLASSIC_PADS.indexOf(k);
    return i >= 0 ? { type: "pad", index: i } : null;
  }
  if (k in CLASSIC_PIANO) return { type: "note", offset: CLASSIC_PIANO[k], id: k };
  return null;
}
