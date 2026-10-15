// Getting sound in from anywhere:
//  - fetch an audio URL (direct; if the site blocks cross-origin reads,
//    retry through our small /api/fetch-audio proxy when it's deployed)
//  - capture a browser tab / system audio with getDisplayMedia
// Streaming services (YouTube, Spotify, ...) are deliberately not
// downloadable — tab capture records what you're already playing.

import { decode, getCtx } from "./audio.js";

const BLOCKED = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|spotify\.com|scdn\.co|soundcloud\.com|sndcdn\.com|music\.apple\.com|tidal\.com|deezer\.com|netflix\.com|music\.amazon\.)/i;

export class ImportError extends Error {}

export async function fetchAudioUrl(raw, { onStatus } = {}) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError("That doesn't look like a link. Paste a full https://… address of an audio file.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new ImportError("Only http(s) links work.");
  if (BLOCKED.test(url.hostname)) {
    throw new ImportError("Streaming sites can't be downloaded here. Use “Record a tab” to capture what you're playing, if you have the rights to it.");
  }
  let ab = null;
  let corsBlocked = false;
  onStatus?.("Fetching…");
  try {
    const r = await fetch(url.href, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new ImportError(`The site answered ${r.status} — check the link.`);
    ab = await r.arrayBuffer();
  } catch (e) {
    if (e instanceof ImportError) throw e;
    corsBlocked = true; // network error from fetch = almost always CORS
  }
  if (corsBlocked) {
    onStatus?.("The site blocks direct loading — trying our fetch helper…");
    let r = null;
    try {
      r = await fetch(`/api/fetch-audio?url=${encodeURIComponent(url.href)}`);
    } catch { /* offline or no helper */ }
    if (!r || r.status === 404 || r.status === 405) {
      throw new ImportError("That site doesn't allow other websites to load its files (CORS). Download the file and drag it in, or use “Record a tab”.");
    }
    if (!r.ok) {
      let msg = "";
      try { msg = (await r.json()).error; } catch { /* */ }
      throw new ImportError(msg || `Couldn't fetch that file (${r.status}).`);
    }
    ab = await r.arrayBuffer();
  }
  onStatus?.("Decoding…");
  try {
    return { buffer: await decode(ab), name: decodeURIComponent(url.pathname.split("/").pop() || url.hostname).replace(/\.[^.]+$/, "") || "Imported" };
  } catch {
    throw new ImportError("Fetched it, but it isn't an audio file this browser can decode (try WAV, MP3, M4A, OGG). Web pages and playlists won't work — link straight to the audio file.");
  }
}

// ------------------------------------------------------------ tab capture

export function canCaptureTab() {
  return !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";
}

// Starts capturing. Returns { stop(): Promise<{buffer}>, startedAt (ctx time), stream }.
export async function startTabCapture({ onLevel, onEnded } = {}) {
  if (!canCaptureTab()) throw new ImportError("This browser can't record tab audio. Try Chrome or Edge on a computer.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // Chrome needs video to offer the tab picker
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
    });
  } catch (e) {
    throw new ImportError(e?.name === "NotAllowedError" ? "Capture cancelled." : "Couldn't start capture: " + (e?.message || e));
  }
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new ImportError("No audio was shared. Pick a tab and tick “Share tab audio” (or “Share system audio”).");
  }
  stream.getVideoTracks().forEach((t) => t.stop()); // we only want the sound
  const audioOnly = new MediaStream(audioTracks);
  const c = getCtx();
  // level meter
  const src = c.createMediaStreamSource(audioOnly);
  const an = c.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const data = new Float32Array(an.fftSize);
  let raf = 0;
  const meter = () => {
    an.getFloatTimeDomainData(data);
    let e = 0;
    for (const v of data) e += v * v;
    onLevel?.(Math.sqrt(e / data.length));
    raf = requestAnimationFrame(meter);
  };
  meter();
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
  const rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startedAt = c.currentTime;
  rec.start(250);
  let stopped = null;
  const stop = () => {
    if (stopped) return stopped;
    stopped = new Promise((resolve, reject) => {
      rec.onstop = async () => {
        cancelAnimationFrame(raf);
        src.disconnect();
        audioTracks.forEach((t) => t.stop());
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
          if (!blob.size) throw new ImportError("Nothing was recorded.");
          resolve({ buffer: await decode(await blob.arrayBuffer()) });
        } catch (e) {
          reject(e instanceof ImportError ? e : new ImportError("Couldn't decode the captured audio."));
        }
      };
      if (rec.state !== "inactive") rec.stop();
      else rec.onstop();
    });
    return stopped;
  };
  audioTracks[0].addEventListener("ended", () => onEnded?.());
  return { stop, startedAt, stream: audioOnly };
}
