// Stem split. Tries a local Demucs engine first (the Dawsons sidecar),
// then falls back to the in-browser quick split. Nothing here calls a
// paid API. The quick split stays in the tab; Demucs only runs if you
// point Studio at a server you started yourself.
import { getCtx, decode } from "./audio.js";
import { splitStems } from "./hpss.js";

const QUICK_CAP_SECONDS = 25;

export async function separateFile(file, { url, onStatus } = {}) {
  const endpoint = (url || "").trim().replace(/\/$/, "");
  if (endpoint) {
    try {
      onStatus?.("Asking the local stem engine…");
      return await demucsSplit(file, endpoint, onStatus);
    } catch (err) {
      onStatus?.(`Local engine didn't answer (${err.message}). Using the quick split in this tab instead.`);
    }
  } else {
    onStatus?.("Quick split in this tab — drums, bass, melody, and the rest. For a real vocal split, start the local Demucs engine.");
  }
  return quickSplit(file, onStatus);
}

async function demucsSplit(file, endpoint, onStatus) {
  const body = new FormData();
  body.append("file", file, file.name || "song");
  const started = await fetch(`${endpoint}/stems`, { method: "POST", body });
  if (!started.ok) throw new Error(`engine HTTP ${started.status}`);
  const { job_id: jobId } = await started.json();
  if (!jobId) throw new Error("engine returned no job");
  const deadline = Date.now() + 1000 * 60 * 8;
  let record = null;
  while (Date.now() < deadline) {
    await wait(900);
    const res = await fetch(`${endpoint}/stems/${jobId}`);
    if (!res.ok) throw new Error(`status HTTP ${res.status}`);
    record = await res.json();
    if (record.status === "failed") throw new Error(record.error || "separation failed");
    if (record.status === "done") break;
    const pct = Math.round((record.progress || 0) * 100);
    onStatus?.(`Separating with Demucs… ${pct}%`);
  }
  if (!record || record.status !== "done") throw new Error("timed out");
  const names = Object.keys(record.result?.stems || {});
  if (!names.length) throw new Error("no stems came back");
  const ctx = getCtx();
  const stems = {};
  for (const name of names) {
    onStatus?.(`Loading ${name}…`);
    const audio = await fetch(`${endpoint}/stems/${jobId}/${name}`);
    if (!audio.ok) throw new Error(`missing ${name}`);
    stems[name] = await decode(await audio.arrayBuffer());
    // decode() may share the context; keep a named buffer either way
    if (!stems[name]) throw new Error(`couldn't decode ${name}`);
  }
  return { engine: "demucs", stems, note: "Full Demucs split from your local engine." };
}

async function quickSplit(file, onStatus) {
  onStatus?.("Listening through the song…");
  const ctx = getCtx();
  const decoded = await decode(await file.arrayBuffer());
  const capped = Math.min(decoded.length, Math.floor(decoded.sampleRate * QUICK_CAP_SECONDS));
  const mono = new Float32Array(capped);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c).subarray(0, capped);
    for (let i = 0; i < capped; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  onStatus?.("Splitting drums, bass, and melody…");
  await wait(30);
  const parts = splitStems(mono, decoded.sampleRate);
  const stems = {};
  for (const name of ["drums", "bass", "melody", "other"]) {
    const buffer = ctx.createBuffer(1, parts[name].length, decoded.sampleRate);
    buffer.copyToChannel(parts[name], 0);
    stems[name] = buffer;
  }
  const trimmed = decoded.duration > QUICK_CAP_SECONDS;
  return {
    engine: "quick",
    stems,
    note: trimmed
      ? `Quick split of the first ${QUICK_CAP_SECONDS}s. This is not a vocal isolator — start the local Demucs engine for vocals, drums, bass, and other.`
      : "Quick split in this tab (drums, bass, melody, other). It is not a vocal isolator — start the local Demucs engine for that.",
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
