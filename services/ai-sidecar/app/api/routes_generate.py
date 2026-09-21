"""POST /generate and GET /generate/{job_id} — text-prompt-to-original-
instrumental generation via ACE-Step. Same async job pattern as
/analyze and /classify: generation is slow enough that a request/poll
split is the right shape, not a blocking call.
"""

import threading
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import detect_generation_device
from app.jobs import manager
from app.jobs.models import JobRecord, JobStatus
from app.pipeline.generate import generate
from app.storage.paths import generate_dir

router = APIRouter()


class GenerateRequest(BaseModel):
    prompt: str
    duration_sec: float = 15.0


class GenerateResponse(BaseModel):
    job_id: str


def _run_job(job_id: str, prompt: str, duration_sec: float) -> None:
    manager.update(job_id, status=JobStatus.RUNNING, stage="generating", progress=0.0)
    try:
        out_path = generate(prompt, duration_sec, generate_dir(job_id), device=detect_generation_device())
        manager.update(
            job_id,
            status=JobStatus.DONE,
            stage=None,
            progress=1.0,
            result={"audio_file_path": str(out_path)},
        )
    except Exception as e:  # noqa: BLE001 - report any failure back through the job record
        manager.update(job_id, status=JobStatus.FAILED, error=str(e))


@router.post("/generate", response_model=GenerateResponse, status_code=202)
def start_generate(req: GenerateRequest) -> GenerateResponse:
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt must not be empty")
    if not (1.0 <= req.duration_sec <= 240.0):
        raise HTTPException(status_code=400, detail="duration_sec must be between 1 and 240")

    job_id = str(uuid.uuid4())
    manager.create(job_id)
    threading.Thread(target=_run_job, args=(job_id, req.prompt, req.duration_sec), daemon=True).start()
    return GenerateResponse(job_id=job_id)


@router.get("/generate/{job_id}", response_model=JobRecord)
def get_generate(job_id: str) -> JobRecord:
    record = manager.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record
