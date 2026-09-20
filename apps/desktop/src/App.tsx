import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SidecarStatus = "starting" | "ready" | "error";

export default function App() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>("starting");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [reverse, setReverse] = useState(false);
  const [semitones, setSemitones] = useState(0);

  useEffect(() => {
    // M3 wires this up to a real `sidecar:status` Tauri event; until then
    // the shell has no sidecar to report on.
    setSidecarStatus("starting");
  }, []);

  async function runCommand(command: string, args?: Record<string, unknown>) {
    try {
      await invoke(command, args);
      setAudioError(null);
    } catch (err) {
      setAudioError(String(err));
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
        <p>Desktop shell scaffold — timeline, transport, and upload panel land in later milestones.</p>

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
