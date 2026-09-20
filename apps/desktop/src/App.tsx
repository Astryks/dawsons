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

// Note names for the chord-starter feature, mapped to MIDI note numbers in
// the octave starting at middle C (C4 = 60) — "press C, hear a C major
// chord" on any of the 128 instruments, the same idea as a guitar's open
// chord shapes.
const CHORD_ROOTS: { name: string; note: number }[] = [
  { name: "C", note: 60 },
  { name: "C#", note: 61 },
  { name: "D", note: 62 },
  { name: "D#", note: 63 },
  { name: "E", note: 64 },
  { name: "F", note: 65 },
  { name: "F#", note: 66 },
  { name: "G", note: 67 },
  { name: "G#", note: 68 },
  { name: "A", note: 69 },
  { name: "A#", note: 70 },
  { name: "B", note: 71 },
];

const CHORD_QUALITIES = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "dominant7", label: "7th" },
  { value: "major7", label: "Major 7th" },
  { value: "minor7", label: "Minor 7th" },
  { value: "sus4", label: "Sus4" },
  { value: "diminished", label: "Diminished" },
];

const GENRES = ["All", "Pop", "Jazz", "Hip-Hop", "Holiday", "Funk / Rock", "R&B / Soul", "Folk / Acoustic"];

// Factual reference points only (song title / artist / year) — real songs
// people already know, used purely to show what each genre sounds like.
// Not chord charts, not transcriptions, not audio: see demo_songs.rs for
// why the actual playable examples below are original Dawsons
// compositions in each style rather than reconstructions of these tracks.
const GENRE_INSPIRATION: Record<string, { title: string; artist: string; year?: number }[]> = {
  Pop: [
    { title: "Love Story", artist: "Taylor Swift", year: 2008 },
    { title: "Last Christmas", artist: "Wham!", year: 1984 },
    { title: "Without You", artist: "Mariah Carey", year: 1994 },
    { title: "Beat It", artist: "Michael Jackson", year: 1983 },
    { title: "Rolling in the Deep", artist: "Adele", year: 2010 },
  ],
  Jazz: [
    { title: "My Funny Valentine", artist: "Chet Baker", year: 1954 },
    { title: "Almost Blue", artist: "Chet Baker (an Elvis Costello song)", year: 1987 },
    { title: "I'm a Fool to Want You", artist: "Chet Baker" },
    { title: "So What", artist: "Miles Davis", year: 1959 },
    { title: "My Favorite Things", artist: "John Coltrane", year: 1961 },
  ],
  "Hip-Hop": [
    { title: "Gin and Juice", artist: "Snoop Dogg", year: 1993 },
    { title: "Still D.R.E.", artist: "Dr. Dre ft. Snoop Dogg", year: 1999 },
    { title: "Nuthin' but a 'G' Thang", artist: "Dr. Dre ft. Snoop Dogg", year: 1992 },
    { title: "Lose Yourself", artist: "Eminem", year: 2002 },
    { title: "Without Me", artist: "Eminem", year: 2002 },
  ],
  Holiday: [
    { title: "Last Christmas", artist: "Wham!", year: 1984 },
    { title: "All I Want for Christmas Is You", artist: "Mariah Carey", year: 1994 },
    { title: "Rockin' Around the Christmas Tree", artist: "Brenda Lee", year: 1958 },
    { title: "White Christmas", artist: "Bing Crosby", year: 1942 },
  ],
};

