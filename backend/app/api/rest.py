"""REST surface of the relay.

Four endpoints, none of which touch evidence or risk:
    POST /devices/register     phone gets an identity
    POST /guardian/pair        phone gets a pairing code to read aloud
    POST /guardian/pair/claim  Guardian console redeems that code
    POST /risk-events          opt-in anonymous telemetry
    GET  /models/latest        model/version metadata
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import authenticated_device, registry, settings
from app.config import Settings
from app.core.security import ROLE_GUARDIAN, ROLE_PHONE, mint_token, new_id
from app.core.sessions import PairingError, SessionRegistry
from app.models.contracts import (
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    GuardianClaimRequest,
    GuardianClaimResponse,
    GuardianPairRequest,
    GuardianPairResponse,
    ModelMetadata,
    RiskEventReport,
)

router = APIRouter()


def _now_ms() -> int:
    """Epoch milliseconds. One time convention across the whole wire."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


@router.post("/devices/register", response_model=DeviceRegisterResponse, response_model_by_alias=True)
async def register_device(
    body: DeviceRegisterRequest,
    config: Settings = Depends(settings),
) -> DeviceRegisterResponse:
    """Issue a device identity.

    The installation id is app-scoped and random — never an Android ID, IMEI or
    advertising id — and the relay does not store it. It exists so the phone's
    token is bound to something, not so the phone can be tracked.
    """
    device_id = new_id("dev")
    return DeviceRegisterResponse(
        device_id=device_id,
        device_token=mint_token(config.relay_secret, ROLE_PHONE, device_id),
        issued_at=_now_ms(),
    )


@router.post("/guardian/pair", response_model=GuardianPairResponse, response_model_by_alias=True)
async def start_pairing(
    body: GuardianPairRequest,
    device_id: str = Depends(authenticated_device),
    store: SessionRegistry = Depends(registry),
) -> GuardianPairResponse:
    try:
        session = await store.create_session(device_id, body.display_name)
    except PairingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    return GuardianPairResponse(
        session_id=session.session_id,
        pairing_code=session.pairing_code or "",
        expires_at=int(session.pairing_expires_at * 1000),
    )


@router.post("/guardian/pair/claim", response_model=GuardianClaimResponse, response_model_by_alias=True)
async def claim_pairing(
    body: GuardianClaimRequest,
    store: SessionRegistry = Depends(registry),
    config: Settings = Depends(settings),
) -> GuardianClaimResponse:
    try:
        session = await store.claim(body.pairing_code, body.guardian_label)
    except PairingError as exc:
        # 404 for every failure mode: a wrong code and an expired code must be
        # indistinguishable, or this endpoint becomes a code oracle.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pairing code is not valid") from exc

    return GuardianClaimResponse(
        session_id=session.session_id,
        guardian_token=mint_token(config.relay_secret, ROLE_GUARDIAN, session.session_id),
        phone_display_name=session.phone_display_name,
    )


@router.post("/risk-events", status_code=status.HTTP_202_ACCEPTED)
async def report_risk_event(
    body: RiskEventReport,
    device_id: str = Depends(authenticated_device),
) -> dict[str, str]:
    """Accept an opt-in, anonymous risk event.

    The relay validates the shape and drops it. Wiring this to real storage is
    a deliberate later decision, and would need an explicit user consent flow
    plus a retention policy — not a quiet `INSERT`.
    """
    return {"status": "accepted", "eventId": body.event_id}


@router.get("/models/latest", response_model=ModelMetadata, response_model_by_alias=True)
async def latest_model(config: Settings = Depends(settings)) -> ModelMetadata:
    """Metadata for the currently published on-device model.

    Reads `model_manifest.json` if ml/ has published one. If no manifest
    exists this returns 404 rather than a stub with a zeroed hash: a fake
    checksum here would be repeated verbatim by the Engineering screen and by
    the Guardian's runtime tile, which is exactly the kind of invented value
    the build prompt forbids.

    To publish, drop a manifest matching `ModelMetadata` at the path in
    `RUKO_MODEL_MANIFEST_PATH`.
    """
    manifest = Path(config.model_manifest_path)
    if not manifest.is_file():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "no model has been published; the app is running its bundled model",
        )
    try:
        return ModelMetadata.model_validate_json(manifest.read_text())
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "model manifest is unreadable or malformed"
        ) from exc
