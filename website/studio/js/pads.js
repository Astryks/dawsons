// 4x4 Akai-style drum pad grid, plus two extra sounds under it.
// Click / touch (velocity from where you hit) and keyboard hints.
import { MPC_ORDER } from "./keymap.js";

const ROLE = {
  12: "kick", 13: "kick",
  14: "snare", 15: "snare", 16: "snare", 17: "snare",
  6: "hat", 7: "hat", 8: "hat",
  9: "cym", 10: "cym", 11: "cym",
  0: "tom", 1: "tom", 2: "tom",
};

export class Pads {
  constructor(el, { onHit }) {
    this.el = el;
    this.onHit = onHit;
    this.padEls = [];
    MPC_ORDER.forEach((i, slot) => {
      const b = document.createElement("button");
      b.type = "button";
      const role = ROLE[i] || "perc";
      b.className = `pad pad--${role}${slot >= 16 ? " pad--extra" : ""}`;
      b.dataset.pad = String(i);
      b.innerHTML = `<span class="pad__name"></span><kbd class="pad__key"></kbd>`;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const r = b.getBoundingClientRect();
        const y = (e.clientY - r.top) / r.height;
        this.onHit(i, 0.55 + 0.45 * Math.max(0, Math.min(1, y + 0.25)));
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      el.appendChild(b);
      this.padEls[i] = b;
    });
  }

  setKeys(labels) {
    this.padEls.forEach((b, i) => {
      if (b) b.querySelector(".pad__key").textContent = labels[i] || "";
    });
  }

  setNames(names) {
    this.padEls.forEach((b, i) => {
      if (!b) return;
      const name = names[i] || "";
      b.querySelector(".pad__name").textContent = name;
      b.setAttribute("aria-label", name || "Drum pad");
    });
  }

  flash(i) {
    const b = this.padEls[i];
    if (!b) return;
    b.classList.remove("is-hit");
    void b.offsetWidth;
    b.classList.add("is-hit");
  }
}