// A handful of official YouTube videos (verified official-channel uploads,
// embedded via YouTube's own player — the officially supported way to show
// a video from the platform, unlike extracting/downloading its audio,
// which is a different thing this app deliberately never does) paired
// with one of our original example songs built in a similar style, so
// users can watch the real thing and then open a comparable layered
// project of their own to explore. Video IDs: verified via web search
// against official artist/label channel uploads.
const SONG_SPOTLIGHTS: {
  title: string;
  artist: string;
  youtubeId: string;
  note: string;
  exampleSongTitle: string;
  explicit?: boolean;
}[] = [
  {
    title: "Love Story",
    artist: "Taylor Swift",
    youtubeId: "LHxXaY7NR3w",
    note: "A story-song built around a simple I–V–vi–IV-family progression under the vocal.",
    exampleSongTitle: "Storybook Sky",
  },
  {
    title: "Beat It",
    artist: "Michael Jackson",
    youtubeId: "aV4ZFhIUGEU",
    note: "Driving funk-rock groove, famous for its Eddie Van Halen guitar solo.",
    exampleSongTitle: "Night Funk Signal",
  },
  {
    title: "Gin and Juice",
    artist: "Snoop Dogg",
    youtubeId: "fWCZse1iwE0",
    note: "Classic laid-back G-funk: whiny synth lead, deep bass, funky keys.",
    exampleSongTitle: "West Coast Cruise",
    explicit: true,
  },
  {
    title: "My Funny Valentine",
    artist: "Chet Baker",
    youtubeId: "EGPRCu2kupE",
    note: "A 1954 jazz standard recording built on trumpet/vocal, piano, bass, and brushed drums.",
    exampleSongTitle: "Blue Corner",
  },
  {
    title: "Last Christmas",
    artist: "Wham!",
    youtubeId: "E8gmARGvPlI",
    note: "Warm holiday-pop with a sparkly synth hook over a simple major-key loop.",
    exampleSongTitle: "Fireside Loop",
  },
];

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
  duration_sec: number;
}

