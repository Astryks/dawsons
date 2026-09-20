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


def test_analyze_of_a_corrupt_file_fails_cleanly_not_a_crash(tmp_path):
    # The file exists (so it passes the upfront existence check) but isn't
    # valid audio — this must surface as a FAILED job with a real error
    # message, not hang forever or kill the sidecar process.
    garbage = tmp_path / "not-actually-audio.wav"
    garbage.write_bytes(b"\xde\xad\xbe\xef\x00\x01\x02\x03" * 16)

    response = client.post("/analyze", json={"file_path": str(garbage)})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    deadline = time.time() + 30
    record = None
    while time.time() < deadline:
        record = client.get(f"/analyze/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(0.5)

    assert record is not None
    assert record["status"] == JobStatus.FAILED.value
    assert record["error"]  # a real message, not empty/null


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
