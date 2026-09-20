"""POST /analyze and GET /analyze/{job_id}.

M4 scope: stem separation only. The response `result` is
`{"stems": {name: path}}` for now — the full Scene-Graph-fragment shape
(with tempo/key/chords/sections) lands with M5's scene_graph/builder.py,
once those stages exist to fill it in.
"""

import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import detect_device
from app.jobs import manager
from app.jobs.models import JobRecord, JobStatus
from app.pipeline.orchestrator import run_analysis
from app.storage.paths import job_dir

router = APIRouter()


class AnalyzeRequest(BaseModel):
    file_path: str
    project_id: Optional[str] = None


class AnalyzeResponse(BaseModel):
    job_id: str


def _run_job(job_id: str, input_path: Path) -> None:
    manager.update(job_id, status=JobStatus.RUNNING, stage="separating_stems", progress=0.0)
    try:
        def on_progress(stage: str, progress: float) -> None:
            manager.update(job_id, stage=stage, progress=progress)

        result = run_analysis(input_path, job_dir(job_id), device=detect_device(), on_progress=on_progress)
        manager.update(job_id, status=JobStatus.DONE, stage=None, progress=1.0, result=result)
    except Exception as e:  # noqa: BLE001 - report any failure back through the job record
        manager.update(job_id, status=JobStatus.FAILED, error=str(e))


@router.post("/analyze", response_model=AnalyzeResponse, status_code=202)
def start_analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    input_path = Path(req.file_path)
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"file not found: {req.file_path}")

    job_id = str(uuid.uuid4())
    manager.create(job_id)
    threading.Thread(target=_run_job, args=(job_id, input_path), daemon=True).start()
    return AnalyzeResponse(job_id=job_id)


@router.get("/analyze/{job_id}", response_model=JobRecord)
def get_analyze(job_id: str) -> JobRecord:
    record = manager.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record
