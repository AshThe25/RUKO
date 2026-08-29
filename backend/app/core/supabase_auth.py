"""Supabase JWT verification.

The phone signs in with Google through Supabase and already holds an access
token. This proxy re-verifies that token on every request rather than trusting
the caller, because the endpoints behind it spend real money on Sarvam and
Anthropic.

Anonymous callers are rejected outright. Supabase issues `aud: "authenticated"`
for a signed-in user; anonymous and service-role tokens carry a different
audience, so the audience check is what actually enforces "no anonymous
callers" — an expired-signature check alone would not.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

_UNAUTHENTICATED = {"WWW-Authenticate": "Bearer"}


@dataclass(frozen=True, slots=True)
class SupabaseUser:
    """The verified caller. `user_id` is the Supabase `sub` claim."""

    user_id: str
    email: str | None
    role: str


def _reject(detail: str) -> HTTPException:
    # One message for every failure mode. A caller learns the token is
    # unusable, not which check it failed, so this cannot be used to probe
    # the verification logic.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers=_UNAUTHENTICATED,
    )


def verify_supabase_jwt(
    authorization: str | None = Header(default=None),
    config: Settings = Depends(get_settings),
) -> SupabaseUser:
    """Resolve the signed-in user from a `Bearer <supabase access token>`."""
    if not config.supabase_jwt_secret:
        # Fail closed. A proxy that spends money must never fall open just
        # because it was deployed without its verification secret.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="authentication is not configured on this server",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise _reject("missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _reject("missing bearer token")

    try:
        claims = jwt.decode(
            token,
            config.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=config.supabase_expected_audience,
            options={"require": ["sub", "exp", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise _reject("invalid or expired token") from exc

    role = claims.get("role", "")
    # Belt and braces alongside the audience check: Supabase marks anonymous
    # sessions with role "anon", and those must never reach a paid upstream.
    if role == "anon" or not claims.get("sub"):
        raise _reject("anonymous callers are not permitted")

    return SupabaseUser(
        user_id=str(claims["sub"]),
        email=claims.get("email"),
        role=str(role or "authenticated"),
    )
