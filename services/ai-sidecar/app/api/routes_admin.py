"""POST /shutdown — graceful shutdown, called by the Rust parent on app quit.

Rust waits a few seconds after calling this before force-killing the child
process, so this handler should return quickly and let uvicorn finish
in-flight requests rather than blocking here.
"""

import asyncio
import os
import signal

from fastapi import APIRouter

router = APIRouter()


@router.post("/shutdown")
async def shutdown() -> dict:
    async def _terminate():
        await asyncio.sleep(0.1)
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.create_task(_terminate())
    return {"status": "shutting_down"}
