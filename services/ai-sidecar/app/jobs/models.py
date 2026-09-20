"""Job status types shared between the manager and the /analyze routes."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.PENDING
    stage: str | None = None
    progress: float = 0.0
    result: dict[str, Any] | None = None
    error: str | None = None
