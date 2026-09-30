// On-screen piano: mouse/touch (multi-touch, glissando), highlights for
// computer-key and MIDI input.
import { noteName } from "./audio.js";

const BLACK = new Set([1, 3, 6, 8, 10]);

// Computer keys -> semitone offset from the current octave's C.
export const PIANO_KEYS = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

export class Piano {
  constructor(el, { onDown, onUp }) {
    this.el = el;
    this.onDown = onDown;
    this.onUp = onUp;
    this.low = 48; // C3
    this.count = 25;
    this.baseOctave = 4; // computer keys start at C4
    this.pointers = new Map();
    this.keyEls = new Map();
    el.addEventListener("pointerdown", (e) => this.pdown(e));
    el.addEventListener("pointermove", (e) => this.pmove(e));
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => el.addEventListener(t, (e) => this.pup(e)));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => this.layout()).observe(el);
    this.layout();
  }

  layout() {
    const w = this.el.clientWidth || 800;
    const whites = Math.max(10, Math.min(36, Math.floor(w / 34)));
    // pick an octave-aligned range roughly centred on C4
    const octaves = Math.max(1, Math.round(whites / 7));
    const low = 60 - 12 * Math.floor(octaves / 2);
    const count = octaves * 12 + 1;
    if (low === this.low && count === this.count && this.keyEls.size) return;
    this.low = low;
    this.count = count;
    this.render();
  }

  render() {
    this.el.innerHTML = "";
    this.keyEls.clear();
    const whites = [];
    for (let m = this.low; m < this.low + this.count; m++) if (!BLACK.has(m % 12)) whites.push(m);
    const ww = 100 / whites.length;
    let wi = 0;
    for (let m = this.low; m < this.low + this.count; m++) {
      const k = document.createElement("div");
      const black = BLACK.has(m % 12);
      k.className = black ? "pk pk--black" : "pk pk--white";
      k.dataset.note = m;
      if (black) {
        k.style.left = `calc(${wi * ww}% - ${ww * 0.3}%)`;
        k.style.width = `${ww * 0.6}%`;
      } else {
        k.style.left = `${wi * ww}%`;
        k.style.width = `${ww}%`;
        if (m % 12 === 0) {
          const lab = document.createElement("span");
          lab.className = "pk__label";
          lab.textContent = noteName(m);
          k.appendChild(lab);
        }
        wi++;
      }
      const hint = this.hintFor(m);
      if (hint) {
        const h = document.createElement("span");
        h.className = "pk__hint";
        h.textContent = hint.toUpperCase();
        k.appendChild(h);
      }
      this.el.appendChild(k);
      this.keyEls.set(m, k);
    }
  }

  hintFor(m) {
    const base = this.baseOctave * 12 + 12;
    for (const [key, off] of Object.entries(PIANO_KEYS)) if (base + off === m) return key;
    return null;
  }

  setOctave(o) {
    this.baseOctave = Math.max(1, Math.min(7, o));
    this.render();
  }

  noteAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest && el.closest(".pk");
    return k && this.el.contains(k) ? Number(k.dataset.note) : null;
  }

  velocityAt(e, note) {
    const k = this.keyEls.get(note);
    if (!k) return 100;
    const r = k.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height; // lower on key = louder
    return Math.round(60 + Math.max(0, Math.min(1, y)) * 67);
  }

  pdown(e) {
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    const n = this.noteAt(e);
    if (n == null) return;
    this.pointers.set(e.pointerId, n);
    this.onDown(n, this.velocityAt(e, n));
  }

  pmove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const n = this.noteAt(e);
    const prev = this.pointers.get(e.pointerId);
    if (n === prev) return;
    if (prev != null) this.onUp(prev);
    this.pointers.set(e.pointerId, n);
    if (n != null) this.onDown(n, this.velocityAt(e, n));
  }

  pup(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const n = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (n != null) this.onUp(n);
  }

  highlight(note, on) {
    const k = this.keyEls.get(note);
    if (k) k.classList.toggle("is-down", on);
  }
}
