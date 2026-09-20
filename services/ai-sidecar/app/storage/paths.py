"""Per-job working directory layout under app.config.WORK_DIR.

Implemented at M4:
    def job_dir(project_id: str, job_id: str) -> Path:
        # WORK_DIR / "projects" / project_id / "analysis" / job_id
"""
