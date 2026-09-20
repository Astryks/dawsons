"""Job status types shared between the manager and the /analyze routes."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.PENDING
    stage: Optional[str] = None
    progress: float = 0.0
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
