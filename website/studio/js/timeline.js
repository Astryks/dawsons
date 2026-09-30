// Multi-track timeline UI: track headers (mute/solo/volume/pan), clips
// with waveforms or note previews, drag to move, drag edges to trim (or
// to extend a looped clip), click ruler/lane to move the playhead.

import {
  state, changed, trackById, findClip, clipCycle, bufOffset, snapT, beat, songEnd,
  applyMuteSolo, removeTrack, seek,
} from "./project.js";
import { peaks } from "./clipfx.js";
import { kitById } from "./kits.js";
import { instrumentById } from "./instruments.js";

const HEADER_W = 190;
const ROW_H = 76;
const peakCache = new WeakMap();

export class Timeline {
  constructor(root, { onSelect, onDropFiles, onDropLoop }) {
    this.root = root;
    this.onSelect = onSelect;
    this.onDropFiles = onDropFiles;
    this.onDropLoop = onDropLoop;
    this.scroll = root.querySelector(".tl-scroll");
    this.ruler = root.querySelector(".tl-ruler");
    this.rows = root.querySelector(".tl-rows");
    this.playheadEl = root.querySelector(".tl-playhead");
    this.empty = root.querySelector(".tl-empty");
    this.drag = null;

    this.ruler.addEventListener("pointerdown", (e) => {
      const r = this.ruler.getBoundingClientRect();
      seek(snapT(Math.max(0, (e.clientX - r.left - HEADER_W) / state.zoom)));
    });
    this.rows.addEventListener("pointerdown", (e) => this.pointerDown(e));
    window.addEventListener("pointermove", (e) => this.pointerMove(e));
    window.addEventListener("pointerup", (e) => this.pointerUp(e));

    // drag & drop audio files / library loops onto the timeline
    this.root.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.root.classList.add("is-drop");
    });
    this.root.addEventListener("dragleave", () => this.root.classList.remove("is-drop"));
    this.root.addEventListener("drop", (e) => {
      e.preventDefault();
      this.root.classList.remove("is-drop");
      const { pos, trackId } = this.locate(e);
      const loop = e.dataTransfer.getData("text/x-dawsons-loop");
      if (loop) this.onDropLoop(loop, pos, trackId);
      else if (e.dataTransfer.files?.length) this.onDropFiles([...e.dataTransfer.files], pos, trackId);
    });
  }

  locate(e) {
    const r = this.rows.getBoundingClientRect();
    const pos = snapT(Math.max(0, (e.clientX - r.left - HEADER_W) / state.zoom));
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tl-row");
    return { pos, trackId: row?.dataset.track || null };
  }

  width() {
    return Math.max(this.scroll.clientWidth - HEADER_W, (Math.max(songEnd(), state.playhead) + 30) * state.zoom);
  }

  render() {
    const w = this.width();
    this.empty.hidden = state.tracks.length > 0;
    this.renderRuler(w);
    this.rows.innerHTML = "";
    this.rows.style.width = `${w + HEADER_W}px`;
    for (const t of state.tracks) this.rows.appendChild(this.renderRow(t, w));
    this.renderPlayhead();
  }

  renderRuler(w) {
    const b = beat();
    const bar = b * 4;
    this.ruler.style.width = `${w + HEADER_W}px`;
    const bars = Math.ceil(w / state.zoom / bar) + 1;
    const pxBar = bar * state.zoom;
    const every = pxBar < 28 ? 4 : pxBar < 56 ? 2 : 1;
    let html = `<div class="tl-ruler__pad" style="width:${HEADER_W}px">${state.bpm} BPM · 4/4</div>`;
    for (let i = 0; i < bars; i += every) {
      html += `<div class="tl-bar" style="left:${HEADER_W + i * pxBar}px">${i + 1}</div>`;
    }
    this.ruler.innerHTML = html;
    // grid lines via background on rows
    this.rows.style.setProperty("--bar-px", `${pxBar}px`);
    this.rows.style.setProperty("--beat-px", `${b * state.zoom}px`);
    this.rows.style.setProperty("--header-w", `${HEADER_W}px`);
  }

  renderRow(t, w) {
    const row = document.createElement("div");
    row.className = `tl-row${t.id === state.selectedTrackId ? " is-selected" : ""}`;
    row.dataset.track = t.id;
    row.style.setProperty("--track-color", t.color);
    const sub =
      t.kind === "drums" ? kitById(t.kitId).name : t.kind === "keys" ? instrumentById(t.instrumentId).name : "Audio";
    const icon = t.kind === "drums" ? "🥁" : t.kind === "keys" ? "🎹" : "🎙️";
    row.innerHTML = `
      <div class="tl-head" style="width:${HEADER_W}px">
        <div class="tl-head__top">
          <span class="tl-head__icon">${icon}</span>
          <span class="tl-head__name" title="Double-click to rename">${escapeHtml(t.name)}</span>
          <button class="tl-btn tl-btn--x" data-act="delete" title="Delete track">×</button>
        </div>
        <div class="tl-head__sub">${escapeHtml(sub)}</div>
        <div class="tl-head__ctrls">
          <button class="tl-btn${t.mute ? " is-on" : ""}" data-act="mute" title="Mute">M</button>
          <button class="tl-btn tl-btn--solo${t.solo ? " is-on" : ""}" data-act="solo" title="Solo">S</button>
          <input type="range" min="0" max="1.2" step="0.01" value="${t.volume}" data-act="vol" title="Volume" aria-label="Volume" />
          <input type="range" min="-1" max="1" step="0.01" value="${t.pan}" data-act="pan" title="Pan" aria-label="Pan" class="tl-pan" />
        </div>
      </div>
      <div class="tl-lane" style="width:${w}px"></div>`;
    const lane = row.querySelector(".tl-lane");
    for (const c of t.clips) lane.appendChild(this.renderClip(t, c));

    row.querySelector(".tl-head").addEventListener("pointerdown", (e) => {
      if (e.target.closest("input,button")) return;
      this.onSelect(t.id, null);
    });
    row.querySelector(".tl-head__name").addEventListener("dblclick", () => {
      const name = prompt("Track name", t.name);
      if (name) {
        t.name = name.slice(0, 40);
        changed("all");
      }
    });
    row.querySelectorAll("[data-act]").forEach((el) => {
      const act = el.dataset.act;
      if (el.tagName === "INPUT") {
        el.addEventListener("input", () => {
          t[act === "vol" ? "volume" : "pan"] = Number(el.value);
          applyMuteSolo();
        });
        el.addEventListener("dblclick", () => {
          if (act === "pan") {
            t.pan = 0;
            el.value = 0;
            applyMuteSolo();
          }
        });
      } else {
        el.addEventListener("click", () => {
          if (act === "mute") t.mute = !t.mute;
          if (act === "solo") t.solo = !t.solo;
          if (act === "delete") {
            if (t.clips.length && !confirm(`Delete track "${t.name}"?`)) return;
            removeTrack(t.id);
          }
          applyMuteSolo();
          changed("all");
        });
      }
    });
    return row;
  }

  renderClip(t, c) {
    const el = document.createElement("div");
    el.className = `clip clip--${c.kind}${c.id === state.selectedClipId ? " is-selected" : ""}${c.processing ? " is-busy" : ""}`;
    el.dataset.clip = c.id;
    el.style.left = `${c.start * state.zoom}px`;
    el.style.width = `${Math.max(6, c.length * state.zoom)}px`;
    const badges = [];
    if (c.kind === "audio") {
      if (c.reversed) badges.push("REV");
      if (c.rate !== 1) badges.push(`${c.rate.toFixed(2)}× tape`);
      if (c.stretch !== 1) badges.push(`${c.stretch.toFixed(2)}× stretch`);
      if (c.pitch) badges.push(`${c.pitch > 0 ? "+" : ""}${c.pitch} st`);
    }
    if (c.loop) badges.push("LOOP");
    el.innerHTML = `<canvas></canvas><div class="clip__label">${escapeHtml(c.name)}${
      badges.length ? ` <em>${badges.join(" · ")}</em>` : ""
    }</div><div class="clip__h clip__h--l" data-edge="l"></div><div class="clip__h clip__h--r" data-edge="r"></div>`;
    requestAnimationFrame(() => this.drawClip(el.querySelector("canvas"), t, c));
    return el;
  }

  drawClip(cv, t, c) {
    const w = Math.max(6, Math.round(c.length * state.zoom));
    const h = ROW_H - 10;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.min(32000, w * dpr);
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const g = cv.getContext("2d");
    g.scale(Math.min(32000, w * dpr) / w, dpr);
    const cycle = clipCycle(c);
    const cyclePx = cycle * state.zoom;
    g.fillStyle = "rgba(255,255,255,0.85)";
    if (c.kind === "audio") {
      if (c.processing) return;
      let pk = peakCache.get(c.buf);
      if (!pk) {
        pk = peaks(c.buf, Math.min(20000, Math.ceil(c.buf.duration * 200)));
        peakCache.set(c.buf, pk);
      }
      const pps = pk.length / c.buf.duration; // peaks per buffer-second
      const off = bufOffset(c);
      const mid = h / 2 + 6;
      const amp = (h - 16) / 2;
      for (let x = 0; x < w; x++) {
        const tl = x / state.zoom; // seconds into clip
        const inCycle = tl % cycle;
        const bt = off + inCycle * c.rate;
        const i = Math.floor(bt * pps);
        const v = Math.min(1, (pk[i] || 0) * c.gain * 1.2);
        g.fillRect(x, mid - v * amp, 1, Math.max(1, v * amp * 2));
      }
    } else {
      const isDrums = t.kind === "drums";
      const ns = c.notes;
      let lo = isDrums ? 0 : Math.min(...ns.map((n) => n.n));
      let hi = isDrums ? 17 : Math.max(...ns.map((n) => n.n));
      if (!isFinite(lo)) { lo = 60; hi = 72; }
      if (hi - lo < 6) { lo -= 3; hi += 3; }
      const top = 16;
      const span = h - top - 3;
      for (let k = 0; k * cycle < c.length; k++) {
        for (const n of ns) {
          const x = (k * cycle + n.t) * state.zoom;
          if (n.t >= cycle || x >= w) continue;
          const y = top + span - ((n.n - lo) / (hi - lo)) * span;
          const nw = isDrums ? 3 : Math.max(2, Math.min(n.d, cycle - n.t) * state.zoom);
          g.globalAlpha = 0.45 + 0.55 * (n.v / 127);
          g.fillRect(x, y - 2, Math.min(nw, w - x), 4);
        }
      }
      g.globalAlpha = 1;
    }
    if (c.loop && cyclePx > 4) {
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let x = cyclePx; x < w; x += cyclePx) g.fillRect(Math.round(x), 0, 2, h);
    }
  }

  renderPlayhead() {
    this.playheadEl.style.transform = `translateX(${HEADER_W + state.playhead * state.zoom}px)`;
    this.playheadEl.style.height = `${Math.max(this.rows.scrollHeight + 28, 60)}px`;
    this.playheadEl.classList.toggle("is-rec", state.recording);
    if (state.playing) {
      const x = HEADER_W + state.playhead * state.zoom;
      const view = this.scroll;
      if (x > view.scrollLeft + view.clientWidth - 60) view.scrollLeft = x - HEADER_W - 40;
    }
  }

  // ------------------------------------------------------ interactions

  pointerDown(e) {
    let clipEl = e.target.closest(".clip");
    const row = e.target.closest(".tl-row");
    if (!row || e.target.closest(".tl-head")) return;
    const track = trackById(row.dataset.track);
    if (!clipEl) {
      // empty lane: select track + move playhead
      const lane = row.querySelector(".tl-lane").getBoundingClientRect();
      this.onSelect(track.id, null);
      seek(snapT(Math.max(0, (e.clientX - lane.left) / state.zoom)));
      return;
    }
    const found = findClip(clipEl.dataset.clip);
    if (!found) return;
    e.preventDefault();
    const { clip } = found;
    const edge = e.target.dataset.edge || null;
    this.onSelect(track.id, clip.id); // re-renders: grab the fresh element
    clipEl = this.rows.querySelector(`[data-clip="${clip.id}"]`) || clipEl;
    this.drag = {
      clip,
      track,
      edge,
      x0: e.clientX,
      start: clip.start,
      length: clip.length,
      srcOffset: clip.srcOffset,
      srcLen: clip.srcLen,
      cycle: clip.cycle,
      notes: clip.notes ? clip.notes.map((n) => ({ ...n })) : null,
      el: clipEl,
      moved: false,
    };
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dt = (e.clientX - d.x0) / state.zoom;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    const c = d.clip;
    if (!d.edge) {
      c.start = Math.max(0, snapT(d.start + dt));
      d.el.style.left = `${c.start * state.zoom}px`;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tl-row");
      this.rows.querySelectorAll(".tl-row.is-target").forEach((r) => r.classList.remove("is-target"));
      const target = over && trackById(over.dataset.track);
      if (target && target !== d.track && target.kind === d.track.kind) over.classList.add("is-target");
      d.target = target && target.kind === d.track.kind ? target : null;
      return;
    }
    if (d.edge === "r") {
      if (c.loop) {
        c.length = Math.max(clipCycle(c) * 0.25, snapT(d.start + d.length + dt) - c.start);
      } else if (c.kind === "audio") {
        const newLen = Math.max(0.05, snapT(d.start + d.length + dt) - c.start);
        const dSrc = ((d.length - newLen) * c.rate) / c.stretch; // shrink amount in src seconds
        let srcLen = Math.max(0.02, Math.min(c.src.duration, d.srcLen - dSrc));
        if (c.reversed) {
          // right edge of a reversed clip is the *start* of the source region
          let srcOffset = d.srcOffset + (d.srcLen - srcLen);
          if (srcOffset < 0) { srcLen += srcOffset; srcOffset = 0; }
          c.srcOffset = srcOffset;
        } else {
          srcLen = Math.min(srcLen, c.src.duration - c.srcOffset);
        }
        c.srcLen = srcLen;
        c.length = clipCycle(c);
      } else {
        c.cycle = Math.max(0.1, snapT(d.start + d.length + dt) - c.start);
        c.length = c.cycle;
      }
    } else if (d.edge === "l") {
      const newStart = Math.max(0, Math.min(snapT(d.start + dt), d.start + d.length - 0.05));
      const shift = newStart - d.start; // + = trimming in
      if (c.kind === "audio") {
        const dSrc = (shift * c.rate) / c.stretch;
        if (c.reversed) {
          c.srcLen = Math.max(0.02, Math.min(c.src.duration - c.srcOffset, d.srcLen - dSrc));
        } else {
          const so = Math.max(0, Math.min(d.srcOffset + dSrc, d.srcOffset + d.srcLen - 0.02));
          c.srcLen = d.srcLen - (so - d.srcOffset);
          c.srcOffset = so;
        }
        if (c.loop) {
          c.start = newStart;
          c.length = Math.max(0.05, d.length - shift);
        } else {
          c.length = clipCycle(c);
          c.start = Math.max(0, d.start + d.length - c.length);
        }
      } else {
        c.start = newStart;
        c.notes = d.notes.map((n) => ({ ...n, t: n.t - shift })).filter((n) => n.t >= 0);
        c.cycle = Math.max(0.1, d.cycle - shift);
        c.length = c.loop ? Math.max(0.1, d.length - shift) : c.cycle;
      }
    }
    d.el.style.left = `${c.start * state.zoom}px`;
    d.el.style.width = `${Math.max(6, c.length * state.zoom)}px`;
  }

  pointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.target && d.target !== d.track) {
      d.track.clips = d.track.clips.filter((x) => x !== d.clip);
      d.target.clips.push(d.clip);
      state.selectedTrackId = d.target.id;
    }
    if (d.moved) changed("all");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
