"""Ruko relay — FastAPI application factory.

Thin by design (build prompt §29). It pairs devices, relays two message types,
and gets out of the way. No inference, no risk scoring, no evidence storage.

If this process dies, every phone keeps protecting its user; only the Guardian
escalation path goes offline.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import proxy, rest, ws
from app.config import get_settings
from app.core.sessions import SessionRegistry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app() -> FastAPI:
    config = get_settings()

    app = FastAPI(
        title="Ruko Relay",
        version="1.0.0",
        description=(
            "Relays critical payment alerts between a Ruko phone and a trusted "
            "person's Guardian console. Holds no evidence and makes no decisions."
        ),
    )

    app.state.registry = SessionRegistry(
        pairing_ttl_seconds=config.pairing_ttl_minutes * 60,
        max_sessions=config.max_sessions,
        max_incidents_per_session=config.max_incidents_per_session,
    )

    # Explicit origins only. `allow_credentials` with a wildcard is rejected by
    # browsers anyway, and the Guardian console is a known origin.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(rest.router, tags=["relay"])
    app.include_router(ws.router, tags=["guardian"])
    app.include_router(proxy.router)

    @app.get("/health", tags=["ops"])
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "protocolVersion": "1.0.0",
            "sessions": len(app.state.registry._sessions),  # noqa: SLF001 - ops visibility
        }

    return app


app = create_app()
