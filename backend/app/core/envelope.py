"""Outbound envelope construction.

One place that stamps `protocolVersion`, `messageId` and `sentAt`, so no route
can accidentally emit a frame the clients will reject.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.security import new_id
from app.models.contracts import PROTOCOL_VERSION


def envelope(message_type: str, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "type": message_type,
        "messageId": new_id("msg"),
        "sessionId": session_id,
        "sentAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "payload": payload,
    }


def error(session_id: str, code: str, message: str, *, recoverable: bool) -> dict[str, Any]:
    return envelope(
        "ERROR",
        session_id,
        {"code": code, "message": message, "recoverable": recoverable},
    )
