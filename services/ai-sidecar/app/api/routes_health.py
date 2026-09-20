from fastapi import APIRouter

from app.config import SIDECAR_VERSION

router = APIRouter()


def _detect_device() -> str:
    # M4 wires this to torch.cuda.is_available() / torch.backends.mps.is_available()
    # once torch is a dependency; Demucs inference time varies a lot by device,
    # so the UI wants to know this up front.
    return "cpu"


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": SIDECAR_VERSION, "device": _detect_device()}
