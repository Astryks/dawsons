"""Real byte-level progress for Hugging Face Hub downloads.

Demucs resolves its pretrained weights from the Hugging Face Hub on first
use and manages its own cache — no custom download/verification logic is
needed for that (see stems.py). The one real gap is that this first-run
download is currently silent: `separating_stems` just sits at 0% for
however long it takes, then jumps straight to actual separation, which
reads as a hang rather than a download in progress.

`huggingface_hub` doesn't expose a public progress-callback parameter, so
the only way to observe real transfer progress is to intercept its
internal tqdm progress bars. That interception has one sharp edge, found
by testing directly against a real download rather than assuming it would
work: `huggingface_hub.utils.tqdm.tqdm.update()` is a no-op when the bar
is disabled, and it IS disabled whenever stdout isn't a TTY — which is
always true here, since this sidecar runs as a spawned child process with
piped stdout. `update(n)` is still called with the real byte count in
that case; only tqdm's own internal bookkeeping/rendering is skipped. So
progress must be tracked independently in the override rather than read
back from `self.n`.
"""

from __future__ import annotations

import contextlib
import sys
from collections.abc import Callable, Iterator

# Force real import of the submodule (not the class of the same name that
# huggingface_hub.utils re-exports at package level, which would shadow a
# plain `huggingface_hub.utils.tqdm` attribute lookup) and pull the actual
# module out of sys.modules to patch it in place.
from huggingface_hub.utils.tqdm import tqdm as _hf_tqdm_class  # noqa: F401

_tqdm_module = sys.modules["huggingface_hub.utils.tqdm"]

ProgressCallback = Callable[[int, int, float], None]


def _make_reporting_tqdm(callback: ProgressCallback) -> type:
    base = _tqdm_module.tqdm

    class _ReportingTqdm(base):  # type: ignore[misc, valid-type]
        def update(self, n: int = 1) -> None:
            reported = getattr(self, "_reported_n", 0) + n
            self._reported_n = reported
            total = self.total or 0
            fraction = (reported / total) if total else 0.0
            callback(reported, total, fraction)
            return super().update(n)

    return _ReportingTqdm


@contextlib.contextmanager
def report_hf_download_progress(callback: ProgressCallback) -> Iterator[None]:
    """While active, every Hugging Face Hub download's real transfer
    progress is reported to `callback(downloaded_bytes, total_bytes,
    fraction)` — including downloads triggered indirectly, e.g. through
    `demucs.api.Separator(...)`.
    """
    # mypy can't see through the sys.modules lookup that `_tqdm_module`
    # is the real tqdm submodule (not the class of the same name
    # re-exported at the package level) — see the comment above.
    original = _tqdm_module.tqdm  # type: ignore[attr-defined]
    _tqdm_module.tqdm = _make_reporting_tqdm(callback)  # type: ignore[attr-defined]
    try:
        yield
    finally:
        _tqdm_module.tqdm = original  # type: ignore[attr-defined]
