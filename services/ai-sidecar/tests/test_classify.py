import time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.jobs.models import JobStatus
from app.main import app
from app.pipeline import classify

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "tiny-tone.wav"


def _write_tone(path: Path, amplitude: float, sample_rate: int = 44100, seconds: float = 0.2) -> None:
    t = np.linspace(0, seconds, int(sample_rate * seconds), endpoint=False)
    tone = (amplitude * np.sin(2 * np.pi * 220 * t)).astype("float32")
    sf.write(path, tone, sample_rate)


def test_classify_missing_file_returns_400():
    response = client.post("/classify", json={"file_path": "/nonexistent/file.wav"})
    assert response.status_code == 400


def test_classify_missing_job_returns_404():
    response = client.get("/classify/nonexistent-job-id")
    assert response.status_code == 404


def test_classify_picks_the_dominant_stem(tmp_path, monkeypatch):
    stem_dir = tmp_path / "stems"
    stem_dir.mkdir()
    loud = stem_dir / "guitar.wav"
    quiet_paths = {}
    _write_tone(loud, amplitude=0.9)
    for name in ("vocals", "drums", "bass", "piano", "other"):
        p = stem_dir / f"{name}.wav"
        _write_tone(p, amplitude=0.01)
        quiet_paths[name] = p

    def fake_separate(input_path, out_dir, device="cpu"):
        return {"guitar": loud, **quiet_paths}

    monkeypatch.setattr(classify, "separate", fake_separate)

    result = classify.classify_clip(Path("unused.wav"), tmp_path / "out")
    assert result["suggested_layer"] == "guitar"
    assert result["new_layer"] is False
    assert result["confidence"] > 0.45


def test_classify_suggests_new_layer_when_energy_is_spread_out(tmp_path, monkeypatch):
    stem_dir = tmp_path / "stems"
    stem_dir.mkdir()
    paths = {}
    for name in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        p = stem_dir / f"{name}.wav"
        _write_tone(p, amplitude=0.3)
        paths[name] = p

    monkeypatch.setattr(classify, "separate", lambda input_path, out_dir, device="cpu": paths)

    result = classify.classify_clip(Path("unused.wav"), tmp_path / "out")
    assert result["new_layer"] is True
    assert result["suggested_layer"] is None


def test_classify_suggests_new_layer_when_other_dominates(tmp_path, monkeypatch):
    stem_dir = tmp_path / "stems"
    stem_dir.mkdir()
    loud = stem_dir / "other.wav"
    quiet_paths = {}
    _write_tone(loud, amplitude=0.9)
    for name in ("vocals", "drums", "bass", "guitar", "piano"):
        p = stem_dir / f"{name}.wav"
        _write_tone(p, amplitude=0.01)
        quiet_paths[name] = p

    monkeypatch.setattr(
        classify, "separate", lambda input_path, out_dir, device="cpu": {"other": loud, **quiet_paths}
    )

    result = classify.classify_clip(Path("unused.wav"), tmp_path / "out")
    assert result["new_layer"] is True
    assert result["suggested_layer"] is None


def test_classify_runs_end_to_end_on_a_real_file():
    response = client.post("/classify", json={"file_path": str(FIXTURE)})
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    deadline = time.time() + 120
    record = None
    while time.time() < deadline:
        record = client.get(f"/classify/{job_id}").json()
        if record["status"] in (JobStatus.DONE.value, JobStatus.FAILED.value):
            break
        time.sleep(1)

    assert record is not None
    assert record["status"] == JobStatus.DONE.value, record.get("error")
    result = record["result"]
    assert set(result["energies"].keys()) == {"vocals", "drums", "bass", "guitar", "piano", "other"}
    assert isinstance(result["new_layer"], bool)
