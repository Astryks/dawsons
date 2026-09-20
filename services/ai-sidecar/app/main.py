"""FastAPI entrypoint for the Dawsons AI sidecar.

Startup handshake with the Rust parent process: uvicorn binds to an
OS-assigned port (127.0.0.1:0), and this module prints a single JSON line to
stdout once the port is known, e.g. {"status": "ready", "port": 54231}.
The Rust side reads that line, then polls GET /health until it responds.
"""

import json
import sys

from fastapi import FastAPI

from app.api import (
    routes_admin,
    routes_analyze,
    routes_classify,
    routes_generate,
    routes_health,
    routes_pitch,
)

app = FastAPI(title="dawsons-ai-sidecar")

app.include_router(routes_health.router)
app.include_router(routes_analyze.router)
app.include_router(routes_classify.router)
app.include_router(routes_generate.router)
app.include_router(routes_pitch.router)
app.include_router(routes_admin.router)


def announce_ready(port: int) -> None:
    print(json.dumps({"status": "ready", "port": port}), flush=True)


if __name__ == "__main__":
    import socket

    import uvicorn

    # Bind an ephemeral port ourselves so we can report the real port before
    # handing the socket to uvicorn (uvicorn doesn't otherwise surface it).
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    announce_ready(port)

    uvicorn.run(app, fd=sock.fileno(), log_level="info")
    sys.exit(0)
