// Dawsons Companion — a local-only PWA. Everything here stays on this
// device: voice notes live in IndexedDB, nothing is uploaded, there is no
// server component. See docs/UX_DESIGN.md for why this stays lightweight
// (no AI analysis on mobile — that would require paid cloud compute).

const DB_NAME = "dawsons-companion";
const STORE_NAME = "voice_notes";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveNote(note) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listNotes() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error);
  });
}

async function deleteNote(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Recording ---

let mediaRecorder = null;
let recordedChunks = [];
let recordingStart = 0;

const recordBtn = document.getElementById("recordBtn");
const recordStatus = document.getElementById("recordStatus");
const noteList = document.getElementById("noteList");

recordBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    recordingStart = Date.now();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const durationSec = (Date.now() - recordingStart) / 1000;
      const title = window.prompt("Name this voice note:", "New idea") || "Untitled";
      await saveNote({ id: crypto.randomUUID(), title, durationSec, createdAt: Date.now(), blob });
      recordBtn.textContent = "Start recording";
      recordBtn.classList.remove("btn--recording");
      recordStatus.textContent = "";
      renderNotes();
    };

    mediaRecorder.start();
    recordBtn.textContent = "Stop & save";
    recordBtn.classList.add("btn--recording");
    recordStatus.textContent = "Recording…";
  } catch (err) {
    recordStatus.textContent = `Microphone access failed: ${err.message}`;
  }
});

async function renderNotes() {
  const notes = await listNotes();
  noteList.innerHTML = "";
  if (notes.length === 0) {
    noteList.innerHTML = '<li class="hint">No voice notes yet.</li>';
    return;
  }
  for (const note of notes) {
    const li = document.createElement("li");
    li.className = "list__item";

    const row = document.createElement("div");
    row.className = "list__row";
    const label = document.createElement("span");
    label.textContent = `${note.title} (${note.durationSec.toFixed(1)}s)`;
    const actions = document.createElement("span");
    actions.className = "list__actions";
    const renameBtn = document.createElement("button");
    renameBtn.textContent = "Rename";
    renameBtn.onclick = async () => {
      const newTitle = window.prompt("Rename to:", note.title);
      if (newTitle) {
        note.title = newTitle;
        await saveNote(note);
        renderNotes();
      }
    };
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = async () => {
      await deleteNote(note.id);
      renderNotes();
    };
    actions.append(renameBtn, deleteBtn);
    row.append(label, actions);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = URL.createObjectURL(note.blob);

    li.append(row, audio);
    noteList.appendChild(li);
  }
}

renderNotes();

// --- Open & play an arbitrary audio file (e.g. an exported mix) ---

const fileInput = document.getElementById("fileInput");
const filePlayer = document.getElementById("filePlayer");

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  filePlayer.src = URL.createObjectURL(file);
  filePlayer.style.display = "block";
  filePlayer.play().catch(() => {});
});

// --- PWA install support ---

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
