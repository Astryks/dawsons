import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

type SidecarStatus = "starting" | "ready" | "error";

interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  source_file: string | null;
}

export default function App() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>("starting");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [reverse, setReverse] = useState(false);
  const [semitones, setSemitones] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    // M3 wires this up to a real `sidecar:status` Tauri event; until then
    // the shell has no sidecar to report on.
    setSidecarStatus("starting");
    refreshProjects();
  }, []);

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

  return (
    <div className="app-shell">
      <header className="app-shell__titlebar">
        <span className="app-shell__title">Dawsons</span>
        <span className={`sidecar-badge sidecar-badge--${sidecarStatus}`}>
          AI engine: {sidecarStatus}
        </span>
      </header>
      <main className="app-shell__main">
        <p>Desktop shell scaffold — timeline and upload panel land in later milestones.</p>

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
          <h2>Reverse &amp; re-pitch</h2>
          <p className="debug-panel__hint">
            Flip a clip backwards and shift its pitch — the classic trick behind turning an
            unrelated recording into a new texture.
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
          <div className="debug-panel__buttons">
            <button onClick={() => runCommand("debug_play_reversed_pitched_tone", { reverse, semitones })}>
              Play with effects
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
