import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.jobs.models import JobStatus
from app.main import app

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "tiny-tone.wav"


def test_analyze_missing_file_returns_400():
    response = client.post("/analyze", json={"file_path": "/nonexistent/file.wav"})
    assert response.status_code == 400


def test_analyze_missing_job_returns_404():
    response = client.get("/analyze/nonexistent-job-id")
    assert response.status_code == 404


def test_analyze_separates_a_real_file_into_stems():
    response = client.post("/analyze", json={"file_path": str(FIXTURE)})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    deadline = time.time() + 120
    record = None
    while time.time() < deadline:
        record = client.get(f"/analyze/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(1)

    assert record is not None
    assert record["status"] == JobStatus.DONE.value, record.get("error")
    stems = {t["sourceStem"]: t["audioFilePath"] for t in record["result"]["song"]["tracks"]}
    assert set(stems.keys()) == {"vocals", "drums", "bass", "guitar", "piano", "other"}
    for path in stems.values():
        assert Path(path).exists()
