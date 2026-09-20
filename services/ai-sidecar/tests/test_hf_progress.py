import sys
import tempfile

from huggingface_hub import hf_hub_download

from app.pipeline.hf_progress import report_hf_download_progress

_tqdm_module = sys.modules["huggingface_hub.utils.tqdm"]


def test_reports_real_byte_progress_for_a_real_download():
    # A tiny, fast file from a public repo — real network round-trip
    # (this is what actually exposed the bug: huggingface_hub disables
    # its own tqdm bookkeeping outside a TTY, which every subprocess run
    # of this sidecar is, so a naive `self.n`-based implementation
    # silently reports nothing at all in production).
    events: list[tuple[int, int, float]] = []

    def on_event(downloaded: int, total: int, fraction: float) -> None:
        events.append((downloaded, total, fraction))

    with tempfile.TemporaryDirectory() as tmp, report_hf_download_progress(on_event):
        hf_hub_download("adefossez/HTDemucs", "htdemucs.yaml", cache_dir=tmp, force_download=True)

    assert events, "expected at least one real progress event"
    final_downloaded, final_total, final_fraction = events[-1]
    assert final_total > 0
    assert final_downloaded == final_total
    assert final_fraction == 1.0


def test_restores_the_original_tqdm_class_after_the_context_exits():
    original = _tqdm_module.tqdm
    with report_hf_download_progress(lambda *_: None):
        assert _tqdm_module.tqdm is not original
    assert _tqdm_module.tqdm is original


def test_restores_the_original_tqdm_class_even_if_the_body_raises():
    original = _tqdm_module.tqdm
    try:
        with report_hf_download_progress(lambda *_: None):
            raise ValueError("boom")
    except ValueError:
        pass
    assert _tqdm_module.tqdm is original
