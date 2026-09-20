"""Per-job working directory layout under app.config.WORK_DIR."""

from pathlib import Path

from app.config import WORK_DIR


def job_dir(job_id: str) -> Path:
    return WORK_DIR / "analysis" / job_id


def classify_dir(job_id: str) -> Path:
    return WORK_DIR / "classify" / job_id


def generate_dir(job_id: str) -> Path:
    return WORK_DIR / "generate" / job_id
