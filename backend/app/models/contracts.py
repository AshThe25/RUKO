"""Pydantic mirror of `docs/contracts/guardian.schema.ts`.

Every model forbids unknown fields. That is the single most important line in
this file: the relay is the only place a hostile or buggy client meets the
protocol, so an unexpected key is a rejection, not a shrug.

The relay validates and routes. It never computes risk, never edits evidence,
and never persists an incident past the life of its session.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROTOCOL_VERSION = "1.0.0"

Confidence = Annotated[float, Field(ge=0.0, le=1.0)]
_PAIRING_CODE = re.compile(r"^\d{6}$")


class Strict(BaseModel):
    """Base for every wire model: unknown fields are an error."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --------------------------------------------------------------------------- #
# REST                                                                        #
# --------------------------------------------------------------------------- #


class DeviceRegisterRequest(Strict):
    installation_id: str = Field(min_length=8, max_length=128, alias="installationId")
    device_label: str = Field(min_length=1, max_length=64, alias="deviceLabel")
    platform: Literal["android"]
    app_version: str = Field(min_length=1, max_length=32, alias="appVersion")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DeviceRegisterResponse(Strict):
    device_id: str = Field(serialization_alias="deviceId")
    device_token: str = Field(serialization_alias="deviceToken")
    issued_at: datetime = Field(serialization_alias="issuedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianPairRequest(Strict):
    display_name: str = Field(min_length=1, max_length=80, alias="displayName")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianPairResponse(Strict):
    session_id: str = Field(serialization_alias="sessionId")
    pairing_code: str = Field(serialization_alias="pairingCode")
    expires_at: datetime = Field(serialization_alias="expiresAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianClaimRequest(Strict):
    pairing_code: str = Field(alias="pairingCode")
    guardian_display_name: str = Field(min_length=1, max_length=80, alias="guardianDisplayName")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("pairing_code")
    @classmethod
    def _six_digits(cls, value: str) -> str:
        if not _PAIRING_CODE.match(value):
            raise ValueError("pairing code must be exactly six digits")
        return value


class GuardianClaimResponse(Strict):
    session_id: str = Field(serialization_alias="sessionId")
    guardian_token: str = Field(serialization_alias="guardianToken")
    phone_display_name: str = Field(serialization_alias="phoneDisplayName")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RiskEventReport(Strict):
    """Opt-in, anonymous telemetry.

    Carries no amount, no payee, no evidence and no transcript — by design, so
    enabling telemetry can never become a privacy regression.
    """

    event_id: str = Field(min_length=8, max_length=64, alias="eventId")
    level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    score: int = Field(ge=0, le=100)
    policy_action: Literal[
        "NONE", "SUBTLE_WARNING", "BLOCK_WARNING", "BLOCK_WARNING_WITH_GUARDIAN"
    ] = Field(alias="policyAction")
    overridden: bool
    model_version: str = Field(max_length=64, alias="modelVersion")
    policy_version: str = Field(max_length=64, alias="policyVersion")
    occurred_at: datetime = Field(alias="occurredAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ModelMetadata(Strict):
    name: str
    version: str
    sha256: str
    size_bytes: int = Field(ge=0, serialization_alias="sizeBytes")
    # Null until a model is genuinely published. Never a placeholder URL.
    download_url: str | None = Field(default=None, serialization_alias="downloadUrl")
    released_at: datetime = Field(serialization_alias="releasedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- #
# WebSocket payloads                                                          #
# --------------------------------------------------------------------------- #


class RiskAssessment(Strict):
    """Carried, never computed here. Produced by the deterministic engine on the phone."""

    score: int = Field(ge=0, le=100)
    level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    reasons: list[str] = Field(max_length=8)
    policy_action: Literal[
        "NONE", "SUBTLE_WARNING", "BLOCK_WARNING", "BLOCK_WARNING_WITH_GUARDIAN"
    ] = Field(alias="policyAction")
    low_confidence: bool = Field(alias="lowConfidence")
    model_version: str = Field(max_length=64, alias="modelVersion")
    policy_version: str = Field(max_length=64, alias="policyVersion")
    evaluated_at: datetime = Field(alias="evaluatedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("reasons")
    @classmethod
    def _bounded_reasons(cls, value: list[str]) -> list[str]:
        for reason in value:
            if not reason.strip() or len(reason) > 140:
                raise ValueError("each reason must be non-empty and at most 140 characters")
        return value


class AlertPayment(Strict):
    amount_rupees: int = Field(ge=0, le=100_000_000, alias="amountRupees")
    # Display name only. The raw VPA never reaches the relay.
    payee_display_name: str = Field(min_length=1, max_length=64, alias="payeeDisplayName")
    first_payment: bool = Field(alias="firstPayment")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AlertRuntime(Strict):
    engine: str = Field(max_length=64)
    model: str = Field(max_length=64)
    backend: Literal["CPU", "NNAPI", "QUALCOMM", "RULES", "UNKNOWN"]
    is_local: bool = Field(alias="isLocal")
    # Null means "not measured". The console renders that as an em dash.
    last_latency_ms: int | None = Field(default=None, ge=0, alias="lastLatencyMs")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RiskAlertPayload(Strict):
    incident_id: str = Field(min_length=4, max_length=64, alias="incidentId")
    payment: AlertPayment
    assessment: RiskAssessment
    top_reasons: list[str] = Field(min_length=3, max_length=3, alias="topReasons")
    runtime: AlertRuntime
    phone_state: Literal["PAYMENT_PAUSED"] = Field(alias="phoneState")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("top_reasons")
    @classmethod
    def _three_real_reasons(cls, value: list[str]) -> list[str]:
        for reason in value:
            if not reason.strip() or len(reason) > 140:
                raise ValueError("each top reason must be non-empty and at most 140 characters")
        return value


class GuardianActionPayload(Strict):
    incident_id: str = Field(min_length=4, max_length=64, alias="incidentId")
    action: Literal["KEEP_BLOCKED", "ALLOW"]
    guardian_display_name: str = Field(min_length=1, max_length=80, alias="guardianDisplayName")
    note: str | None = Field(default=None, max_length=160)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianActionAckPayload(Strict):
    incident_id: str = Field(alias="incidentId")
    accepted: bool
    reason: str | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PresencePayload(Strict):
    phone_connected: bool = Field(serialization_alias="phoneConnected")
    guardian_connected: bool = Field(serialization_alias="guardianConnected")
    phone_display_name: str = Field(serialization_alias="phoneDisplayName")
    guardian_display_name: str | None = Field(
        default=None, serialization_alias="guardianDisplayName"
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class HeartbeatPayload(Strict):
    nonce: str = Field(min_length=1, max_length=64)


class RelayErrorPayload(Strict):
    code: str
    message: str = Field(max_length=200)
    recoverable: bool


# --------------------------------------------------------------------------- #
# Envelope                                                                     #
# --------------------------------------------------------------------------- #

MessageType = Literal[
    "PAIR_ACK",
    "PRESENCE",
    "RISK_ALERT",
    "GUARDIAN_ACTION",
    "GUARDIAN_ACTION_ACK",
    "PING",
    "PONG",
    "ERROR",
]

#: Who is allowed to *originate* each message type. Enforced on every inbound
#: frame, so a compromised Guardian cannot forge a RISK_ALERT and a phone
#: cannot approve its own payment.
ORIGINATOR: dict[str, str] = {
    "PAIR_ACK": "RELAY",
    "PRESENCE": "RELAY",
    "RISK_ALERT": "PHONE",
    "GUARDIAN_ACTION": "GUARDIAN",
    "GUARDIAN_ACTION_ACK": "RELAY",
    "PING": "RELAY",
    "PONG": "PHONE",
    "ERROR": "RELAY",
}


class InboundEnvelope(Strict):
    """A frame arriving from a client. Payload stays raw until the type is known."""

    protocol_version: str = Field(alias="protocolVersion")
    type: MessageType
    message_id: str = Field(min_length=4, max_length=64, alias="messageId")
    session_id: str = Field(min_length=4, max_length=80, alias="sessionId")
    sent_at: datetime = Field(alias="sentAt")
    payload: dict

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("protocol_version")
    @classmethod
    def _supported(cls, value: str) -> str:
        if value != PROTOCOL_VERSION:
            raise ValueError(f"unsupported protocol version {value!r}")
        return value


ERROR_CODES = {
    "INVALID_MESSAGE",
    "UNSUPPORTED_PROTOCOL",
    "UNAUTHORIZED",
    "PAIRING_FAILED",
    "PAIRING_EXPIRED",
    "SESSION_FULL",
    "ROLE_NOT_PERMITTED",
    "UNKNOWN_INCIDENT",
    "ACTION_ALREADY_TAKEN",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
}
