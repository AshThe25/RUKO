"""The relay socket.

These are the tests that matter most: everything here is either a routing
guarantee the phone depends on, or a boundary a hostile client would probe.
"""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import alert, drain_until, envelope


def connect(client, session_id: str, token: str):
    return client.websocket_connect(f"/guardian/{session_id}?token={token}")


# --------------------------------------------------------------------------- #
# Connection and authentication                                               #
# --------------------------------------------------------------------------- #


def test_phone_and_guardian_see_each_other(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        ack = phone.receive_json()
        assert ack["type"] == "PAIR_ACK"
        assert ack["payload"]["phoneConnected"] is True
        assert ack["payload"]["guardianConnected"] is False

        with connect(client, paired["sessionId"], paired["guardianToken"]):
            presence = drain_until(phone, "PRESENCE")
            assert presence["payload"]["guardianConnected"] is True
            assert presence["payload"]["guardianDisplayName"] == "Priya"


def test_a_missing_token_is_refused(client, paired):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/guardian/{paired['sessionId']}") as socket:
            socket.receive_json()
    assert exc.value.code == 4401


def test_a_forged_token_is_refused(client, paired):
    with pytest.raises(WebSocketDisconnect) as exc:
        with connect(client, paired["sessionId"], "garbage.token") as socket:
            socket.receive_json()
    assert exc.value.code == 4401


def test_an_unknown_session_is_refused(client, paired):
    with pytest.raises(WebSocketDisconnect) as exc:
        with connect(client, "rk_does_not_exist", paired["guardianToken"]) as socket:
            socket.receive_json()
    assert exc.value.code == 4401


def test_a_guardian_token_is_useless_on_another_session(client, phone, paired):
    other = client.post(
        "/guardian/pair",
        json={"displayName": "Another phone"},
        headers={"Authorization": f"Bearer {phone['token']}"},
    ).json()

    with pytest.raises(WebSocketDisconnect) as exc:
        with connect(client, other["sessionId"], paired["guardianToken"]) as socket:
            socket.receive_json()
    assert exc.value.code == 4401


def test_a_second_guardian_cannot_join(client, paired):
    with connect(client, paired["sessionId"], paired["guardianToken"]) as first:
        first.receive_json()
        with pytest.raises(WebSocketDisconnect) as exc:
            with connect(client, paired["sessionId"], paired["guardianToken"]) as second:
                second.receive_json()
        assert exc.value.code == 4409


# --------------------------------------------------------------------------- #
# Routing                                                                     #
# --------------------------------------------------------------------------- #


def test_a_risk_alert_reaches_the_guardian_unmodified(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
            guardian.receive_json()

            sent = alert()
            phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], sent))
            received = drain_until(guardian, "GUARDIAN_ALERT")

            assert received["payload"]["assessment"]["score"] == 91
            assert received["payload"]["payment"]["amountMinor"] == 4_800_000
            assert received["payload"]["payment"]["payeeDisplayName"] == "Ravi Verify"
            assert received["payload"]["assessment"]["reasons"] == sent["assessment"]["reasons"]
            assert received["payload"]["runtime"]["backend"] == "CPU"


def test_the_relay_does_not_recompute_the_score(client, paired):
    """A deliberately inconsistent score/level pair must survive untouched.

    The phone owns the risk engine. If the relay ever "corrected" this, it
    would have quietly become a second, competing decision-maker.
    """
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
            guardian.receive_json()

            odd = alert()
            odd["assessment"]["score"] = 12
            odd["assessment"]["level"] = "CRITICAL"
            phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], odd))

            received = drain_until(guardian, "GUARDIAN_ALERT")
            assert received["payload"]["assessment"]["score"] == 12
            assert received["payload"]["assessment"]["level"] == "CRITICAL"


def test_a_guardian_decision_reaches_the_phone(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
            guardian.receive_json()
            phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], alert()))
            drain_until(guardian, "GUARDIAN_ALERT")

            guardian.send_json(
                envelope(
                    "GUARDIAN_DECISION",
                    paired["sessionId"],
                    {
                        "incidentId": "inc_0042",
                        "decision": "KEEP_BLOCKED",
                        "guardianLabel": "Priya",
                        "note": "I called the bank, this is a scam",
                        "decidedAt": 1787990001000,
                    },
                )
            )

            delivered = drain_until(phone, "GUARDIAN_DECISION")
            assert delivered["payload"]["decision"] == "KEEP_BLOCKED"
            assert delivered["payload"]["note"] == "I called the bank, this is a scam"

            ack = drain_until(guardian, "GUARDIAN_DECISION_ACK")
            assert ack["payload"]["accepted"] is True


