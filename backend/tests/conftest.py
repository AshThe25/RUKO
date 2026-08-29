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
        json={"pairingCode": pair.json()["pairingCode"], "guardianDisplayName": "Priya"},
    )
    assert claim.status_code == 200, claim.text

    return {
        "sessionId": session_id,
        "phoneToken": phone["token"],
        "guardianToken": claim.json()["guardianToken"],
    }


def alert(incident_id: str = "inc_0042", **overrides) -> dict:
    """A well-formed RISK_ALERT payload matching the demo scenario."""
    payload = {
        "incidentId": incident_id,
        "payment": {
            "amountRupees": 48000,
            "payeeDisplayName": "Ravi Verify",
            "firstPayment": True,
        },
        "assessment": {
            "score": 91,
            "level": "CRITICAL",
            "reasons": ["Caller used authority pressure"],
            "policyAction": "BLOCK_WARNING_WITH_GUARDIAN",
            "lowConfidence": False,
            "modelVersion": "ruko-risk-v1",
            "policyVersion": "policy-v1",
            "evaluatedAt": "2026-08-29T07:01:59Z",
        },
        "topReasons": [
            "The caller pressed you to move money immediately",
            "This is your first payment to this recipient",
            "The amount is far above your normal range",
        ],
        "runtime": {
            "engine": "onnxruntime-android",
            "model": "ruko-risk-v1",
            "backend": "CPU",
            "isLocal": True,
            "lastLatencyMs": 41,
        },
        "phoneState": "PAYMENT_PAUSED",
    }
    payload.update(overrides)
    return payload


def envelope(message_type: str, session_id: str, payload: dict) -> dict:
    return {
        "protocolVersion": "1.0.0",
        "type": message_type,
        "messageId": "msg_test_0001",
        "sessionId": session_id,
        "sentAt": "2026-08-29T07:02:00Z",
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
