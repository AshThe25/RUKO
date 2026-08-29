"""In-memory session registry.

Deliberately not a database. A session exists only while a phone and a
Guardian are talking about a live payment; when the process restarts, every
session is gone and every phone re-pairs. That is the correct behaviour for a
relay that is supposed to hold nothing.

What is kept, and why:
  - the pairing code, until it is claimed or expires
  - which two sockets belong to a session, so frames can be routed
  - which incidents have already had a Guardian action, so a second one is
    rejected rather than racing the first

What is never kept: evidence, transcripts, payee identifiers, or any history
after the session ends.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.core.security import new_id, new_pairing_code


class Connection(Protocol):
    """Just enough of a WebSocket for the registry to route to it."""

    async def send_json(self, data: Any) -> None: ...


class PairingError(Exception):
    """Raised when a pairing code is wrong, expired or already used."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(slots=True)
class Incident:
    incident_id: str
    #: Set once a Guardian has acted. The presence of a value is what makes a
    #: second action impossible.
    action: str | None = None
    acted_by: str | None = None


@dataclass(slots=True)
class Session:
    session_id: str
    device_id: str
    phone_display_name: str
    pairing_code: str | None
    pairing_expires_at: float
    created_at: float
    guardian_display_name: str | None = None
    phone: Connection | None = None
    guardian: Connection | None = None
    incidents: dict[str, Incident] = field(default_factory=dict)

    @property
    def phone_connected(self) -> bool:
        return self.phone is not None

    @property
    def guardian_connected(self) -> bool:
        return self.guardian is not None

    def presence(self) -> dict[str, Any]:
        return {
            "phoneConnected": self.phone_connected,
            "guardianConnected": self.guardian_connected,
            "phoneDisplayName": self.phone_display_name,
            "guardianDisplayName": self.guardian_display_name,
        }


class SessionRegistry:
    def __init__(
        self,
        *,
        pairing_ttl_seconds: int,
        max_sessions: int,
        max_incidents_per_session: int,
    ) -> None:
        self._sessions: dict[str, Session] = {}
        self._by_code: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._pairing_ttl = pairing_ttl_seconds
        self._max_sessions = max_sessions
        self._max_incidents = max_incidents_per_session

    # -- lifecycle ---------------------------------------------------------

    async def create_session(self, device_id: str, phone_display_name: str) -> Session:
        async with self._lock:
            self._expire_locked()
            if len(self._sessions) >= self._max_sessions:
                raise PairingError("SESSION_FULL", "relay is at capacity")

            # A phone asking for a new code invalidates its previous one, so a
            # code read aloud and then abandoned cannot be claimed later.
            for existing in [s for s in self._sessions.values() if s.device_id == device_id]:
                self._forget_code_locked(existing)

            code = self._unique_code_locked()
            session = Session(
                session_id=new_id("rk"),
                device_id=device_id,
                phone_display_name=phone_display_name,
                pairing_code=code,
                pairing_expires_at=time.time() + self._pairing_ttl,
                created_at=time.time(),
            )
            self._sessions[session.session_id] = session
            self._by_code[code] = session.session_id
            return session

    async def claim(self, pairing_code: str, guardian_display_name: str) -> Session:
        async with self._lock:
            self._expire_locked()
            session_id = self._by_code.get(pairing_code)
            if session_id is None:
                # Same error for "wrong" and "expired" so the endpoint cannot be
                # used to distinguish a live code from a dead one.
                raise PairingError("PAIRING_FAILED", "pairing code is not valid")

            session = self._sessions[session_id]
            session.guardian_display_name = guardian_display_name
            # Single use: burn the code the moment it is redeemed.
            self._forget_code_locked(session)
            return session

    async def get(self, session_id: str) -> Session | None:
        async with self._lock:
            self._expire_locked()
            return self._sessions.get(session_id)

    async def drop(self, session_id: str) -> None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                self._forget_code_locked(session)

    # -- connections -------------------------------------------------------

    async def attach(self, session_id: str, role: str, connection: Connection) -> Session:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise PairingError("PAIRING_FAILED", "unknown session")

            current = session.phone if role == "PHONE" else session.guardian
            if current is not None:
                raise PairingError("SESSION_FULL", f"a {role.lower()} is already connected")

            if role == "PHONE":
                session.phone = connection
            else:
                session.guardian = connection
            return session

    async def detach(self, session_id: str, role: str, connection: Connection) -> Session | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            # Only clear the slot if it still holds *this* socket; a reconnect
            # that raced a slow disconnect must not evict the new connection.
            if role == "PHONE" and session.phone is connection:
                session.phone = None
            elif role == "GUARDIAN" and session.guardian is connection:
                session.guardian = None
                session.guardian_display_name = None
            return session

    # -- incidents ---------------------------------------------------------

    async def record_incident(self, session_id: str, incident_id: str) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise PairingError("PAIRING_FAILED", "unknown session")
            if incident_id in session.incidents:
                return
            if len(session.incidents) >= self._max_incidents:
                # Drop the oldest rather than refuse the newest: the most recent
                # alert is the one the user is standing in front of.
                oldest = next(iter(session.incidents))
                del session.incidents[oldest]
            session.incidents[incident_id] = Incident(incident_id=incident_id)

    async def claim_incident_action(
        self, session_id: str, incident_id: str, action: str, acted_by: str
    ) -> Incident:
        """Atomically record a Guardian's decision.

        Raises:
            PairingError: `UNKNOWN_INCIDENT` if the phone never raised it, or
                `ACTION_ALREADY_TAKEN` if a decision is already recorded.
        """
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise PairingError("PAIRING_FAILED", "unknown session")

            incident = session.incidents.get(incident_id)
            if incident is None:
                raise PairingError("UNKNOWN_INCIDENT", "no such incident in this session")
            if incident.action is not None:
                raise PairingError("ACTION_ALREADY_TAKEN", "this incident was already decided")

            incident.action = action
            incident.acted_by = acted_by
            return incident

    # -- internals ---------------------------------------------------------

    def _unique_code_locked(self) -> str:
        for _ in range(50):
            code = new_pairing_code()
            if code not in self._by_code:
                return code
        raise PairingError("SESSION_FULL", "could not allocate a pairing code")

    def _forget_code_locked(self, session: Session) -> None:
        if session.pairing_code is not None:
            self._by_code.pop(session.pairing_code, None)
            session.pairing_code = None

    def _expire_locked(self) -> None:
        now = time.time()
        for code, session_id in list(self._by_code.items()):
            session = self._sessions.get(session_id)
            if session is None or session.pairing_expires_at < now:
                self._by_code.pop(code, None)
                if session is not None:
                    session.pairing_code = None

        # An unclaimed, disconnected session is garbage once its code is dead.
        for session_id, session in list(self._sessions.items()):
            stale = (
                session.pairing_code is None
                and not session.phone_connected
                and not session.guardian_connected
                and session.guardian_display_name is None
                and now - session.created_at > self._pairing_ttl
            )
            if stale:
                del self._sessions[session_id]
