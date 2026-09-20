"""POST /pitch and GET /pitch/{job_id} — the optional "high accuracy"
voice-to-instrument pitch detection mode via CREPE. Same async job
pattern as the other model-backed endpoints; the default, fast path
stays the pure-Rust YIN implementation in audio_engine/pitch.rs, which
never touches the sidecar at all.
"""

import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import detect_device
from app.jobs import manager
from app.jobs.models import JobRecord, JobStatus
from app.pipeline.pitch_crepe import detect_notes

router = APIRouter()


class PitchRequest(BaseModel):
    file_path: str


class PitchResponse(BaseModel):
    job_id: str


def _run_job(job_id: str, input_path: Path) -> None:
    manager.update(job_id, status=JobStatus.RUNNING, stage="detecting_pitch", progress=0.0)
    try:
        notes = detect_notes(input_path, device=detect_device())
        manager.update(job_id, status=JobStatus.DONE, stage=None, progress=1.0, result={"notes": notes})
    except Exception as e:  # noqa: BLE001 - report any failure back through the job record
        manager.update(job_id, status=JobStatus.FAILED, error=str(e))


@router.post("/pitch", response_model=PitchResponse, status_code=202)
def start_pitch(req: PitchRequest) -> PitchResponse:
    input_path = Path(req.file_path)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"file not found: {req.file_path}")

    job_id = str(uuid.uuid4())
    manager.create(job_id)
    threading.Thread(target=_run_job, args=(job_id, input_path), daemon=True).start()
    return PitchResponse(job_id=job_id)


@router.get("/pitch/{job_id}", response_model=JobRecord)
def get_pitch(job_id: str) -> JobRecord:
    record = manager.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record
