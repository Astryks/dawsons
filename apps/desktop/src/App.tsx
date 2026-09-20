import { useEffect, useState } from "react";

type SidecarStatus = "starting" | "ready" | "error";

export default function App() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>("starting");

  useEffect(() => {
    // M3 wires this up to a real `sidecar:status` Tauri event; until then
    // the shell has no sidecar to report on.
    setSidecarStatus("starting");
  }, []);

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
      </main>
    </div>
  );
}
