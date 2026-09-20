"""Job status types shared between the manager and the /analyze routes.

Implemented at M4:
    class JobStatus(str, Enum): PENDING, RUNNING, DONE, FAILED
    class JobRecord(BaseModel): job_id, status, stage, progress, result, error
"""
