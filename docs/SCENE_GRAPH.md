# Musical Scene Graph

The Scene Graph is a versioned JSON document describing a song's structure:
metadata, tempo, key, time signature, sections, tracks (audio stems in
Phase 1; MIDI notes in later phases), chords, and automation. It is the
single source of truth — the timeline UI, the text/JSON breakdown view, and
the audio engine's track list all read from the same graph. AI analysis
writes to it; user edits (later phases) also write to it, tagged
`source: "user"`.

Schema source of truth: [`packages/scene-graph-schema/schema/scene-graph.schema.json`](../packages/scene-graph-schema/schema/scene-graph.schema.json)
(JSON Schema, draft 2020-12). Generated types for TypeScript, Rust, and
Python live alongside it in that package — see
[`scripts/gen_schema_types.sh`](../scripts/gen_schema_types.sh).

## Design points

- **Every AI-derived value carries `confidence` (0–1) and `source`** (which
  model/algorithm produced it, or `"user"` for a manual edit). This is what
  lets the UI show "we're not sure about this chord" honestly instead of
  presenting AI output as ground truth.
- **Times are in seconds** (float) as the base unit. Tempo-relative/bar-beat
  positions may be added in a later schema version if needed.
- **`schemaVersion`** is a semver string (`"1.0.0"` for Phase 1). A version
  bump is required for breaking changes; see
  [`packages/scene-graph-schema/CHANGELOG.md`](../packages/scene-graph-schema/CHANGELOG.md).
  Loading an older-versioned project triggers a migration in
  `apps/desktop/src-tauri/src/scene_graph/migrations/`.
- **Persistence**: stored in SQLite as a single JSON blob column per project
  in Phase 1 (`scene_graphs(project_id, schema_version, data, updated_at)`).
  Normalized query tables can be added later if cross-project search is
  ever needed — not required for a single-song MVP.

## Example fragment

```json
{
  "schemaVersion": "1.0.0",
  "song": {
    "id": "5b1f...",
    "title": "my-song.mp3",
    "durationSec": 214.3,
    "bpm": { "value": 128, "confidence": 0.91, "source": "librosa-tempo" },
    "key": { "tonic": "A", "mode": "minor", "confidence": 0.78, "source": "librosa-key" },
    "timeSignature": { "numerator": 4, "denominator": 4 },
    "chords": [
      { "symbol": "Am", "root": "A", "quality": "min", "startSec": 0.0, "endSec": 3.2, "confidence": 0.85, "source": "chord-detector-v1" },
      { "symbol": "G", "root": "G", "quality": "maj", "startSec": 3.2, "endSec": 6.4, "confidence": 0.81, "source": "chord-detector-v1" }
    ],
    "tracks": [
      { "id": "t-vocals", "name": "Vocals", "type": "audio", "instrument": "vocals", "sourceStem": "vocals", "audioFilePath": "vocals.wav", "source": "demucs", "confidence": 0.9 }
    ]
  }
}
```
