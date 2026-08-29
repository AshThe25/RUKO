"""Guards the Python mirror against drift from the canonical TypeScript.

`docs/contracts/guardian.schema.ts` is the source of truth. This test parses it
and compares field names against the Pydantic models, so a field added on one
side and forgotten on the other fails the build instead of failing in the demo.

The parser is deliberately small — it understands the narrow subset of
TypeScript the contract file actually uses, and says so loudly if the file
drifts into syntax it cannot read.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.models.contracts import (
    AlertPayment,
    AlertRuntime,
    DeviceRegisterRequest,
    GuardianDecisionPayload,
    GuardianClaimRequest,
    GuardianPairRequest,
    GuardianAlertPayload,
    RiskEventReport,
)

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "guardian.schema.ts"

# The contract uses `export interface X { ... }` for object shapes and
# `export type X = { ... }` for a few aliases. Parse both.
_TYPE_BLOCK = re.compile(
    r"export (?:interface (\w+)\s*\{|type (\w+)\s*=\s*\{)(.*?)\n\}", re.DOTALL
)
_FIELD = re.compile(r"^\s{2}(\w+)\??\s*:", re.MULTILINE)


def parse_typescript_types(source: str) -> dict[str, set[str]]:
    """Field names per exported object type, ignoring comments."""
    without_comments = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    without_comments = re.sub(r"//.*$", "", without_comments, flags=re.MULTILINE)

    parsed: dict[str, set[str]] = {}
    for interface_name, type_name, body in _TYPE_BLOCK.findall(without_comments):
        parsed[interface_name or type_name] = set(_FIELD.findall(body))
    return parsed


@pytest.fixture(scope="module")
def ts_types() -> dict[str, set[str]]:
    assert CONTRACT.is_file(), f"canonical contract missing at {CONTRACT}"
    parsed = parse_typescript_types(CONTRACT.read_text())
    assert parsed, "parsed no types — the contract file's syntax has drifted"
    return parsed


def pydantic_field_names(model) -> set[str]:
    """Wire names: the alias if one is set, otherwise the field name."""
    return {
        (field.alias or field.serialization_alias or name)
        for name, field in model.model_fields.items()
    }


@pytest.mark.parametrize(
    ("ts_name", "model"),
    [
        ("DeviceRegisterRequest", DeviceRegisterRequest),
        ("GuardianPairRequest", GuardianPairRequest),
        ("GuardianClaimRequest", GuardianClaimRequest),
        ("RiskEventReport", RiskEventReport),
        ("GuardianDecisionPayload", GuardianDecisionPayload),
    ],
)
def test_python_mirror_matches_the_canonical_contract(ts_types, ts_name, model):
    assert ts_name in ts_types, f"{ts_name} is no longer in the canonical contract"
    assert pydantic_field_names(model) == ts_types[ts_name], (
        f"{ts_name} has drifted between docs/contracts and backend/app/models"
    )


def test_risk_alert_payload_matches(ts_types):
    """GuardianAlertPayload nests inline objects, so its parts are checked directly."""
    assert pydantic_field_names(GuardianAlertPayload) == ts_types["GuardianAlertPayload"]
    assert pydantic_field_names(AlertPayment) == {
        "amountMinor",
        "currency",
        "payeeDisplayName",
        "firstPayment",
    }
    assert pydantic_field_names(AlertRuntime) == {
        "engine",
        "model",
        "backend",
        "isLocal",
        "isReady",
        "lastLatencyMs",
        "degradedReason",
    }


def test_the_alert_carries_no_identifier_that_could_deanonymise_the_payee():
    """A standing guard against someone helpfully adding `payeeId` later."""
    forbidden = {"payeeId", "payeeHash", "accountNumber", "vpa", "transcript", "audio"}
    leaked = forbidden & (pydantic_field_names(AlertPayment) | pydantic_field_names(GuardianAlertPayload))
    assert not leaked, f"these must never cross the network: {leaked}"


def test_originator_map_covers_every_message_type():
    from app.models.contracts import ORIGINATOR

    source = re.sub(r"/\*.*?\*/", "", CONTRACT.read_text(), flags=re.DOTALL)
    declared = set(re.findall(r"Envelope<\s*'(\w+)'\s*,", source))
    assert declared, "no envelope types found — the contract file has drifted"
    assert declared <= set(ORIGINATOR), (
        f"message types with no originator rule: {declared - set(ORIGINATOR)}"
    )
