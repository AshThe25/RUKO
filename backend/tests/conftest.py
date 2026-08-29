from __future__ import annotations

import os

import pytest

os.environ.setdefault("RUKO_RELAY_SECRET", "test-secret-not-used-anywhere-real")
os.environ.setdefault("RUKO_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def phone(client: TestClient) -> dict:
    """A registered phone with a device token."""
    response = client.post(
        "/devices/register",
        json={
            "installationId": "install-abcdef123456",
            "deviceLabel": "iQOO 15",
            "platform": "android",
            "appVersion": "1.0.0",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"deviceId": body["deviceId"], "token": body["deviceToken"]}


@pytest.fixture
def paired(client: TestClient, phone: dict) -> dict:
    """A phone paired with a Guardian: both tokens plus the session id."""
    pair = client.post(
        "/guardian/pair",
        json={"displayName": "Ruko on iQOO 15"},
        headers={"Authorization": f"Bearer {phone['token']}"},
    )
    assert pair.status_code == 200, pair.text
    session_id = pair.json()["sessionId"]

    claim = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": pair.json()["pairingCode"], "guardianLabel": "Priya"},
    )
    assert claim.status_code == 200, claim.text

    return {
        "sessionId": session_id,
        "phoneToken": phone["token"],
        "guardianToken": claim.json()["guardianToken"],
    }


def alert(incident_id: str = "inc_0042", **overrides) -> dict:
    """A well-formed GUARDIAN_ALERT payload matching the demo scenario.

    Money is paise: 4_800_000 == the ₹48,000 in the pitch.
    """
    payload = {
        "incidentId": incident_id,
        "payment": {
            "amountMinor": 4_800_000,
            "currency": "INR",
            "payeeDisplayName": "Ravi Verify",
            "firstPayment": True,
        },
        "assessment": assessment(),
        "runtime": {
            "engine": "onnxruntime-android",
            "model": "ruko-risk-v1",
            "backend": "CPU",
            "isLocal": True,
            "isReady": True,
            "lastLatencyMs": 41,
            "degradedReason": None,
        },
        "phoneState": "PAYMENT_PAUSED",
        "expiresInSec": 120,
    }
    payload.update(overrides)
    return payload


def assessment(**overrides) -> dict:
    """A RiskResult exactly as the engine emits it."""
    result = {
        "sessionId": "rk_test_session",
        "score": 91,
        "level": "CRITICAL",
        "policyAction": "BLOCK_WARNING",
        "reasons": [
            {
                "code": "COERCION",
                "label": "The caller pressed you to move money immediately",
                "points": 22.5,
                "family": "CONVERSATION",
            },
            {
                "code": "NEW_PAYEE",
                "label": "This is your first payment to this recipient",
                "points": 10.0,
                "family": "PAYEE_BEHAVIOUR",
            },
            {
                "code": "AMOUNT_ANOMALY",
                "label": "The amount is far above your normal range",
                "points": 9.1,
                "family": "PAYEE_BEHAVIOUR",
            },
        ],
        "contributions": [
            {
                "code": "COERCION",
                "family": "CONVERSATION",
                "signal": 0.9,
                "weight": 25.0,
                "gate": 1.0,
                "points": 22.5,
            }
        ],
        "corroboratingFamilies": ["CONVERSATION", "PAYEE_BEHAVIOUR"],
        "degraded": False,
        "degradedReasons": [],
        "escalateToGuardian": True,
        "modelVersion": "ruko-risk-v1",
        "weightsVersion": "weights-v1",
        "policyVersion": "policy-v1",
        "engineVersion": "engine-v1",
        "timestamp": 1787990000000,
        "computeMs": 12.4,
    }
    result.update(overrides)
    return result


def envelope(message_type: str, session_id: str, payload: dict) -> dict:
    return {
        "protocolVersion": "1.0.0",
        "type": message_type,
        "messageId": "msg_test_0001",
        "sessionId": session_id,
        "sentAt": 1787990000000,
        "payload": payload,
    }


def drain_until(socket, message_type: str, limit: int = 8) -> dict:
    """Read frames until one of `message_type` arrives.

    Presence and heartbeat frames interleave with everything, so tests say what
    they are waiting for instead of assuming an ordering.
    """
    for _ in range(limit):
        frame = socket.receive_json()
        if frame["type"] == message_type:
            return frame
    raise AssertionError(f"never received {message_type}")
