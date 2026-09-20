"""POST /analyze and GET /analyze/{job_id}.

Implemented starting at M4: request/response contract is
    POST /analyze {"file_path": str, "project_id": str} -> {"job_id": str}
    GET  /analyze/{job_id} -> {"job_id", "status", "stage"?, "progress"?, "result"?, "error"?}
where `result` (only present when status == "done") is a Scene-Graph-shaped
JSON fragment validated against packages/scene-graph-schema before it's
returned. See app/pipeline/orchestrator.py for the stage sequence and
app/jobs/manager.py for job tracking. Left as a stub through M1-M3 so the
sidecar skeleton (health + process lifecycle) can be verified before the
pipeline is implemented.
"""

from fastapi import APIRouter

router = APIRouter()
