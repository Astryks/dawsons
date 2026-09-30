// 3x6 drum pad grid (18 pads): click/touch (multi-touch) + key hints.
import { PAD_KEYS } from "./kits.js";

export class Pads {
  constructor(el, { onHit }) {
    this.el = el;
    this.onHit = onHit;
    this.padEls = [];
    for (let i = 0; i < 18; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pad pad--row${Math.floor(i / 6)}`;
      b.dataset.pad = i;
      b.innerHTML = `<span class="pad__name"></span><kbd class="pad__key">${PAD_KEYS[i].toUpperCase()}</kbd>`;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const r = b.getBoundingClientRect();
        // hit nearer the top of the pad = softer (like hitting the rim)
        const y = (e.clientY - r.top) / r.height;
        this.onHit(i, 0.55 + 0.45 * Math.max(0, Math.min(1, y + 0.25)));
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      el.appendChild(b);
      this.padEls.push(b);
    }
  }

  setNames(names) {
    this.padEls.forEach((b, i) => (b.querySelector(".pad__name").textContent = names[i] || ""));
  }

  flash(i) {
    const b = this.padEls[i];
    if (!b) return;
    b.classList.remove("is-hit");
    void b.offsetWidth;
    b.classList.add("is-hit");
  }
}
