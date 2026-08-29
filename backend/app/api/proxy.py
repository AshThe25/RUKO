"""The API-key proxy.

Why this exists: an APK is a zip file. `apktool d app.apk` recovers embedded
strings in about a minute, so any vendor key shipped inside the app is a public
key with extra steps. The phone therefore holds no Sarvam or Anthropic key and
calls these two endpoints instead, presenting the Supabase access token it
already has from signing in. The keys live only in this process's environment.

What this is not: an authentication system. There is no enrolment, no key
issuing and no session of its own here. Identity is the Supabase JWT, verified
against the project's own signing keys — one identity for the whole product.

Nothing is persisted. Audio is streamed to the vendor and dropped; transcripts
are returned to the caller and never written down.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import settings
from app.config import Settings
from app.core.supabase_auth import AuthError, SupabaseUser, verify_supabase_jwt

logger = logging.getLogger(__name__)
router = APIRouter()

SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


def current_user(
    authorization: str | None = Header(default=None),
    config: Settings = Depends(settings),
) -> SupabaseUser:
    """The signed-in Supabase user, or 401. Anonymous sessions are refused."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return verify_supabase_jwt(
            token,
            supabase_url=config.supabase_url,
            jwt_secret=config.supabase_jwt_secret or None,
        )
    except AuthError as exc:
        # Deliberately uniform: never tell a caller which check failed.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


class TranscribeResponse(BaseModel):
    text: str
    language_code: str | None = None


class ExplainRequest(BaseModel):
    """The facts of an alert. Deliberately not the conversation.

    `extra="forbid"` is the enforcement: a client that tries to send a
    transcript, a message body or raw audio gets a 422 rather than having it
    quietly forwarded to a model vendor. Ruko's promise is that what was said
    stays on the device, and an explanation is generated from the *reasons* the
    on-device engine already produced.
    """

    model_config = ConfigDict(extra="forbid")

    alert_id: str = Field(min_length=1, max_length=128)
    band: str = Field(min_length=1, max_length=16)
    score: float | None = None
    reasons: list[str] = Field(default_factory=list)
    amount_minor: int | None = None
    payee_label: str | None = Field(default=None, max_length=200)
    kind: str | None = Field(default=None, max_length=32)


class ExplainResponse(BaseModel):
    alert_id: str
    explanation: str
    #: True when this was served from the idempotency cache, i.e. no second
    #: completion was bought for this alert.
    cached: bool


@router.post("/transcribe", response_model=TranscribeResponse, tags=["proxy"])
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    language_code: str = Form(default="unknown"),
    model: str = Form(default="saarika:v2"),
    user: SupabaseUser = Depends(current_user),
    config: Settings = Depends(settings),
) -> TranscribeResponse:
    """Speech to text via Sarvam Saarika. The audio is not stored, here or anywhere."""
    if not config.sarvam_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="transcription is not configured on this deployment",
        )

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty audio")
    if len(audio) > config.max_audio_bytes:
        # A proxy, not a file host. Saarika takes utterances, not whole calls.
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"audio exceeds {config.max_audio_bytes} bytes",
        )

    try:
        async with httpx.AsyncClient(timeout=config.upstream_timeout_seconds) as client:
            response = await client.post(
                SARVAM_STT_URL,
                headers={"api-subscription-key": config.sarvam_api_key},
                files={"file": (file.filename or "audio.wav", audio, file.content_type or "audio/wav")},
                data={"model": model, "language_code": language_code},
            )
    except httpx.HTTPError as exc:
        logger.warning("sarvam unreachable: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="transcription upstream unavailable"
        ) from exc

    if response.status_code >= 400:
        # Surface that it failed and the upstream status, never the key or body.
        logger.warning("sarvam returned %s", response.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"transcription upstream returned {response.status_code}",
        )

    payload = response.json()
    return TranscribeResponse(
        text=str(payload.get("transcript") or payload.get("text") or ""),
        language_code=payload.get("language_code"),
    )


def _prompt(body: ExplainRequest) -> str:
    """Compose the explanation request from alert facts only."""
    rupees = "unknown amount" if body.amount_minor is None else f"₹{body.amount_minor / 100:,.0f}"
    reasons = ", ".join(body.reasons) if body.reasons else "no specific signals recorded"
    return (
        "You are helping a worried family member understand a fraud warning.\n\n"
        f"Alert kind: {body.kind or 'payment'}\n"
        f"Risk band: {body.band}\n"
        f"Score: {'unknown' if body.score is None else round(body.score)} out of 100\n"
        f"Amount: {rupees}\n"
        f"Payee: {body.payee_label or 'not recorded'}\n"
        f"Signals the on-device engine detected: {reasons}\n\n"
        "In at most three short sentences, plain English, no jargon: explain what this "
        "pattern usually means and what the person should do right now. Do not invent "
        "details you were not given. Do not speculate about what was said — you were not "
        "given the conversation and must not imply that you were."
    )


@router.post("/explain", response_model=ExplainResponse, tags=["proxy"])
async def explain(
    request: Request,
    body: ExplainRequest,
    user: SupabaseUser = Depends(current_user),
    config: Settings = Depends(settings),
) -> ExplainResponse:
    """Plain-language explanation of one alert. At most one completion per alert id."""
    if not config.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="explanation is not configured on this deployment",
        )

    cache = request.app.state.explain_cache
    cached = cache.get(body.alert_id)
    if cached is not None:
        return ExplainResponse(alert_id=body.alert_id, explanation=cached, cached=True)

    try:
        async with httpx.AsyncClient(timeout=config.upstream_timeout_seconds) as client:
            response = await client.post(
                ANTHROPIC_MESSAGES_URL,
                headers={
                    "x-api-key": config.anthropic_api_key,
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": config.anthropic_model,
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": _prompt(body)}],
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("anthropic unreachable: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="explanation upstream unavailable"
        ) from exc

    if response.status_code >= 400:
        logger.warning("anthropic returned %s", response.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"explanation upstream returned {response.status_code}",
        )

    payload = response.json()
    parts = payload.get("content") or []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="explanation upstream returned no text"
        )

    cache.set(body.alert_id, text)
    return ExplainResponse(alert_id=body.alert_id, explanation=text, cached=False)
