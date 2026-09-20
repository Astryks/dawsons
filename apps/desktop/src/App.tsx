import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

type SidecarStatus = "starting" | "ready" | "error";

// The 128 General MIDI program names (standard instrument naming from the
// MIDI Manufacturers Association spec) — one bundled SoundFont covers all
// of them, which is how we get a comprehensive, non-overlapping instrument
// list without curating/licensing each instrument individually.
const GM_INSTRUMENTS = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot",
];

const POPULAR_INSTRUMENTS = [0, 4, 24, 27, 33, 40, 48, 56, 65, 73, 80, 88];

interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  source_file: string | null;
}

interface VoiceNote {
  id: string;
  title: string;
  duration_sec: number;
  created_at: string;
  file_path: string;
}

interface TrackInfo {
  name: string;
  muted: boolean;
}

interface DemoSongInfo {
  index: number;
  title: string;
  description: string;
}

interface AnalysisStatus {
  job_id: string;
  status: "pending" | "running" | "done" | "failed";
  stage: string | null;
  progress: number;
  // Full Scene-Graph-shaped fragment once done — see
  // packages/scene-graph-schema/schema/scene-graph.schema.json.
  result: Record<string, unknown> | null;
  error: string | null;
}

export default function App() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>("starting");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [reverse, setReverse] = useState(false);
  const [semitones, setSemitones] = useState(0);
  const [clipPath, setClipPath] = useState<string | null>(null);
  const [reverbWet, setReverbWet] = useState(0);
  const [reverbRoom, setReverbRoom] = useState(0.5);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceNoteError, setVoiceNoteError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisStatus | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [instrumentProgram, setInstrumentProgram] = useState(0);
  const [instrumentSearch, setInstrumentSearch] = useState("");
  const [soundfontReady, setSoundfontReady] = useState<boolean | null>(null);
  const [instrumentError, setInstrumentError] = useState<string | null>(null);
  const [demoSongs, setDemoSongs] = useState<DemoSongInfo[]>([]);
  const [demoSongError, setDemoSongError] = useState<string | null>(null);
  const [loadingDemoSong, setLoadingDemoSong] = useState<number | null>(null);
  const [smartUploadError, setSmartUploadError] = useState<string | null>(null);
  const [smartUploadBusy, setSmartUploadBusy] = useState(false);
  const [uploadClassification, setUploadClassification] = useState<{
    filePath: string;
    suggestedLayer: string | null;
    confidence: number;
    newLayer: boolean;
  } | null>(null);
  const [layerNameOverride, setLayerNameOverride] = useState("");

  useEffect(() => {
    // M3 wires this up to a real `sidecar:status` Tauri event; until then
    // the shell has no sidecar to report on.
    setSidecarStatus("starting");
    refreshProjects();
    refreshVoiceNotes();
    refreshTracks();
    invoke<boolean>("soundfont_available").then(setSoundfontReady).catch(() => setSoundfontReady(false));
    invoke<DemoSongInfo[]>("list_demo_songs").then(setDemoSongs).catch((err) => setDemoSongError(String(err)));
  }, []);

  async function handleLoadDemoSong(index: number) {
    setLoadingDemoSong(index);
    setDemoSongError(null);
    try {
      await invoke("load_demo_song", { index });
      await refreshTracks();
    } catch (err) {
      setDemoSongError(String(err));
    } finally {
      setLoadingDemoSong(null);
    }
  }

  async function runCommand(command: string, args?: Record<string, unknown>) {
    try {
      await invoke(command, args);
      setAudioError(null);
    } catch (err) {
      setAudioError(String(err));
    }
  }

  async function refreshProjects() {
    try {
      const list = await invoke<Project[]>("list_projects");
      setProjects(list);
      if (!currentProjectId && list.length > 0) {
        setCurrentProjectId(list[0].id);
      }
    } catch (err) {
      setAudioError(String(err));
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const created = await invoke<Project>("create_project", { name, sourceFile: null });
      setNewProjectName("");
      await refreshProjects();
      setCurrentProjectId(created.id);
    } catch (err) {
      setAudioError(String(err));
    }
  }

  async function handleRenameProject(id: string, name: string) {
    try {
      await invoke("rename_project", { id, name });
      await refreshProjects();
    } catch (err) {
      setAudioError(String(err));
    }
  }

  async function handleDeleteProject(id: string) {
    try {
      await invoke("delete_project", { id });
      if (currentProjectId === id) setCurrentProjectId(null);
      await refreshProjects();
    } catch (err) {
      setAudioError(String(err));
    }
  }

  async function handlePlayInstrument(program: number) {
    try {
      await invoke("play_instrument_note", { program, note: 60 });
      setInstrumentError(null);
    } catch (err) {
      setInstrumentError(String(err));
    }
  }

  async function handleExportMix() {
    const path = await save({ defaultPath: "mix.wav", filters: [{ name: "WAV", extensions: ["wav"] }] });
    if (!path) return;
    try {
      await invoke("export_mix", { path });
      setExportStatus(`Exported mix to ${path}`);
    } catch (err) {
      setExportStatus(String(err));
    }
  }

  async function handleExportStems() {
    const dir = await open({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    try {
      const written = await invoke<string[]>("export_stems", { dir });
      setExportStatus(`Exported ${written.length} stem(s) to ${dir}`);
    } catch (err) {
      setExportStatus(String(err));
    }
  }

  async function refreshTracks() {
    try {
      setTracks(await invoke<TrackInfo[]>("list_tracks"));
    } catch (err) {
      setAnalysisError(String(err));
    }
  }

  async function handleToggleMute(index: number, muted: boolean) {
    try {
      await invoke("set_track_muted", { index, muted });
      await refreshTracks();
    } catch (err) {
      setAnalysisError(String(err));
    }
  }

  async function handleSmartUpload() {
    const path = await open({
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "ogg"] }],
    });
    if (!path || Array.isArray(path)) return;

    setSmartUploadError(null);
    setUploadClassification(null);
    setSmartUploadBusy(true);
    try {
      const jobId = await invoke<string>("start_clip_classification", { filePath: path });
      pollClipClassification(jobId, path);
    } catch (err) {
      setSmartUploadError(String(err));
      setSmartUploadBusy(false);
    }
  }

  function pollClipClassification(jobId: string, filePath: string) {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<{
          status: string;
          result: { suggested_layer: string | null; confidence: number; new_layer: boolean } | null;
          error: string | null;
        }>("clip_classification_status", { jobId });

        if (status.status === "done" && status.result) {
          clearInterval(interval);
          setSmartUploadBusy(false);
          setUploadClassification({
            filePath,
            suggestedLayer: status.result.suggested_layer,
            confidence: status.result.confidence,
            newLayer: status.result.new_layer,
          });
          setLayerNameOverride(status.result.suggested_layer ?? "New layer");
        } else if (status.status === "failed") {
          clearInterval(interval);
          setSmartUploadBusy(false);
          setSmartUploadError(status.error ?? "classification failed");
        }
      } catch (err) {
        clearInterval(interval);
        setSmartUploadBusy(false);
        setSmartUploadError(String(err));
      }
    }, 1000);
  }

  async function handleConfirmSmartUpload() {
    if (!uploadClassification) return;
    try {
      await invoke("load_clip_into_layer", {
        filePath: uploadClassification.filePath,
        layerName: layerNameOverride.trim() || "New layer",
      });
      setUploadClassification(null);
      await refreshTracks();
    } catch (err) {
      setSmartUploadError(String(err));
    }
  }

  async function handlePickClip() {
    const path = await open({
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "ogg"] }],
    });
    if (!path || Array.isArray(path)) return;
    setClipPath(path);
  }

  async function handleUploadSong() {
    const path = await open({
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "ogg"] }],
    });
    if (!path || Array.isArray(path)) return;

    setAnalysisError(null);
    try {
      const jobId = await invoke<string>("start_analysis", { filePath: path });
      pollAnalysis(jobId);
    } catch (err) {
      setAnalysisError(String(err));
    }
  }

  function pollAnalysis(jobId: string) {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<AnalysisStatus>("analysis_status", { jobId });
        setAnalysis(status);
        if (status.status === "done" && status.result) {
          clearInterval(interval);
          await invoke("load_stems_from_result", { result: status.result });
          if (currentProjectId) {
            await invoke("save_scene_graph", { projectId: currentProjectId, data: status.result });
          }
          await refreshTracks();
        } else if (status.status === "failed") {
          clearInterval(interval);
          setAnalysisError(status.error ?? "analysis failed");
        }
      } catch (err) {
        clearInterval(interval);
        setAnalysisError(String(err));
      }
    }, 1000);
  }

  async function refreshVoiceNotes() {
    try {
      setVoiceNotes(await invoke<VoiceNote[]>("list_voice_notes"));
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  async function handleStartRecording() {
    try {
      await invoke("start_voice_recording");
      setIsRecording(true);
      setVoiceNoteError(null);
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  async function handleStopRecording() {
    const title = window.prompt("Name this voice note:", "New idea") ?? "Untitled";
    try {
      await invoke("stop_voice_recording", { title });
      setIsRecording(false);
      await refreshVoiceNotes();
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  async function handlePlayVoiceNote(filePath: string) {
    try {
      await invoke("play_voice_note", { filePath });
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  async function handlePlayVoiceNoteAsInstrument(filePath: string) {
    try {
      await invoke("play_voice_note_as_instrument", { filePath, program: instrumentProgram });
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  async function handleDeleteVoiceNote(id: string) {
    try {
      await invoke("delete_voice_note", { id });
      await refreshVoiceNotes();
    } catch (err) {
      setVoiceNoteError(String(err));
    }
  }

  return (
    <div className="app-shell">
      <header className="app-shell__titlebar">
        <span className="app-shell__title">Dawsons</span>
        <span className={`sidecar-badge sidecar-badge--${sidecarStatus}`}>
          AI engine: {sidecarStatus}
        </span>
      </header>
      <main className="app-shell__main">
        <section className="hero">
          <h1 className="hero__title">Create a song</h1>
          <p className="hero__subtitle">
            Load an example to see a layered project right away, or upload your own song below.
          </p>
          <div className="example-grid">
            {demoSongs.map((song) => (
              <div key={song.index} className="example-card">
                <h3>{song.title}</h3>
                <p>{song.description}</p>
                <button onClick={() => handleLoadDemoSong(song.index)} disabled={loadingDemoSong === song.index}>
                  {loadingDemoSong === song.index ? "Loading…" : "Load example"}
                </button>
              </div>
            ))}
          </div>
          {demoSongError && <p className="debug-panel__error">{demoSongError}</p>}
        </section>

        {tracks.length > 0 && (
          <section className="layered-tracks">
            <h2>Your tracks</h2>
            {tracks.map((t, i) => (
              <div key={t.name + i} className={`layer layer--${i % 6}`}>
                <div className="layer__header">
                  <span className="layer__name">{t.name}</span>
                  <label className="layer__mute">
                    <input type="checkbox" checked={t.muted} onChange={(e) => handleToggleMute(i, e.target.checked)} />
                    Mute
                  </label>
                </div>
                <div className="layer__bar" />
              </div>
            ))}
            <div className="debug-panel__buttons" style={{ marginTop: "0.75rem" }}>
              <button onClick={() => runCommand("transport_play")}>Play</button>
              <button onClick={() => runCommand("transport_pause")}>Pause</button>
              <button onClick={() => runCommand("transport_stop")}>Stop</button>
            </div>
          </section>
        )}

        <section className="debug-panel">
          <h2>Projects</h2>
          <div className="debug-panel__field">
            <select value={currentProjectId ?? ""} onChange={(e) => setCurrentProjectId(e.target.value || null)}>
              <option value="">No project selected</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="debug-panel__field">
            <input
              type="text"
              placeholder="New project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <button onClick={handleCreateProject}>New project</button>
          </div>
          {currentProjectId && (
            <div className="debug-panel__buttons">
              <button
                onClick={() => {
                  const name = window.prompt("Rename project to:");
                  if (name) handleRenameProject(currentProjectId, name);
                }}
              >
                Rename
              </button>
              <button onClick={() => handleDeleteProject(currentProjectId)}>Delete</button>
            </div>
          )}
        </section>

        <section className="debug-panel">
          <h2>Song analysis (M4)</h2>
          <p className="debug-panel__hint">
            Uploads a song to the local AI sidecar, which runs Demucs stem separation on your own
            machine — no server, no upload anywhere.
          </p>
          <div className="debug-panel__buttons">
            <button onClick={handleUploadSong}>Upload song…</button>
          </div>
          {analysis && analysis.status !== "done" && (
            <p className="debug-panel__hint">
              {analysis.status}
              {analysis.stage ? ` — ${analysis.stage}` : ""} ({Math.round(analysis.progress * 100)}%)
            </p>
          )}
          {analysisError && <p className="debug-panel__error">{analysisError}</p>}
          <ul className="voice-note-list">
            {tracks.map((t, i) => (
              <li key={t.name + i} className="voice-note-list__item">
                <span>{t.name}</span>
                <span className="voice-note-list__actions">
                  <label>
                    <input type="checkbox" checked={t.muted} onChange={(e) => handleToggleMute(i, e.target.checked)} />
                    Mute
                  </label>
                </span>
              </li>
            ))}
            {tracks.length === 0 && <li className="debug-panel__hint">No tracks loaded yet.</li>}
          </ul>
        </section>

        <section className="debug-panel">
          <h2>Smart upload</h2>
          <p className="debug-panel__hint">
            Drop in any sound and Dawsons figures out where it goes — it runs the same AI that
            separates songs into stems, sees which instrument the clip looks most like, and offers
            to drop it straight into that layer (or a brand new one if nothing matches).
          </p>
          <div className="debug-panel__buttons">
            <button onClick={handleSmartUpload} disabled={smartUploadBusy}>
              {smartUploadBusy ? "Listening…" : "Upload a sound…"}
            </button>
          </div>
          {smartUploadError && <p className="debug-panel__error">{smartUploadError}</p>}
          {uploadClassification && (
            <>
              <p className="debug-panel__hint">
                {uploadClassification.newLayer
                  ? "Doesn't clearly match an existing instrument — suggesting a new layer."
                  : `Sounds like ${uploadClassification.suggestedLayer} (${Math.round(
                      uploadClassification.confidence * 100
                    )}% confident).`}
              </p>
              <label className="debug-panel__field">
                Layer name:
                <input
                  type="text"
                  value={layerNameOverride}
                  onChange={(e) => setLayerNameOverride(e.target.value)}
                />
              </label>
              <div className="debug-panel__buttons">
                <button onClick={handleConfirmSmartUpload}>Add to timeline</button>
              </div>
            </>
          )}
        </section>

        <section className="debug-panel">
          <h2>Export</h2>
          <p className="debug-panel__hint">
            Bounces whatever's currently loaded in the audio engine to local files you choose — no server involved.
          </p>
          <div className="debug-panel__buttons">
            <button onClick={handleExportMix}>Export mix (.wav)</button>
            <button onClick={handleExportStems}>Export stems…</button>
          </div>
          {exportStatus && <p className="debug-panel__hint">{exportStatus}</p>}
        </section>

        <section className="debug-panel">
          <h2>M2 debug: audio engine</h2>
          <div className="debug-panel__buttons">
            <button onClick={() => runCommand("debug_play_test_tone")}>Play test tone</button>
            <button onClick={() => runCommand("transport_pause")}>Pause</button>
            <button onClick={() => runCommand("transport_stop")}>Stop</button>
          </div>
          {audioError && <p className="debug-panel__error">{audioError}</p>}
        </section>

        <section className="debug-panel">
          <h2>Clip tools: reverse, re-pitch &amp; reverb</h2>
          <p className="debug-panel__hint">
            Flip a clip backwards, shift its pitch, or drop it in a room — the classic tricks (a
            favorite of producers like Charlie Puth) for turning an isolated sound — a Demucs stem,
            an exported clip, any audio file — into something new.
          </p>
          <div className="debug-panel__buttons">
            <button onClick={handlePickClip}>Pick a clip…</button>
          </div>
          <p className="debug-panel__hint">
            {clipPath ? `Using: ${clipPath}` : "No clip picked — will use the built-in test tone."}
          </p>
          <label className="debug-panel__field">
            <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
            Reverse
          </label>
          <label className="debug-panel__field">
            Pitch shift: {semitones} semitone{Math.abs(semitones) === 1 ? "" : "s"}
            <input
              type="range"
              min={-24}
              max={24}
              value={semitones}
              onChange={(e) => setSemitones(Number(e.target.value))}
            />
          </label>
          <label className="debug-panel__field">
            Reverb: {Math.round(reverbWet * 100)}% wet
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(reverbWet * 100)}
              onChange={(e) => setReverbWet(Number(e.target.value) / 100)}
            />
          </label>
          <label className="debug-panel__field">
            Room size: {Math.round(reverbRoom * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(reverbRoom * 100)}
              onChange={(e) => setReverbRoom(Number(e.target.value) / 100)}
            />
          </label>
          <div className="debug-panel__buttons">
            <button
              onClick={() =>
                clipPath
                  ? runCommand("apply_reverse_pitch_to_file", {
                      filePath: clipPath,
                      reverse,
                      semitones,
                      reverbWet,
                      reverbRoom,
                    })
                  : runCommand("debug_play_reversed_pitched_tone", { reverse, semitones })
              }
            >
              Play with effects
            </button>
          </div>
        </section>

        <section className="debug-panel">
          <h2>Instrument library</h2>
          <p className="debug-panel__hint">
            {soundfontReady === false
              ? "SoundFont not downloaded yet — run ./scripts/download_soundfont.sh."
              : "128 General MIDI instruments (piano, guitar, bass, strings, brass, synths, and more) from a single free SoundFont — click a note to preview."}
          </p>
          <div className="debug-panel__buttons">
            {POPULAR_INSTRUMENTS.map((p) => (
              <button key={p} onClick={() => handlePlayInstrument(p)}>
                {GM_INSTRUMENTS[p]}
              </button>
            ))}
          </div>
          <div className="debug-panel__field">
            <input
              type="text"
              placeholder="Search all 128 instruments…"
              value={instrumentSearch}
              onChange={(e) => setInstrumentSearch(e.target.value)}
            />
            <select
              value={instrumentProgram}
              onChange={(e) => setInstrumentProgram(Number(e.target.value))}
              size={6}
            >
              {GM_INSTRUMENTS.map((name, i) =>
                name.toLowerCase().includes(instrumentSearch.toLowerCase()) ? (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ) : null
              )}
            </select>
            <button onClick={() => handlePlayInstrument(instrumentProgram)}>Play</button>
          </div>
          {instrumentError && <p className="debug-panel__error">{instrumentError}</p>}
        </section>

        <section className="debug-panel">
          <h2>Voice Notes</h2>
          <p className="debug-panel__hint">
            Captured and stored entirely on this machine — no server, no cloud storage cost.
          </p>
          <div className="debug-panel__buttons">
            {!isRecording ? (
              <button onClick={handleStartRecording}>Start recording</button>
            ) : (
              <button onClick={handleStopRecording}>Stop &amp; save</button>
            )}
          </div>
          {voiceNoteError && <p className="debug-panel__error">{voiceNoteError}</p>}
          <ul className="voice-note-list">
            {voiceNotes.map((note) => (
              <li key={note.id} className="voice-note-list__item">
                <span>
                  {note.title} ({note.duration_sec.toFixed(1)}s)
                </span>
                <span className="voice-note-list__actions">
                  <button onClick={() => handlePlayVoiceNote(note.file_path)}>Play</button>
                  <button onClick={() => handlePlayVoiceNoteAsInstrument(note.file_path)}>
                    Play as {GM_INSTRUMENTS[instrumentProgram]}
                  </button>
                  <button onClick={() => handleDeleteVoiceNote(note.id)}>Delete</button>
                </span>
              </li>
            ))}
            {voiceNotes.length === 0 && <li className="debug-panel__hint">No voice notes yet.</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}
