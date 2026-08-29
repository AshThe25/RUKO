"""Verification of the Supabase access token the client already holds.

The phone and the Guardian console both sign in to Supabase and get a JWT. That
is the only identity in this system, so the proxy verifies *that* token rather
than inventing a second scheme with its own enrolment, rotation and revocation
problems to get wrong.

Two signing schemes are supported because Supabase projects come in both shapes:

  - asymmetric (ES256/RS256), verified against the project's published JWKS.
    This is the default for current projects and needs no shared secret here.
  - symmetric (HS256), verified with the project's JWT secret, when
    `RUKO_SUPABASE_JWT_SECRET` is configured.

Anonymous sessions are rejected explicitly. Supabase can mint tokens for
anonymous users, and `role` alone does not distinguish them — an anonymous user
still carries `role: authenticated` — so `is_anonymous` is checked as well.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from jwt import PyJWKClient


class AuthError(Exception):
    """Raised for any token that must not be trusted. Never says which part failed."""


@dataclass(frozen=True, slots=True)
class SupabaseUser:
    user_id: str
    email: str | None
    role: str


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> PyJWKClient:
    # PyJWKClient caches the key set and refetches on an unknown kid, which is
    # what makes key rotation a non-event here.
    return PyJWKClient(jwks_url, cache_keys=True)


def verify_supabase_jwt(
    token: str,
    *,
    supabase_url: str,
    jwt_secret: str | None = None,
    audience: str = "authenticated",
) -> SupabaseUser:
    """Verify a Supabase access token and return who it belongs to.

    Raises `AuthError` for anything that is not a live, non-anonymous session.
    """
    if not token or token.count(".") != 2:
        raise AuthError("malformed token")

    try:
        if jwt_secret:
            claims = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                audience=audience,
                options={"require": ["exp", "sub"]},
            )
        else:
            if not supabase_url:
                raise AuthError("no verification material configured")
            jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            signing_key = _jwk_client(jwks_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience=audience,
                options={"require": ["exp", "sub"]},
            )
    except AuthError:
        raise
    except Exception as exc:  # jwt raises a family of these; none are safe to leak
        raise AuthError("token rejected") from exc

    subject = claims.get("sub")
    if not subject:
        raise AuthError("token has no subject")

    # An anonymous Supabase user is still `role: authenticated`, so this flag is
    # the only thing separating "someone signed in" from "anyone at all".
    if claims.get("is_anonymous") is True:
        raise AuthError("anonymous sessions are not accepted")

    role = claims.get("role")
    if role != "authenticated":
        raise AuthError("token is not an authenticated session")

    return SupabaseUser(user_id=str(subject), email=claims.get("email"), role=str(role))
