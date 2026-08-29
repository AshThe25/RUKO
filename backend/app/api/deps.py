"""Shared dependencies: settings, the registry, and phone authentication."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request, status

from app.config import Settings, get_settings
from app.core.security import ROLE_PHONE, TokenError, verify_token
from app.core.sessions import SessionRegistry


def registry(request: Request) -> SessionRegistry:
    return request.app.state.registry


def settings() -> Settings:
    return get_settings()


def authenticated_device(
    authorization: str | None = Header(default=None),
    config: Settings = Depends(settings),
) -> str:
    """Resolve the device id from a `Bearer <deviceToken>` header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = verify_token(config.relay_secret, token, ROLE_PHONE)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return claims.subject
