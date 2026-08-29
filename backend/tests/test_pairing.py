"""Registration and pairing: the only two REST flows that matter."""

from __future__ import annotations


def test_device_registration_issues_a_token(client):
    response = client.post(
        "/devices/register",
        json={
            "installationId": "install-abcdef123456",
            "deviceLabel": "iQOO 15",
            "platform": "android",
            "appVersion": "1.0.0",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["deviceId"].startswith("dev_")
    assert body["deviceToken"]


def test_registration_rejects_unknown_fields(client):
    response = client.post(
        "/devices/register",
        json={
            "installationId": "install-abcdef123456",
            "deviceLabel": "iQOO 15",
            "platform": "android",
            "appVersion": "1.0.0",
            "imei": "355======",
        },
    )
    assert response.status_code == 422, "unknown fields must be rejected at the boundary"


def test_registration_rejects_a_non_android_platform(client):
    response = client.post(
        "/devices/register",
        json={
            "installationId": "install-abcdef123456",
            "deviceLabel": "Pixel",
            "platform": "ios",
            "appVersion": "1.0.0",
        },
    )
    assert response.status_code == 422


def test_pairing_requires_a_device_token(client):
    assert client.post("/guardian/pair", json={"displayName": "Ruko"}).status_code == 401


def test_pairing_rejects_a_forged_token(client):
    response = client.post(
        "/guardian/pair",
        json={"displayName": "Ruko"},
        headers={"Authorization": "Bearer not.a.real.token"},
    )
    assert response.status_code == 401


def test_pairing_returns_a_six_digit_code(client, phone):
    response = client.post(
        "/guardian/pair",
        json={"displayName": "Ruko on iQOO 15"},
        headers={"Authorization": f"Bearer {phone['token']}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["pairingCode"]) == 6 and body["pairingCode"].isdigit()
    assert body["sessionId"].startswith("rk_")


def test_a_pairing_code_can_only_be_claimed_once(client, phone):
    pair = client.post(
        "/guardian/pair",
        json={"displayName": "Ruko"},
        headers={"Authorization": f"Bearer {phone['token']}"},
    ).json()

    first = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": pair["pairingCode"], "guardianDisplayName": "Priya"},
    )
    assert first.status_code == 200
    assert first.json()["phoneDisplayName"] == "Ruko"

    second = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": pair["pairingCode"], "guardianDisplayName": "Mallory"},
    )
    assert second.status_code == 404, "a burned code must not be reusable"


def test_an_unknown_code_is_indistinguishable_from_an_expired_one(client):
    response = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": "000000", "guardianDisplayName": "Mallory"},
    )
    assert response.status_code == 404
    assert "not valid" in response.json()["detail"]


def test_claim_rejects_a_malformed_code(client):
    response = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": "12ab", "guardianDisplayName": "Priya"},
    )
    assert response.status_code == 422


def test_requesting_a_new_code_invalidates_the_previous_one(client, phone):
    headers = {"Authorization": f"Bearer {phone['token']}"}
    first = client.post("/guardian/pair", json={"displayName": "Ruko"}, headers=headers).json()
    client.post("/guardian/pair", json={"displayName": "Ruko"}, headers=headers)

    stale = client.post(
        "/guardian/pair/claim",
        json={"pairingCode": first["pairingCode"], "guardianDisplayName": "Priya"},
    )
    assert stale.status_code == 404, "an abandoned code must not stay claimable"


def test_telemetry_is_accepted_and_carries_no_payment_detail(client, phone):
    response = client.post(
        "/risk-events",
        headers={"Authorization": f"Bearer {phone['token']}"},
        json={
            "eventId": "evt_abcdef12",
            "level": "CRITICAL",
            "score": 91,
            "policyAction": "BLOCK_WARNING_WITH_GUARDIAN",
            "overridden": False,
            "modelVersion": "ruko-risk-v1",
            "policyVersion": "policy-v1",
            "occurredAt": "2026-08-29T07:02:00Z",
        },
    )
    assert response.status_code == 202


def test_telemetry_refuses_to_carry_an_amount(client, phone):
    response = client.post(
        "/risk-events",
        headers={"Authorization": f"Bearer {phone['token']}"},
        json={
            "eventId": "evt_abcdef12",
            "level": "CRITICAL",
            "score": 91,
            "policyAction": "BLOCK_WARNING",
            "overridden": False,
            "modelVersion": "ruko-risk-v1",
            "policyVersion": "policy-v1",
            "occurredAt": "2026-08-29T07:02:00Z",
            "amountRupees": 48000,
        },
    )
    assert response.status_code == 422, "telemetry must never become a privacy regression"


def test_models_latest_reports_no_published_model_rather_than_a_stub(client):
    response = client.get("/models/latest")
    assert response.status_code == 404
    assert "bundled model" in response.json()["detail"]


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["protocolVersion"] == "1.0.0"