interface DemoSongInfo {
  index: number;
  title: string;
  genre: string;
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
  const [eqFreqHz, setEqFreqHz] = useState(1000);
  const [eqGainDb, setEqGainDb] = useState(0);
  const [eqQ, setEqQ] = useState(1);
  const [compressEnabled, setCompressEnabled] = useState(false);
  const [compressThresholdDb, setCompressThresholdDb] = useState(-18);
  const [compressRatio, setCompressRatio] = useState(4);
  const [delayWet, setDelayWet] = useState(0);
  const [delayMs, setDelayMs] = useState(250);
  const [delayFeedback, setDelayFeedback] = useState(0.3);
  const [playbackPositionSec, setPlaybackPositionSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateDurationSec, setGenerateDurationSec] = useState(15);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedFilePath, setGeneratedFilePath] = useState<string | null>(null);
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
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [chordRoot, setChordRoot] = useState(60);
  const [chordQuality, setChordQuality] = useState("major");
  const [chordError, setChordError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(async () => {
      try {
        const status = await invoke<{ position_sec: number; playing: boolean }>("transport_status");
        setPlaybackPositionSec(status.position_sec);
        if (!status.playing) setIsPlaying(false);
      } catch {
        setIsPlaying(false);
      }
    }, 150);
    return () => clearInterval(interval);
  }, [isPlaying]);

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

  async function handleLoadDemoSongByTitle(title: string) {
    const song = demoSongs.find((s) => s.title === title);
    if (song) await handleLoadDemoSong(song.index);
  }

  async function handleGenerateMusic() {
    if (!generatePrompt.trim()) return;
    setGenerateError(null);
    setGenerateBusy(true);
    setGeneratedFilePath(null);
    try {
      const jobId = await invoke<string>("start_music_generation", {
        prompt: generatePrompt,
        durationSec: generateDurationSec,
      });
      pollGeneration(jobId);
    } catch (err) {
      setGenerateError(String(err));
      setGenerateBusy(false);
    }
  }

  function pollGeneration(jobId: string) {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<{
          status: string;
          stage: string | null;
          result: { audio_file_path: string } | null;
          error: string | null;
        }>("music_generation_status", { jobId });

        if (status.status === "done" && status.result) {
          clearInterval(interval);
          setGenerateBusy(false);
          setGeneratedFilePath(status.result.audio_file_path);
        } else if (status.status === "failed") {
          clearInterval(interval);
          setGenerateBusy(false);
          setGenerateError(status.error ?? "generation failed");
        }
      } catch (err) {
        clearInterval(interval);
        setGenerateBusy(false);
        setGenerateError(String(err));
      }
    }, 2000);
  }

  async function handleAddGeneratedClip() {
    if (!generatedFilePath) return;
    try {
      await invoke("load_generated_clip", {
        filePath: generatedFilePath,
        name: generatePrompt.slice(0, 40) || "AI generated",
      });
      await refreshTracks();
    } catch (err) {
      setGenerateError(String(err));
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

  async function handlePlayChord() {
    try {
      await invoke("play_instrument_chord", { program: instrumentProgram, rootNote: chordRoot, quality: chordQuality });
      setChordError(null);
    } catch (err) {
      setChordError(String(err));
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

  async function handleMoveTrack(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= tracks.length) return;
    try {
      await invoke("move_track", { from: index, to });
      await refreshTracks();
    } catch (err) {
      setAnalysisError(String(err));
    }
  }

  async function handleRemoveTrack(index: number) {
    try {
      await invoke("remove_track", { index });
      await refreshTracks();
      setIsPlaying(false);
      setPlaybackPositionSec(0);
    } catch (err) {
      setAnalysisError(String(err));
    }
  }

  async function handleTransportPlay() {
    await runCommand("transport_play");
    setIsPlaying(true);
  }

  async function handleTransportPause() {
    await runCommand("transport_pause");
    setIsPlaying(false);
  }

  async function handleTransportStop() {
    await runCommand("transport_stop");
    setIsPlaying(false);
    setPlaybackPositionSec(0);
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

  const maxTrackDuration = tracks.reduce((max, t) => Math.max(max, t.duration_sec), 0.001);

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
            Pick a genre to get inspired, load an example to see a layered project right away, or
            upload your own song below.
          </p>
          <div className="debug-panel__buttons" style={{ marginBottom: "0.75rem" }}>
            {GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                style={genre === selectedGenre ? { fontWeight: 700 } : undefined}
              >
                {genre}
              </button>
            ))}
          </div>
          {selectedGenre !== "All" && GENRE_INSPIRATION[selectedGenre] && (
            <div className="layered-tracks" style={{ marginBottom: "1rem" }}>
              <h2>Songs that shaped {selectedGenre}</h2>
              <p className="debug-panel__hint">
                For inspiration — see docs/UX_DESIGN.md for why the example below is an original
                Dawsons composition in this style rather than a reconstruction of these tracks.
              </p>
              <ul className="voice-note-list">
                {GENRE_INSPIRATION[selectedGenre].map((song) => (
                  <li key={song.title + song.artist} className="voice-note-list__item">
                    <span>
                      {song.title} — {song.artist}
                      {song.year ? ` (${song.year})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="example-grid">
            {demoSongs
              .filter((song) => selectedGenre === "All" || song.genre === selectedGenre)
              .map((song) => (
                <div key={song.index} className="example-card">
                  <h3>{song.title}</h3>
                  <p className="debug-panel__hint" style={{ margin: "0 0 0.4rem" }}>
                    {song.genre}
                  </p>
                  <p>{song.description}</p>
                  <button onClick={() => handleLoadDemoSong(song.index)} disabled={loadingDemoSong === song.index}>
                    {loadingDemoSong === song.index ? "Loading…" : "Load example"}
                  </button>
                </div>
              ))}
          </div>
          {demoSongError && <p className="debug-panel__error">{demoSongError}</p>}
        </section>

        <section className="hero">
          <h1 className="hero__title">Pay attention to the layers</h1>
          <p className="hero__subtitle">
            Your favorite artists build songs the same way you're about to — vocal, guitar, bass,
            keys, drums, each on its own layer. Let's look at a few, then open a similarly-built
            example right in Dawsons to see how it comes apart.
          </p>
          <div className="example-grid">
            {SONG_SPOTLIGHTS.map((spotlight) => (
              <div key={spotlight.youtubeId} className="example-card">
                <div className="spotlight-embed">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${spotlight.youtubeId}`}
                    title={`${spotlight.title} — ${spotlight.artist}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <h3>
                  {spotlight.title} — {spotlight.artist}
                  {spotlight.explicit ? " 🅴" : ""}
                </h3>
                <p>{spotlight.note}</p>
                <button onClick={() => handleLoadDemoSongByTitle(spotlight.exampleSongTitle)}>
                  Open a similar layered example: "{spotlight.exampleSongTitle}"
                </button>
              </div>
            ))}
          </div>
        </section>

        {tracks.length > 0 && (
          <section className="layered-tracks">
            <h2>Your tracks</h2>
            {tracks.map((t, i) => (
              <div key={t.name + i} className={`layer layer--${i % 6}`}>
                <div className="layer__header">
                  <span className="layer__name">{t.name}</span>
                  <span className="layer__duration">{t.duration_sec.toFixed(1)}s</span>
                  <label className="layer__mute">
                    <input type="checkbox" checked={t.muted} onChange={(e) => handleToggleMute(i, e.target.checked)} />
                    Mute
                  </label>
                  <span className="layer__reorder">
                    <button onClick={() => handleMoveTrack(i, -1)} disabled={i === 0} title="Move layer up">
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveTrack(i, 1)}
                      disabled={i === tracks.length - 1}
                      title="Move layer down"
                    >
                      ↓
                    </button>
                    <button onClick={() => handleRemoveTrack(i)} title="Remove this layer">
                      ✕
                    </button>
                  </span>
                </div>
                <div className="layer__track">
                  <div className="layer__bar" style={{ width: `${Math.max(2, (t.duration_sec / maxTrackDuration) * 100)}%` }} />
                  {isPlaying && (
                    <div
                      className="layer__playhead"
                      style={{ left: `${Math.min(100, (playbackPositionSec / maxTrackDuration) * 100)}%` }}
                    />
                  )}
                </div>
              </div>
            ))}
            <div className="debug-panel__buttons" style={{ marginTop: "0.75rem" }}>
              <button onClick={handleTransportPlay}>Play</button>
              <button onClick={handleTransportPause}>Pause</button>
              <button onClick={handleTransportStop}>Stop</button>
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
          <h2>Generate with AI</h2>
          <p className="debug-panel__hint">
            Type a style or mood and get back an original instrumental clip — generated entirely on
            this machine by ACE-Step (a locally-run, open-weight model, not a cloud API), which you
            can then drop straight into the timeline as its own layer.
          </p>
          <div className="debug-panel__field">
            <input
              type="text"
              placeholder="e.g. upbeat lo-fi hip hop, mellow piano, soft drums"
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <label className="debug-panel__field">
            Duration: {generateDurationSec}s
            <input
              type="range"
              min={5}
              max={60}
              value={generateDurationSec}
              onChange={(e) => setGenerateDurationSec(Number(e.target.value))}
            />
          </label>
          <div className="debug-panel__buttons">
            <button onClick={handleGenerateMusic} disabled={generateBusy || !generatePrompt.trim()}>
              {generateBusy ? "Generating…" : "Generate"}
            </button>
          </div>
          {generateBusy && (
            <p className="debug-panel__hint">
              This can take a while the first time (downloading the model) and a minute or more per
              generation after that — everything runs locally, nothing is uploaded anywhere.
            </p>
          )}
          {generateError && <p className="debug-panel__error">{generateError}</p>}
          {generatedFilePath && !generateBusy && (
            <div className="debug-panel__buttons">
              <button onClick={handleAddGeneratedClip}>Add to timeline</button>
            </div>
          )}
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
          <h2>Clip tools: reverse, re-pitch, EQ, compression, delay &amp; reverb</h2>
          <p className="debug-panel__hint">
            Flip a clip backwards, shift its pitch, shape its tone, tame its dynamics, or drop it in
            a room — the classic tricks (a favorite of producers like Charlie Puth) for turning an
            isolated sound — a Demucs stem, an exported clip, any audio file — into something new.
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

          <h3 style={{ marginBottom: "0.4rem" }}>EQ</h3>
          <label className="debug-panel__field">
            Frequency: {Math.round(eqFreqHz)} Hz
            <input
              type="range"
              min={60}
              max={12000}
              step={10}
              value={eqFreqHz}
              onChange={(e) => setEqFreqHz(Number(e.target.value))}
            />
          </label>
          <label className="debug-panel__field">
            Gain: {eqGainDb > 0 ? "+" : ""}
            {eqGainDb} dB
            <input
              type="range"
              min={-24}
              max={24}
              value={eqGainDb}
              onChange={(e) => setEqGainDb(Number(e.target.value))}
            />
          </label>
          <label className="debug-panel__field">
            Width (Q): {eqQ.toFixed(1)}
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={eqQ}
              onChange={(e) => setEqQ(Number(e.target.value))}
            />
          </label>

          <h3 style={{ marginBottom: "0.4rem" }}>Compression</h3>
          <label className="debug-panel__field">
            <input
              type="checkbox"
              checked={compressEnabled}
              onChange={(e) => setCompressEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <label className="debug-panel__field">
            Threshold: {compressThresholdDb} dB
            <input
              type="range"
              min={-48}
              max={0}
              value={compressThresholdDb}
              onChange={(e) => setCompressThresholdDb(Number(e.target.value))}
            />
          </label>
          <label className="debug-panel__field">
            Ratio: {compressRatio}:1
            <input
              type="range"
              min={1}
              max={20}
              value={compressRatio}
              onChange={(e) => setCompressRatio(Number(e.target.value))}
            />
          </label>

          <h3 style={{ marginBottom: "0.4rem" }}>Delay</h3>
          <label className="debug-panel__field">
            Delay: {Math.round(delayWet * 100)}% wet
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(delayWet * 100)}
              onChange={(e) => setDelayWet(Number(e.target.value) / 100)}
            />
          </label>
          <label className="debug-panel__field">
            Time: {Math.round(delayMs)} ms
            <input
              type="range"
              min={10}
              max={1000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
            />
          </label>
          <label className="debug-panel__field">
            Feedback: {Math.round(delayFeedback * 100)}%
            <input
              type="range"
              min={0}
              max={95}
              value={Math.round(delayFeedback * 100)}
              onChange={(e) => setDelayFeedback(Number(e.target.value) / 100)}
            />
          </label>

          <h3 style={{ marginBottom: "0.4rem" }}>Reverb</h3>
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
                  ? runCommand("apply_effects_to_file", {
                      filePath: clipPath,
                      effects: {
                        reverse,
                        semitones,
                        eqFreqHz,
                        eqGainDb,
                        eqQ,
                        compressEnabled,
                        compressThresholdDb,
                        compressRatio,
                        compressAttackMs: 10,
                        compressReleaseMs: 100,
                        compressMakeupDb: 0,
                        delayMs,
                        delayFeedback,
                        delayWet,
                        reverbWet,
                        reverbRoom,
                      },
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

          <h3 style={{ marginBottom: "0.4rem" }}>Chord starter</h3>
          <p className="debug-panel__hint">
            Pressing a guitar's open C shape always plays a full C major chord — this does the same
            for {GM_INSTRUMENTS[instrumentProgram]} and every other instrument above: pick a root
            and a chord type, and get the whole chord back, not just one note.
          </p>
          <div className="debug-panel__field">
            <select value={chordRoot} onChange={(e) => setChordRoot(Number(e.target.value))}>
              {CHORD_ROOTS.map((r) => (
                <option key={r.name} value={r.note}>
                  {r.name}
                </option>
              ))}
            </select>
            <select value={chordQuality} onChange={(e) => setChordQuality(e.target.value)}>
              {CHORD_QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <button onClick={handlePlayChord}>Play chord</button>
          </div>
          {chordError && <p className="debug-panel__error">{chordError}</p>}
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
