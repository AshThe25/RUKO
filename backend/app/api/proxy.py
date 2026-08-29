"""API-key proxy: /transcribe and /explain.

WHY THIS EXISTS: an APK is a zip file. Anyone who downloads it can read a
bundled API key in about a minute, and then spend the team's Sarvam and
Anthropic budget. So the phone never holds a vendor key. It authenticates as a
Supabase user, and this server — which does hold the keys, only as Render
environment variables — makes the upstream call on its behalf.

WHAT THIS IS NOT: a place where risk is decided. Ruko's classifier and risk
engine run on the device and keep working with this server unreachable.
/transcribe is an optional accuracy upgrade over on-device ASR, and /explain
only ever rewrites an explanation of a decision the phone has already made.
Neither endpoint can change a risk score.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.core.supabase_auth import SupabaseUser, verify_supabase_jwt

logger = logging.getLogger("ruko.proxy")
router = APIRouter()

SARVAM_ASR_URL = "https://api.sarvam.ai/speech-to-text"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
EXPLAIN_MODEL = "claude-sonnet-4-6"


class TranscribeResponse(BaseModel):
    transcript: str
    language_code: str | None = None
    provider: str = "sarvam-saarika"


class ExplainRequest(BaseModel):
    """What the phone may send to have an intervention explained.

    Deliberately narrow. There is no free-text prompt field: the caller cannot
    steer the model, only supply the decision it must put into words. Anything
    unexpected is rejected rather than forwarded.
    """

    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=0, le=100)
    level: str = Field(pattern="^(LOW|MEDIUM|HIGH|CRITICAL)$")
    reasons: list[str] = Field(min_length=1, max_length=6)
    amount_minor: int | None = Field(default=None, ge=0, alias="amountMinor")
    payee_display_name: str | None = Field(default=None, max_length=64, alias="payeeDisplayName")
    language: str = Field(default="en-IN", pattern="^(en-IN|hi-IN)$")


class ExplainResponse(BaseModel):
    explanation: str
    provider: str = "anthropic"
    model: str = EXPLAIN_MODEL


@router.post("/transcribe", response_model=TranscribeResponse, tags=["proxy"])
async def transcribe(
    audio: UploadFile = File(...),
    language_code: str = Form(default="unknown"),
    user: SupabaseUser = Depends(verify_supabase_jwt),
    config: Settings = Depends(get_settings),
) -> TranscribeResponse:
    """Proxy an audio clip to Sarvam Saarika and return only the transcript."""
    if not config.sarvam_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "transcription is not configured")

    payload = await audio.read()
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty audio upload")
    if len(payload) > config.max_audio_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"audio exceeds {config.max_audio_bytes} bytes",
        )

    try:
        async with httpx.AsyncClient(timeout=config.transcribe_timeout_seconds) as client:
            upstream = await client.post(
                SARVAM_ASR_URL,
                headers={"api-subscription-key": config.sarvam_api_key},
                files={"file": (audio.filename or "audio.wav", payload,
                                audio.content_type or "audio/wav")},
                data={"language_code": language_code, "model": "saarika:v2"},
            )
    except httpx.RequestError as exc:
        # The device keeps its own ASR, so an upstream outage degrades quality
        # rather than breaking protection. Say so plainly.
        logger.warning("sarvam unreachable: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "transcription upstream unreachable") from exc

    if upstream.status_code >= 400:
        # Never surface the upstream body: it can echo request details and, on
        # some providers, fragments of the key.
        logger.warning("sarvam returned %s", upstream.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "transcription upstream rejected the request")

    body = upstream.json()
    return TranscribeResponse(
        transcript=body.get("transcript", ""),
        language_code=body.get("language_code"),
    )


@router.post("/explain", response_model=ExplainResponse, tags=["proxy"])
async def explain(
    body: ExplainRequest,
    user: SupabaseUser = Depends(verify_supabase_jwt),
    config: Settings = Depends(get_settings),
) -> ExplainResponse:
    """Turn a completed risk decision into plain language.

    Called at most once per critical alert. The model is given the decision and
    asked only to phrase it; it is never asked whether the payment is a scam,
    and its answer cannot change the score the phone already computed.
    """
    if not config.anthropic_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "explanation is not configured")

    if body.level not in ("HIGH", "CRITICAL"):
        # The budget guard. Spending a paid call to explain a LOW assessment is
        # how a demo account gets drained before the demo.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "explanations are only generated for HIGH and CRITICAL assessments",
        )

    amount_line = (
        f"Amount: ₹{body.amount_minor / 100:,.0f}" if body.amount_minor is not None else "Amount: not available"
    )
    payee_line = f"Recipient: {body.payee_display_name}" if body.payee_display_name else "Recipient: not available"
    reasons = "\n".join(f"- {r}" for r in body.reasons)

    prompt = (
        "You are writing the on-screen explanation for a payment that a fraud-"
        "protection app has already paused. The decision is final and was made "
        "by a deterministic engine; do not re-assess it, do not add new reasons, "
        "and do not tell the user whether to pay.\n\n"
        f"{amount_line}\n{payee_line}\nRisk: {body.score}/100 ({body.level})\n"
        f"Signals the engine used:\n{reasons}\n\n"
        "Write at most three short sentences telling the person, calmly and "
        "without blame, what was noticed and why it is worth pausing. Never "
        "imply they were foolish. Address them directly. "
        f"Write in {'Hindi' if body.language == 'hi-IN' else 'plain Indian English'}."
    )

    try:
        async with httpx.AsyncClient(timeout=config.explain_timeout_seconds) as client:
            upstream = await client.post(
                ANTHROPIC_URL,
                headers={
                    "x-api-key": config.anthropic_api_key,
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": EXPLAIN_MODEL,
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except httpx.RequestError as exc:
        logger.warning("anthropic unreachable: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "explanation upstream unreachable") from exc

    if upstream.status_code >= 400:
        logger.warning("anthropic returned %s", upstream.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "explanation upstream rejected the request")

    content = upstream.json().get("content", [])
    text = "".join(part.get("text", "") for part in content if part.get("type") == "text").strip()
    if not text:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "explanation upstream returned nothing usable")

    return ExplainResponse(explanation=text)
