"""The Guardian relay socket: WS /guardian/{session_id}?token=...

Routing rules, all enforced here:

  - A connection proves its role with a token. The phone's token is bound to
    its device id, the Guardian's to this session.
  - Only a phone may originate `RISK_ALERT`; only a Guardian may originate
    `GUARDIAN_ACTION`. The `ORIGINATOR` map is the single source of truth.
  - A Guardian may act once per incident. The check and the write happen under
    one lock, so two rapid clicks cannot both win.
  - The relay never inspects evidence, never recomputes a score, and never
    rewrites a payload. It validates the shape and passes the frame on.

If the Guardian is absent, alerts are simply not delivered. That is not an
error: the phone has already paused the payment locally and stays protected
whether or not anyone is watching from a laptop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.config import get_settings
from app.core.envelope import envelope, error
from app.core.security import ROLE_GUARDIAN, ROLE_PHONE, TokenError, new_id, verify_token
from app.core.sessions import PairingError, Session, SessionRegistry
from app.models.contracts import (
    ORIGINATOR,
    GuardianActionPayload,
    InboundEnvelope,
    RiskAlertPayload,
)

logger = logging.getLogger("ruko.relay")
router = APIRouter()

# Close codes. 4401 mirrors HTTP 401 so clients can tell auth failure from a
# normal close and stop retrying with a dead token.
WS_UNAUTHORIZED = 4401
WS_SESSION_FULL = 4409


@router.websocket("/guardian/{session_id}")
async def guardian_socket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(default=""),
) -> None:
    config = get_settings()
    store: SessionRegistry = websocket.app.state.registry

    session = await store.get(session_id)
    if session is None:
        await websocket.close(code=WS_UNAUTHORIZED, reason="unknown session")
        return

    role = _authenticate(config.relay_secret, token, session)
    if role is None:
        await websocket.close(code=WS_UNAUTHORIZED, reason="invalid token")
        return

    await websocket.accept()

    try:
        session = await store.attach(session_id, role, websocket)
    except PairingError as exc:
        await websocket.close(code=WS_SESSION_FULL, reason=str(exc))
        return

    # PAIR_ACK already carries presence for the client that just joined, so it
    # is deliberately excluded from the broadcast. Sending both would leave a
    # duplicate frame queued that its peer has no way to distinguish from a
    # later, real presence change.
    await _send(websocket, envelope("PAIR_ACK", session_id, session.presence()))
    await _broadcast_presence(session, exclude=websocket)

    heartbeat = asyncio.create_task(_heartbeat(websocket, session_id, config.heartbeat_interval_seconds))
    try:
        await _receive_loop(websocket, store, session_id, role, config.max_message_bytes)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - a relay must not die with one bad peer
        logger.exception("relay loop failed for session %s role %s", session_id, role)
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat
        remaining = await store.detach(session_id, role, websocket)
        if remaining is not None:
            await _broadcast_presence(remaining)


# --------------------------------------------------------------------------- #
# Authentication                                                              #
# --------------------------------------------------------------------------- #


def _authenticate(secret: str, token: str, session: Session) -> str | None:
    """Return the proven role, or None.

    A phone token carries its device id, which must match the session's owner —
    so a valid token from a *different* phone cannot join this session. A
    Guardian token carries the session id, so it is useless anywhere else.
    """
    if not token:
        return None

    try:
        claims = verify_token(secret, token, ROLE_PHONE)
    except TokenError:
        pass
    else:
        return ROLE_PHONE if claims.subject == session.device_id else None

    try:
        claims = verify_token(secret, token, ROLE_GUARDIAN)
    except TokenError:
        return None
    return ROLE_GUARDIAN if claims.subject == session.session_id else None


# --------------------------------------------------------------------------- #
# Message loop                                                                #
# --------------------------------------------------------------------------- #


async def _receive_loop(
    websocket: WebSocket,
    store: SessionRegistry,
    session_id: str,
    role: str,
    max_bytes: int,
) -> None:
    while True:
        raw = await websocket.receive_text()

        if len(raw.encode("utf-8")) > max_bytes:
            await _send(
                websocket,
                error(session_id, "INVALID_MESSAGE", "frame exceeds size limit", recoverable=True),
            )
            continue

        try:
            inbound = InboundEnvelope.model_validate_json(raw)
        except ValidationError as exc:
            code = (
                "UNSUPPORTED_PROTOCOL"
                if "protocol version" in str(exc)
                else "INVALID_MESSAGE"
            )
            await _send(websocket, error(session_id, code, "frame rejected", recoverable=True))
            continue

        if inbound.session_id != session_id:
            await _send(
                websocket,
                error(session_id, "INVALID_MESSAGE", "session mismatch", recoverable=True),
            )
            continue

        if ORIGINATOR.get(inbound.type) != role:
            await _send(
                websocket,
                error(
                    session_id,
                    "ROLE_NOT_PERMITTED",
                    f"a {role.lower()} may not originate {inbound.type}",
                    recoverable=True,
                ),
            )
            continue

        session = await store.get(session_id)
        if session is None:
            await websocket.close(code=WS_UNAUTHORIZED, reason="session ended")
            return

        if inbound.type == "RISK_ALERT":
            await _handle_risk_alert(websocket, store, session, inbound)
        elif inbound.type == "GUARDIAN_ACTION":
            await _handle_guardian_action(websocket, store, session, inbound)
        elif inbound.type == "PONG":
            continue  # Liveness is proven by the frame arriving at all.


async def _handle_risk_alert(
    websocket: WebSocket,
    store: SessionRegistry,
    session: Session,
    inbound: InboundEnvelope,
) -> None:
    try:
        alert = RiskAlertPayload.model_validate(inbound.payload)
    except ValidationError:
        await _send(
            websocket,
            error(session.session_id, "INVALID_MESSAGE", "malformed risk alert", recoverable=True),
        )
        return

    await store.record_incident(session.session_id, alert.incident_id)

    if session.guardian is None:
        # Not an error. Tell the phone what it already suspects so its Guardian
        # tile reads OFFLINE, and let it carry on protecting on its own.
        await _send(websocket, envelope("PRESENCE", session.session_id, session.presence()))
        return

    # Forward the payload untouched — by alias, exactly as the phone sent it.
    await _send(
        session.guardian,
        envelope("RISK_ALERT", session.session_id, alert.model_dump(by_alias=True, mode="json")),
    )


async def _handle_guardian_action(
    websocket: WebSocket,
    store: SessionRegistry,
    session: Session,
    inbound: InboundEnvelope,
) -> None:
    try:
        action = GuardianActionPayload.model_validate(inbound.payload)
    except ValidationError:
        await _send(
            websocket,
            error(session.session_id, "INVALID_MESSAGE", "malformed action", recoverable=True),
        )
        return

    try:
        await store.claim_incident_action(
            session.session_id,
            action.incident_id,
            action.action,
            action.guardian_display_name,
        )
    except PairingError as exc:
        await _send(websocket, error(session.session_id, exc.code, str(exc), recoverable=False))
        await _send(
            websocket,
            envelope(
                "GUARDIAN_ACTION_ACK",
                session.session_id,
                {"incidentId": action.incident_id, "accepted": False, "reason": str(exc)},
            ),
        )
        return

    if session.phone is not None:
        await _send(
            session.phone,
            envelope(
                "GUARDIAN_ACTION",
                session.session_id,
                action.model_dump(by_alias=True, mode="json"),
            ),
        )

    await _send(
        websocket,
        envelope(
            "GUARDIAN_ACTION_ACK",
            session.session_id,
            {
                "incidentId": action.incident_id,
                # Accepted means the relay recorded and routed it. If the phone
                # is momentarily offline it will not have been delivered, and
                # the phone stays blocked by default — the safe direction.
                "accepted": True,
                "reason": None if session.phone is not None else "phone is offline",
            },
        ),
    )


# --------------------------------------------------------------------------- #
# Plumbing                                                                    #
# --------------------------------------------------------------------------- #


async def _heartbeat(websocket: WebSocket, session_id: str, interval: int) -> None:
    while True:
        await asyncio.sleep(interval)
        await _send(websocket, envelope("PING", session_id, {"nonce": new_id("n")}))


async def _broadcast_presence(session: Session, exclude: object | None = None) -> None:
    frame = envelope("PRESENCE", session.session_id, session.presence())
    for peer in (session.phone, session.guardian):
        if peer is not None and peer is not exclude:
            await _send(peer, frame)


async def _send(connection, frame: dict) -> None:
    """Send, tolerating a peer that has already gone away.

    A dead socket is a disconnect, not an exception worth unwinding the relay
    for; the detach path will notice and update presence.
    """
    try:
        await connection.send_json(frame)
    except Exception:  # noqa: BLE001
        logger.debug("dropped frame for a disconnected peer", exc_info=True)
