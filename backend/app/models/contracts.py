"""Pydantic mirror of the guardian transport contract.

Mirrors `docs/contracts/guardian.schema.ts`, which in turn sits on Vedant's
domain types in `risk.schema.ts` and `payment.schema.ts`.

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

#: Epoch milliseconds. One time convention end to end — see the reconciliation
#: note at the top of docs/contracts/guardian.schema.ts for why the wire does
#: not use ISO strings.
EpochMs = Annotated[int, Field(ge=0)]

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
PolicyAction = Literal["NONE", "SUBTLE_WARNING", "STRONG_WARNING", "BLOCK_WARNING"]
EvidenceFamily = Literal["CONVERSATION", "PAYEE_BEHAVIOUR", "CALL_CONTEXT", "NOTIFICATION"]
RiskReasonCode = Literal[
    "COERCION",
    "AUTHORITY_IMPERSONATION",
    "FINANCIAL_INSTRUCTION",
    "URGENCY",
    "SECRECY",
    "CREDENTIAL_REQUEST",
    "NEW_PAYEE",
    "AMOUNT_ANOMALY",
    "FREQUENCY_ANOMALY",
    "TIME_ANOMALY",
    "UNKNOWN_CALLER",
    "CALL_DURING_PAYMENT",
    "SUSPICIOUS_NOTIFICATION",
]

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
    issued_at: EpochMs = Field(serialization_alias="issuedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianPairRequest(Strict):
    display_name: str = Field(min_length=1, max_length=80, alias="displayName")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianPairResponse(Strict):
    session_id: str = Field(serialization_alias="sessionId")
    pairing_code: str = Field(serialization_alias="pairingCode")
    expires_at: EpochMs = Field(serialization_alias="expiresAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianClaimRequest(Strict):
    pairing_code: str = Field(alias="pairingCode")
    guardian_label: str = Field(min_length=1, max_length=80, alias="guardianLabel")

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
    level: RiskLevel
    score: int = Field(ge=0, le=100)
    policy_action: PolicyAction = Field(alias="policyAction")
    overridden: bool
    model_version: str = Field(max_length=64, alias="modelVersion")
    policy_version: str = Field(max_length=64, alias="policyVersion")
    occurred_at: EpochMs = Field(alias="occurredAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ModelMetadata(Strict):
    name: str
    version: str
    sha256: str
    size_bytes: int = Field(ge=0, serialization_alias="sizeBytes")
    # Null until a model is genuinely published. Never a placeholder URL.
    download_url: str | None = Field(default=None, serialization_alias="downloadUrl")
    released_at: EpochMs = Field(serialization_alias="releasedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- #
# WebSocket payloads                                                          #
# --------------------------------------------------------------------------- #


class RiskReason(Strict):
    """One line of the "why". Mirrors risk.schema.ts."""

    code: RiskReasonCode
    label: str = Field(min_length=1, max_length=140)
    points: float = Field(ge=0)
    family: EvidenceFamily

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RiskContribution(Strict):
    """Every weight term, including zero ones. For the engineering view."""

    code: RiskReasonCode
    family: EvidenceFamily
    signal: float = Field(ge=0.0, le=1.0)
    weight: float = Field(ge=0)
    gate: float = Field(ge=0)
    points: float = Field(ge=0)
    gate_reason: str | None = Field(default=None, max_length=200, alias="gateReason")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RiskResult(Strict):
    """The engine's output, carried verbatim.

    The relay validates its shape and forwards it untouched. It does not
    recompute the score, reorder the reasons, or "correct" an inconsistency —
    doing any of that would quietly make the relay a second decision-maker.
    """

    session_id: str = Field(min_length=4, max_length=80, alias="sessionId")
    score: int = Field(ge=0, le=100)
    level: RiskLevel
    policy_action: PolicyAction = Field(alias="policyAction")
    reasons: list[RiskReason] = Field(min_length=1, max_length=16)
    contributions: list[RiskContribution] = Field(default_factory=list, max_length=32)
    corroborating_families: list[EvidenceFamily] = Field(
        default_factory=list, alias="corroboratingFamilies"
    )
    degraded: bool
    degraded_reasons: list[str] = Field(default_factory=list, alias="degradedReasons")
    escalate_to_guardian: bool = Field(alias="escalateToGuardian")

    # Audit trail: everything needed to reproduce this decision.
    model_version: str = Field(max_length=64, alias="modelVersion")
    weights_version: str = Field(max_length=64, alias="weightsVersion")
    policy_version: str = Field(max_length=64, alias="policyVersion")
    engine_version: str = Field(max_length=64, alias="engineVersion")
    timestamp: EpochMs
    compute_ms: float = Field(ge=0, alias="computeMs")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AlertPayment(Strict):
    # Integer paise, matching payment.schema.ts. Rupee-only silently truncates
    # and the bug stays invisible until a demo.
    amount_minor: int = Field(ge=0, le=10_000_000_000, alias="amountMinor")
    currency: Literal["INR"] = "INR"
    # Display name only. The raw VPA never reaches the relay.
    payee_display_name: str = Field(min_length=1, max_length=64, alias="payeeDisplayName")
    first_payment: bool = Field(alias="firstPayment")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AlertRuntime(Strict):
    engine: str = Field(max_length=64)
    model: str = Field(max_length=64)
    backend: Literal["CPU", "NNAPI", "QUALCOMM", "RULES", "UNKNOWN"]
    is_local: bool = Field(alias="isLocal")
    is_ready: bool = Field(alias="isReady")
    # Null means NOT MEASURED. The console renders it as an em dash.
    last_latency_ms: int | None = Field(default=None, ge=0, alias="lastLatencyMs")
    degraded_reason: str | None = Field(default=None, max_length=200, alias="degradedReason")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianAlertPayload(Strict):
    """Phone -> Guardian. The most important message in the system."""

    incident_id: str = Field(min_length=4, max_length=64, alias="incidentId")
    payment: AlertPayment
    assessment: RiskResult
    runtime: AlertRuntime
    phone_state: Literal["PAYMENT_PAUSED"] = Field(alias="phoneState")
    expires_in_sec: int = Field(ge=0, le=3600, alias="expiresInSec")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianDecisionPayload(Strict):
    """Guardian -> phone. Advisory: it can keep a block, never force a payment."""

    incident_id: str = Field(min_length=4, max_length=64, alias="incidentId")
    decision: Literal["KEEP_BLOCKED", "ALLOW"]
    guardian_label: str = Field(min_length=1, max_length=80, alias="guardianLabel")
    note: str | None = Field(default=None, max_length=160)
    decided_at: EpochMs = Field(alias="decidedAt")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class GuardianDecisionAckPayload(Strict):
    incident_id: str = Field(alias="incidentId")
    accepted: bool
    reason: str | None = None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PresencePayload(Strict):
    phone_connected: bool = Field(serialization_alias="phoneConnected")
    guardian_connected: bool = Field(serialization_alias="guardianConnected")
    phone_display_name: str = Field(serialization_alias="phoneDisplayName")
    guardian_label: str | None = Field(default=None, serialization_alias="guardianLabel")

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
    "GUARDIAN_ALERT",
    "GUARDIAN_DECISION",
    "GUARDIAN_DECISION_ACK",
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
    "GUARDIAN_ALERT": "PHONE",
    "GUARDIAN_DECISION": "GUARDIAN",
    "GUARDIAN_DECISION_ACK": "RELAY",
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
    sent_at: EpochMs = Field(alias="sentAt")
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