def test_the_phone_stays_protected_when_no_guardian_is_watching(client, paired):
    """Guardian absence is not an error. The payment is already paused locally."""
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], alert()))

        presence = drain_until(phone, "PRESENCE")
        assert presence["payload"]["guardianConnected"] is False
        assert presence["type"] != "ERROR"


# --------------------------------------------------------------------------- #
# Role enforcement                                                            #
# --------------------------------------------------------------------------- #


def test_a_guardian_cannot_forge_a_risk_alert(client, paired):
    with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
        guardian.receive_json()
        guardian.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], alert()))
        error = drain_until(guardian, "ERROR")
        assert error["payload"]["code"] == "ROLE_NOT_PERMITTED"


def test_a_phone_cannot_approve_its_own_payment(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        phone.send_json(
            envelope(
                "GUARDIAN_DECISION",
                paired["sessionId"],
                {
                    "incidentId": "inc_0042",
                    "decision": "ALLOW",
                    "guardianLabel": "Definitely Priya",
                    "note": None,
                    "decidedAt": 1787990001000,
                },
            )
        )
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "ROLE_NOT_PERMITTED"


# --------------------------------------------------------------------------- #
# Incident integrity                                                          #
# --------------------------------------------------------------------------- #


def test_a_guardian_may_act_only_once_per_incident(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
            guardian.receive_json()
            phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], alert()))
            drain_until(guardian, "GUARDIAN_ALERT")

            action = {
                "incidentId": "inc_0042",
                "decision": "KEEP_BLOCKED",
                "guardianLabel": "Priya",
                "note": None,
                "decidedAt": 1787990001000,
            }
            guardian.send_json(envelope("GUARDIAN_DECISION", paired["sessionId"], action))
            drain_until(guardian, "GUARDIAN_DECISION_ACK")

            guardian.send_json(
                envelope("GUARDIAN_DECISION", paired["sessionId"], {**action, "decision": "ALLOW"})
            )
            error = drain_until(guardian, "ERROR")
            assert error["payload"]["code"] == "ACTION_ALREADY_TAKEN"
            assert error["payload"]["recoverable"] is False


def test_an_action_for_an_unraised_incident_is_rejected(client, paired):
    with connect(client, paired["sessionId"], paired["guardianToken"]) as guardian:
        guardian.receive_json()
        guardian.send_json(
            envelope(
                "GUARDIAN_DECISION",
                paired["sessionId"],
                {
                    "incidentId": "inc_never_happened",
                    "decision": "ALLOW",
                    "guardianLabel": "Priya",
                    "note": None,
                    "decidedAt": 1787990001000,
                },
            )
        )
        error = drain_until(guardian, "ERROR")
        assert error["payload"]["code"] == "UNKNOWN_INCIDENT"


# --------------------------------------------------------------------------- #
# Protocol hardening                                                          #
# --------------------------------------------------------------------------- #


def test_an_unsupported_protocol_version_is_rejected(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        frame = envelope("GUARDIAN_ALERT", paired["sessionId"], alert())
        frame["protocolVersion"] = "9.9.9"
        phone.send_json(frame)
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "UNSUPPORTED_PROTOCOL"


def test_an_unknown_field_in_the_envelope_is_rejected(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        frame = envelope("GUARDIAN_ALERT", paired["sessionId"], alert())
        frame["transcript"] = "I am calling from your bank"
        phone.send_json(frame)
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"


def test_a_payload_carrying_a_payee_id_is_rejected(client, paired):
    """The raw VPA must never reach the relay."""
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        smuggled = alert()
        smuggled["payment"]["payeeId"] = "ravi.verify@okaxis"
        phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], smuggled))
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"


def test_an_assessment_with_no_reasons_is_rejected(client, paired):
    """An alert with nothing in the "why" is worse than no alert at all."""
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        empty = alert()
        empty["assessment"]["reasons"] = []
        phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], empty))
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"


def test_a_frame_for_another_session_is_rejected(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        phone.send_json(envelope("GUARDIAN_ALERT", "rk_someone_else", alert()))
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"


def test_an_oversized_frame_is_rejected_without_killing_the_socket(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        bloated = alert()
        bloated["payment"]["payeeDisplayName"] = "x" * 200_000
        phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], bloated))
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"

        # The socket must still be usable afterwards.
        phone.send_json(envelope("GUARDIAN_ALERT", paired["sessionId"], alert()))
        assert drain_until(phone, "PRESENCE")


def test_garbage_text_does_not_kill_the_relay(client, paired):
    with connect(client, paired["sessionId"], paired["phoneToken"]) as phone:
        phone.receive_json()
        phone.send_text("this is not json{{{")
        error = drain_until(phone, "ERROR")
        assert error["payload"]["code"] == "INVALID_MESSAGE"
