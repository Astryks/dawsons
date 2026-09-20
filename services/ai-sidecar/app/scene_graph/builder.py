"""Assembles pipeline stage outputs into a Scene-Graph-shaped JSON
fragment matching packages/scene-graph-schema/schema/scene-graph.schema.json.
"""

import uuid
from pathlib import Path

from app.pipeline.chords import ChordSegment
from app.pipeline.sections import Section
from app.pipeline.tempo_key import TempoKeyResult

_TIME_SIGNATURE = {"numerator": 4, "denominator": 4}  # not detected yet; a reasonable Phase 1 default


def build_fragment(
    *,
    title: str,
    duration_sec: float,
    source_file: str,
    stem_paths: dict[str, Path],
    tempo_key: TempoKeyResult,
    chords: list[ChordSegment],
    sections: list[Section],
) -> dict:
    tracks = []
    for stem_name, path in stem_paths.items():
        tracks.append(
            {
                "id": f"t-{stem_name}",
                "name": stem_name.capitalize(),
                "type": "audio",
                "instrument": stem_name,
                "audioFilePath": str(path),
                "sourceStem": stem_name,
                "gainDb": 0,
                "muted": False,
                "solo": False,
                "notes": [],
                "confidence": 0.9,  # Demucs doesn't expose a per-stem confidence score
                "source": "demucs",
            }
        )

    return {
        "schemaVersion": "1.0.0",
        "song": {
            "id": str(uuid.uuid4()),
            "title": title,
            "sourceFile": source_file,
            "durationSec": round(duration_sec, 3),
            "bpm": {"value": tempo_key.bpm, "confidence": tempo_key.bpm_confidence, "source": "librosa-tempo"},
            "key": {
                "tonic": tempo_key.key_tonic,
                "mode": tempo_key.key_mode,
                "confidence": tempo_key.key_confidence,
                "source": "librosa-key",
            },
            "timeSignature": _TIME_SIGNATURE,
            "sections": [
                {
                    "id": s.id,
                    "label": s.label,
                    "startSec": s.start_sec,
                    "endSec": s.end_sec,
                    "confidence": 0.6,  # novelty-based segmentation is the weakest-evidence stage here
                    "source": "section-detector-v1",
                }
                for s in sections
            ],
            "tracks": tracks,
            "chords": [
                {
                    "symbol": c.symbol,
                    "root": c.root,
                    "quality": c.quality,
                    "bassNote": None,
                    "startSec": c.start_sec,
                    "endSec": c.end_sec,
                    "confidence": c.confidence,
                    "source": "chord-detector-v1",
                }
                for c in chords
                if c.quality in ("maj", "min")  # schema's Chord.quality enum excludes our internal "other"/no-chord marker
            ],
            "automation": [],
        },
    }
