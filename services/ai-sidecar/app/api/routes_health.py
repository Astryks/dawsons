from fastapi import APIRouter

from app.config import SIDECAR_VERSION, detect_device

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": SIDECAR_VERSION, "device": detect_device()}
