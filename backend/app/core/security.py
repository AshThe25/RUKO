"""Token minting and verification for the relay.

Tokens are opaque to clients and stateless to the server: an HMAC-SHA256 tag
over a compact payload. There is no session lookup on the hot path and nothing
sensitive inside the token — just a role, a subject and an issue time.

Nothing here is a general-purpose JWT. Keeping it small keeps the attack
surface small, and the relay has exactly two token audiences.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass

_SEPARATOR = "."
_ROLE_PHONE = "PHONE"
_ROLE_GUARDIAN = "GUARDIAN"


class TokenError(Exception):
    """Raised for any malformed, mis-signed or expired token."""


@dataclass(frozen=True, slots=True)
class TokenClaims:
    role: str
    subject: str
    issued_at: int


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def mint_token(secret: str, role: str, subject: str) -> str:
    """Issue a token binding `role` to `subject` (a device id or session id)."""
    if role not in (_ROLE_PHONE, _ROLE_GUARDIAN):
        raise ValueError(f"unknown role {role!r}")
    if _SEPARATOR in subject:
        raise ValueError("subject must not contain the separator")

    body = f"{role}:{subject}:{int(time.time())}"
    encoded = _b64(body.encode("utf-8"))
    tag = _sign(secret, encoded)
    return f"{encoded}{_SEPARATOR}{tag}"


def verify_token(secret: str, token: str, expected_role: str) -> TokenClaims:
    """Verify a token's signature and role.

    Raises:
        TokenError: on any failure. The message is deliberately vague — the
            client learns that the token is unusable, not why, so a probing
            client cannot distinguish a bad signature from a bad role.
    """
    try:
        encoded, tag = token.split(_SEPARATOR)
    except (ValueError, AttributeError) as exc:
        raise TokenError("malformed token") from exc

    expected_tag = _sign(secret, encoded)
    # Constant time: never leak signature bytes through timing.
    if not hmac.compare_digest(tag, expected_tag):
        raise TokenError("invalid token")

    try:
        role, subject, issued_at = _unb64(encoded).decode("utf-8").split(":")
    except (ValueError, UnicodeDecodeError) as exc:
        raise TokenError("malformed token") from exc

    if not hmac.compare_digest(role, expected_role):
        raise TokenError("invalid token")

    return TokenClaims(role=role, subject=subject, issued_at=int(issued_at))


def _sign(secret: str, encoded: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return _b64(digest)


def new_pairing_code() -> str:
    """A six-digit code, uniformly random.

    `secrets.randbelow` rather than `random`: this is the only secret standing
    between a stranger and a live risk alert during the pairing window.
    """
    return f"{secrets.randbelow(1_000_000):06d}"


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


ROLE_PHONE = _ROLE_PHONE
ROLE_GUARDIAN = _ROLE_GUARDIAN
