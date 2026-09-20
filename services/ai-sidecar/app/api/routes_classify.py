"""POST /classify and GET /classify/{job_id} — the "smart upload" endpoint.

Same async job pattern as /analyze (Demucs separation isn't instant), but
scoped to answering one question: which instrument layer does this clip
belong in, or does it need a new one.
"""

import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import detect_device
from app.jobs import manager
from app.jobs.models import JobRecord, JobStatus
from app.pipeline.classify import classify_clip
from app.storage.paths import classify_dir

router = APIRouter()


class ClassifyRequest(BaseModel):
    file_path: str


class ClassifyResponse(BaseModel):
    job_id: str


def _run_job(job_id: str, input_path: Path) -> None:
    manager.update(job_id, status=JobStatus.RUNNING, stage="separating_stems", progress=0.0)
    try:
        result = classify_clip(input_path, classify_dir(job_id), device=detect_device())
        manager.update(job_id, status=JobStatus.DONE, stage=None, progress=1.0, result=result)
    except Exception as e:  # noqa: BLE001 - report any failure back through the job record
        manager.update(job_id, status=JobStatus.FAILED, error=str(e))


@router.post("/classify", response_model=ClassifyResponse, status_code=202)
def start_classify(req: ClassifyRequest) -> ClassifyResponse:
    input_path = Path(req.file_path)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"file not found: {req.file_path}")

    job_id = str(uuid.uuid4())
    manager.create(job_id)
    threading.Thread(target=_run_job, args=(job_id, input_path), daemon=True).start()
    return ClassifyResponse(job_id=job_id)


@router.get("/classify/{job_id}", response_model=JobRecord)
def get_classify(job_id: str) -> JobRecord:
    record = manager.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record
