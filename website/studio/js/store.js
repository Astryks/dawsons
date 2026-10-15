// Undo/redo history + autosave to IndexedDB.
// After any edit (debounced), the project is serialised; if it differs
// from the last snapshot it's pushed on the undo stack and autosaved.
// Audio is stored once per buffer (raw float32 per channel).

import { serialize, restore, buffers, registerBuffer, state } from "./project.js";
import { getCtx } from "./audio.js";

const MAX_UNDO = 80;
const undoStack = [];
const redoStack = [];
let last = null; // JSON string of the current state
let timer = null;
let suspended = false;
export const historyHooks = { onRestore: () => {}, onSaved: () => {} };

export function snapshotSoon(delay = 350) {
  if (suspended) return;
  clearTimeout(timer);
  timer = setTimeout(snapshotNow, delay);
}

export function snapshotNow() {
  clearTimeout(timer);
  if (suspended) return;
  if (state.tracks.some((t) => t.clips.some((c) => c.processing))) return snapshotSoon(300);
  const json = JSON.stringify(serialize());
  if (json === last) return;
  if (last !== null) {
    undoStack.push(last);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }
  last = json;
  autosave(json);
}

function apply(json) {
  suspended = true;
  try {
    restore(JSON.parse(json));
  } finally {
    suspended = false;
  }
  last = json;
  historyHooks.onRestore();
  autosave(json);
}

export function undo() {
  snapshotNow();
  if (!undoStack.length) return false;
  redoStack.push(last);
  apply(undoStack.pop());
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(last);
  apply(redoStack.pop());
  return true;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  last = JSON.stringify(serialize());
}

// ------------------------------------------------------------ IndexedDB

const DB = "mydawsons-studio";
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no IndexedDB"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("projects");
        req.result.createObjectStore("audio");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => {});
  }
  return dbp;
}
function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const savedBufs = new Set();
let saveTimer = null;
function autosave(json) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(json).catch((e) => console.warn("Autosave failed", e)), 600);
}

async function saveNow(json) {
  const snap = JSON.parse(json);
  const needed = new Set();
  snap.tracks.forEach((t) => t.clips.forEach((c) => c.srcId && needed.add(c.srcId)));
  for (const id of needed) {
    if (savedBufs.has(id)) continue;
    const b = buffers.get(id);
    if (!b) continue;
    const rec = { sr: b.sampleRate, ch: [] };
    for (let i = 0; i < b.numberOfChannels; i++) rec.ch.push(b.getChannelData(i).slice());
    await tx("audio", "readwrite", (s) => s.put(rec, id));
    savedBufs.add(id);
  }
  // processed buffers are rebuilt on load, so drop their ids
  snap.tracks.forEach((t) => t.clips.forEach((c) => c.bufId !== c.srcId && delete c.bufId));
  await tx("projects", "readwrite", (s) => s.put({ snap, savedAt: Date.now(), audio: [...needed] }, "current"));
  historyHooks.onSaved();
}

export async function loadSaved() {
  const rec = await tx("projects", "readonly", (s) => s.get("current"));
  if (!rec || !rec.snap?.tracks?.length) return null;
  const c = getCtx();
  for (const id of rec.audio || []) {
    if (buffers.has(id)) continue;
    const a = await tx("audio", "readonly", (s) => s.get(id));
    if (!a) continue;
    const b = c.createBuffer(a.ch.length, a.ch[0].length, a.sr);
    a.ch.forEach((d, i) => b.copyToChannel(d, i));
    registerBuffer(id, b);
    savedBufs.add(id);
  }
  suspended = true;
  try {
    restore(rec.snap);
  } finally {
    suspended = false;
  }
  resetHistory();
  return rec;
}

export async function clearSaved() {
  await tx("projects", "readwrite", (s) => s.delete("current"));
  await tx("audio", "readwrite", (s) => s.clear());
  savedBufs.clear();
}
