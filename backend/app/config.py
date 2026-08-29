"""Relay configuration.

Every secret comes from the environment. Nothing sensitive has a usable
default — `RUKO_RELAY_SECRET` deliberately fails closed outside development so
a misconfigured deployment cannot quietly sign tokens with a known key.
"""

from __future__ import annotations

import os
import secrets
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_PLACEHOLDER = "change-me-in-every-environment"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RUKO_",
        env_file=".env",
        extra="ignore",
    )

    relay_secret: str = Field(default="", description="HMAC key for device/guardian tokens.")
    allowed_origins: str = Field(default="http://localhost:3000")
    pairing_ttl_minutes: int = Field(default=10, ge=1, le=60)
    allow_insecure_transport: bool = Field(default=True)
    model_manifest_path: str = Field(
        default="model_manifest.json",
        description="Where ml/ publishes model metadata. Absent means no published model.",
    )

    # Bounds. The relay is a routing surface, not a database — these keep a
    # misbehaving or hostile client from turning it into one.
    max_sessions: int = Field(default=200, ge=1)
    max_message_bytes: int = Field(default=64 * 1024, ge=1024)
    max_incidents_per_session: int = Field(default=50, ge=1)

    # ---------------------------------------------------------------- #
    # Upstream API keys.
    #
    # These exist ONLY as Render environment variables. They are never in
    # the repo and never in the APK — an APK is a zip file, and anyone who
    # downloads it can read a bundled key in about a minute. That is the
    # whole reason this proxy exists: the phone authenticates as a user,
    # and the server holds the vendor credentials.
    # ---------------------------------------------------------------- #
    sarvam_api_key: str = Field(default="", description="Sarvam Saarika ASR. Render env only.")
    anthropic_api_key: str = Field(default="", description="Claude. Render env only.")

    # Supabase JWT verification. The project's JWT secret (HS256) is used to
    # verify the access token the app already holds after Google sign-in.
    supabase_jwt_secret: str = Field(default="", description="Supabase JWT secret. Render env only.")
    supabase_project_url: str = Field(default="")
    # Supabase issues `aud: "authenticated"` for a signed-in user. Anonymous
    # and service tokens carry a different audience and must be rejected.
    supabase_expected_audience: str = Field(default="authenticated")

    # Upstream limits. /explain calls a paid model, so it is capped hard.
    max_audio_bytes: int = Field(default=8 * 1024 * 1024, ge=1024)
    explain_timeout_seconds: float = Field(default=20.0, gt=0)
    transcribe_timeout_seconds: float = Field(default=45.0, gt=0)
    heartbeat_interval_seconds: int = Field(default=15, ge=5)

    @field_validator("relay_secret")
    @classmethod
    def _reject_placeholder(cls, value: str) -> str:
        if value == _DEV_PLACEHOLDER:
            raise ValueError(
                "RUKO_RELAY_SECRET is still the placeholder from .env.example. "
                "Generate one: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return value

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.relay_secret:
        # A generated per-process secret is fine for local dev and tests: it
        # invalidates every token on restart, which is the safe direction to
        # fail. Production must set the variable explicitly.
        if os.getenv("RUKO_ENV", "development") == "production":
            raise RuntimeError("RUKO_RELAY_SECRET must be set in production")
        settings = settings.model_copy(update={"relay_secret": secrets.token_urlsafe(48)})
    return settings
