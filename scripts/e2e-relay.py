#!/usr/bin/env python3
"""End-to-end check of the phone -> relay -> Guardian -> phone path.

Starts nothing and mocks nothing: point it at a running relay and it plays both
roles over real websockets, exactly as the Android client and the Guardian
console do.

    cd backend && .venv/bin/uvicorn app.main:app --port 8000 &
    ./scripts/e2e-relay.py

Exit code 0 means the full critical path works.
"""

from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

try:
    import websockets
except ImportError:
    sys.exit("pip install websockets (it is in backend's dev extras)")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
WS_BASE = BASE.replace("http://", "ws://").replace("https://", "wss://")

PASS, FAIL = "  \033[32mok\033[0m", "  \033[31mFAILED\033[0m"
failures = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    print(f"{PASS if condition else FAIL}  {label}{(' — ' + detail) if detail and not condition else ''}")
    if not condition:
        failures += 1


def post(path: str, body: dict, token: str | None = None) -> dict:
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())


def envelope(message_type: str, session_id: str, payload: dict) -> str:
    return json.dumps(
        {
            "protocolVersion": "1.0.0",
            "type": message_type,
            "messageId": f"msg_{message_type.lower()}",
            "sessionId": session_id,
            "sentAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "payload": payload,
        }
    )


ALERT = {
    "incidentId": "inc_e2e_0001",
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


async def read_until(socket, message_type: str, limit: int = 6) -> dict:
    """Read frames until the wanted type arrives; presence frames interleave."""
    for _ in range(limit):
        frame = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
        if frame["type"] == message_type:
            return frame
    raise AssertionError(f"never saw {message_type}")


async def main() -> int:
    print(f"\nRuko relay end-to-end check against {BASE}\n")

    # 1. The phone registers and asks for a pairing code.
    device = post(
        "/devices/register",
        {
            "installationId": "install-e2e-000001",
            "deviceLabel": "iQOO 15",
            "platform": "android",
            "appVersion": "1.0.0",
        },
    )
    check("phone registers", device["deviceId"].startswith("dev_"))

    pairing = post("/guardian/pair", {"displayName": "Ruko on iQOO 15"}, device["deviceToken"])
    code = pairing["pairingCode"]
    session_id = pairing["sessionId"]
    check("phone gets a six-digit pairing code", len(code) == 6 and code.isdigit())

    # 2. The trusted person redeems it on the Office Kit.
    claim = post("/guardian/pair/claim", {"pairingCode": code, "guardianDisplayName": "Priya"})
    check("guardian claims the code", claim["sessionId"] == session_id)
    check("guardian sees the phone's name", claim["phoneDisplayName"] == "Ruko on iQOO 15")

    try:
        post("/guardian/pair/claim", {"pairingCode": code, "guardianDisplayName": "Mallory"})
        check("a claimed code cannot be reused", False, "second claim succeeded")
    except urllib.error.HTTPError as exc:
        check("a claimed code cannot be reused", exc.code == 404)

    phone_url = f"{WS_BASE}/guardian/{session_id}?token={device['deviceToken']}"
    guardian_url = f"{WS_BASE}/guardian/{session_id}?token={claim['guardianToken']}"

    async with websockets.connect(phone_url) as phone:
        ack = json.loads(await asyncio.wait_for(phone.recv(), timeout=5))
        check("phone connects", ack["type"] == "PAIR_ACK")
        check("phone sees no guardian yet", ack["payload"]["guardianConnected"] is False)

        # 3. A critical alert with nobody watching: the phone must not be stuck.
        await phone.send(envelope("RISK_ALERT", session_id, ALERT))
        lone = await read_until(phone, "PRESENCE")
        check("alert with no guardian is not an error", lone["type"] != "ERROR")

        async with websockets.connect(guardian_url) as guardian:
            await asyncio.wait_for(guardian.recv(), timeout=5)  # PAIR_ACK
            presence = await read_until(phone, "PRESENCE")
            check("phone learns the guardian arrived", presence["payload"]["guardianConnected"])

            # 4. The real alert.
            await phone.send(envelope("RISK_ALERT", session_id, {**ALERT, "incidentId": "inc_e2e_0002"}))
            received = await read_until(guardian, "RISK_ALERT")
            payload = received["payload"]
            check("guardian receives the alert", payload["incidentId"] == "inc_e2e_0002")
            check("amount survives intact", payload["payment"]["amountRupees"] == 48000)
            check("score is not recomputed by the relay", payload["assessment"]["score"] == 91)
            check("exactly three reasons arrive", len(payload["topReasons"]) == 3)
            check(
                "no payee identifier crossed the network",
                "payeeId" not in payload["payment"] and "payeeHash" not in payload["payment"],
            )

            # 5. The guardian decides.
            await guardian.send(
                envelope(
                    "GUARDIAN_ACTION",
                    session_id,
                    {
                        "incidentId": "inc_e2e_0002",
                        "action": "KEEP_BLOCKED",
                        "guardianDisplayName": "Priya",
                        "note": "I called the bank myself",
                    },
                )
            )
            decision = await read_until(phone, "GUARDIAN_ACTION")
            check("decision reaches the phone", decision["payload"]["action"] == "KEEP_BLOCKED")
            check("the note comes with it", decision["payload"]["note"] == "I called the bank myself")

            confirmation = await read_until(guardian, "GUARDIAN_ACTION_ACK")
            check("guardian is acknowledged", confirmation["payload"]["accepted"] is True)

            # 6. A second decision on the same incident must not land.
            await guardian.send(
                envelope(
                    "GUARDIAN_ACTION",
                    session_id,
                    {
                        "incidentId": "inc_e2e_0002",
                        "action": "ALLOW",
                        "guardianDisplayName": "Priya",
                        "note": None,
                    },
                )
            )
            refusal = await read_until(guardian, "ERROR")
            check("one decision per incident", refusal["payload"]["code"] == "ACTION_ALREADY_TAKEN")

            # 7. Role enforcement.
            await guardian.send(envelope("RISK_ALERT", session_id, ALERT))
            forged = await read_until(guardian, "ERROR")
            check("guardian cannot forge an alert", forged["payload"]["code"] == "ROLE_NOT_PERMITTED")

        # 8. Guardian leaves: the phone must stay connected and protected.
        gone = await read_until(phone, "PRESENCE")
        check("phone survives the guardian leaving", gone["payload"]["guardianConnected"] is False)
        check("phone socket is still usable", phone.state.name == "OPEN")

    print()
    if failures:
        print(f"\033[31m{failures} check(s) failed\033[0m\n")
        return 1
    print("\033[32mAll checks passed — the critical path works end to end.\033[0m\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
