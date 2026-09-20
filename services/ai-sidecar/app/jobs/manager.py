"""In-memory job tracking (job_id -> JobRecord).

A single-process, in-memory dict is sufficient for Phase 1 — the sidecar's
lifetime matches the app's, and results are handed off to Rust for durable
storage immediately on completion, so the sidecar itself never needs to
persist jobs across restarts.
"""

from __future__ import annotations

import threading

from app.jobs.models import JobRecord, JobStatus

_lock = threading.Lock()
_jobs: dict[str, JobRecord] = {}


def create(job_id: str) -> JobRecord:
    record = JobRecord(job_id=job_id, status=JobStatus.PENDING)
    with _lock:
        _jobs[job_id] = record
    return record


def get(job_id: str) -> JobRecord | None:
    with _lock:
        return _jobs.get(job_id)


def update(job_id: str, **fields) -> None:
    with _lock:
        record = _jobs.get(job_id)
        if record is None:
            return
        _jobs[job_id] = record.model_copy(update=fields)
