import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import routes_generate
from app.jobs.models import JobStatus
from app.main import app

client = TestClient(app)


def test_generate_rejects_an_empty_prompt():
    response = client.post("/generate", json={"prompt": "   ", "duration_sec": 10.0})
    assert response.status_code == 400


def test_generate_rejects_an_out_of_range_duration():
    response = client.post("/generate", json={"prompt": "a mellow piano loop", "duration_sec": 1000.0})
    assert response.status_code == 400


def test_generate_missing_job_returns_404():
    response = client.get("/generate/nonexistent-job-id")
    assert response.status_code == 404


def test_generate_job_runs_through_to_done(tmp_path, monkeypatch):
    fake_output = tmp_path / "generated.wav"
    fake_output.write_bytes(b"RIFF....WAVEfmt ")  # contents irrelevant to this test

    def fake_generate(prompt, duration_sec, out_dir, device="cpu"):
        assert prompt == "a mellow piano loop"
        assert duration_sec == 12.0
        return fake_output

    monkeypatch.setattr(routes_generate, "generate", fake_generate)

    response = client.post("/generate", json={"prompt": "a mellow piano loop", "duration_sec": 12.0})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    deadline = time.time() + 10
    record = None
    while time.time() < deadline:
        record = client.get(f"/generate/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(0.1)

    assert record is not None
    assert record["status"] == JobStatus.DONE.value, record.get("error")
    assert record["result"]["audio_file_path"] == str(fake_output)


def test_generate_job_reports_failure(monkeypatch):
    def failing_generate(prompt, duration_sec, out_dir, device="cpu"):
        raise RuntimeError("out of memory")

    monkeypatch.setattr(routes_generate, "generate", failing_generate)

    response = client.post("/generate", json={"prompt": "anything", "duration_sec": 5.0})
    job_id = response.json()["job_id"]

    deadline = time.time() + 10
    record = None
    while time.time() < deadline:
        record = client.get(f"/generate/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(0.1)

    assert record["status"] == JobStatus.FAILED.value
    assert "out of memory" in record["error"]


def _model_downloaded() -> bool:
    return (Path.home() / ".cache" / "ace-step" / "checkpoints").exists()


@pytest.mark.skipif(not _model_downloaded(), reason="ACE-Step weights not downloaded in this environment")
def test_generate_runs_end_to_end_on_a_real_short_clip():
    """Not run in CI (an ~8GB model download is infeasible there) — real
    confidence locally, where the weights actually are, the same pattern
    as the SoundFont-gated Rust synth tests."""
    response = client.post("/generate", json={"prompt": "a short calm ambient pad", "duration_sec": 6.0})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    deadline = time.time() + 600
    record = None
    while time.time() < deadline:
        record = client.get(f"/generate/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(2)

    assert record is not None
    assert record["status"] == JobStatus.DONE.value, record.get("error")
    audio_path = Path(record["result"]["audio_file_path"])
    assert audio_path.exists()
    assert audio_path.stat().st_size > 0
