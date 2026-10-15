"""POST /stems — upload a song, split it with Demucs, fetch the WAVs.

This is the local engine the browser studio calls. It is not part of the
static website and it does not use a paid API.

Run it yourself (first launch downloads the free htdemucs_6s weights):

    cd services/ai-sidecar
    pip install -r requirements.txt
    uvicorn app.main:app --host 127.0.0.1 --port 8765

Then paste http://127.0.0.1:8765 into Studio's "Local engine URL".
The sidecar binds to localhost; CORS is open so the browser page can call it.
"""

from __future__ import annotations

import re
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import detect_device
from app.jobs import manager
from app.jobs.models import JobStatus
from app.storage.paths import job_dir

router = APIRouter()

_MAX_BYTES = 40 * 1024 * 1024
_AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aiff", ".aif", ".mp4", ".webm", ".aac"}
_STEM_NAME = re.compile(r"[a-z0-9_-]+")


def _run(job_id: str, input_path: Path) -> None:
    manager.update(job_id, status=JobStatus.RUNNING, stage="separating_stems", progress=0.05)
    try:
        from app.pipeline.stems import separate

        def on_progress(stage: str, progress: float) -> None:
            manager.update(job_id, stage=stage, progress=progress)

        paths = separate(input_path, job_dir(job_id), device=detect_device(), on_progress=on_progress)
        stems = {name: name for name in paths}
        manager.update(job_id, status=JobStatus.DONE, stage=None, progress=1.0, result={"stems": stems, "engine": "demucs"})
    except Exception as exc:  # noqa: BLE001 — surface the failure on the job
        manager.update(job_id, status=JobStatus.FAILED, error=str(exc))


@router.post("/stems", status_code=202)
async def start_stems(file: UploadFile = File(...)) -> dict[str, str]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="file is over 40 MB")
    suffix = Path(file.filename or "audio").suffix.lower()
    if suffix not in _AUDIO_SUFFIXES:
        suffix = ".wav"
    job_id = str(uuid.uuid4())
    dest = job_dir(job_id)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"input{suffix}").write_bytes(raw)
    manager.create(job_id)
    threading.Thread(target=_run, args=(job_id, dest / f"input{suffix}"), daemon=True).start()
    return {"job_id": job_id}


@router.get("/stems/{job_id}")
def get_stems(job_id: str):
    record = manager.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record


@router.get("/stems/{job_id}/{name}")
def get_stem_file(job_id: str, name: str):
    if _STEM_NAME.fullmatch(name) is None:
        raise HTTPException(status_code=400, detail="bad stem name")
    path = job_dir(job_id) / f"{name}.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="stem not ready")
    return FileResponse(path, media_type="audio/wav", filename=f"{name}.wav")
