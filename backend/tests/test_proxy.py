"""The API-key proxy: who may call it, and what it refuses to forward.

The point of these endpoints is that the vendor keys are *not* on the phone, so
the tests that matter are the ones about who gets in — an unsigned, expired,
anonymous or wrong-audience token must not be able to spend the team's API
budget — and the one about what may be sent to a model vendor.
"""

from __future__ import annotations

import time

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.cache import TTLCache
from app.main import create_app

SECRET = "test-jwt-secret-not-real-padded-to-32-bytes-minimum"
PROJECT = "https://example.supabase.co"


@pytest.fixture
def proxy_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("RUKO_SUPABASE_URL", PROJECT)
    monkeypatch.setenv("RUKO_SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("RUKO_SARVAM_API_KEY", "sarvam-test-key")
    monkeypatch.setenv("RUKO_ANTHROPIC_API_KEY", "anthropic-test-key")
    get_settings.cache_clear()
    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def token(**overrides) -> str:
    claims = {
        "sub": "11111111-2222-3333-4444-555555555555",
        "aud": "authenticated",
        "role": "authenticated",
        "email": "guardian@example.com",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def auth(tok: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


EXPLAIN_BODY = {
    "alert_id": "alert-1",
    "band": "CRITICAL",
    "score": 91,
    "reasons": ["AUTHORITY_IMPERSONATION", "COERCION"],
    "amount_minor": 4_800_000,
    "payee_label": "Ravi Verify",
    "kind": "payment",
}


class TestWhoMayCall:
    def test_no_header_is_rejected(self, proxy_client: TestClient) -> None:
        assert proxy_client.post("/explain", json=EXPLAIN_BODY).status_code == 401

    def test_garbage_token_is_rejected(self, proxy_client: TestClient) -> None:
        response = proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth("not.a.jwt"))
        assert response.status_code == 401

    def test_token_signed_with_another_key_is_rejected(self, proxy_client: TestClient) -> None:
        forged = jwt.encode(
            {"sub": "x", "aud": "authenticated", "role": "authenticated",
             "exp": int(time.time()) + 3600},
            "a-different-secret-also-padded-to-32-bytes-min",
            algorithm="HS256",
        )
        assert proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(forged)).status_code == 401

    def test_expired_token_is_rejected(self, proxy_client: TestClient) -> None:
        assert proxy_client.post(
            "/explain", json=EXPLAIN_BODY, headers=auth(token(exp=int(time.time()) - 10))
        ).status_code == 401

    def test_anonymous_session_is_rejected(self, proxy_client: TestClient) -> None:
        # An anonymous Supabase user still carries role=authenticated, which is
        # exactly why is_anonymous has to be checked separately.
        response = proxy_client.post(
            "/explain", json=EXPLAIN_BODY, headers=auth(token(is_anonymous=True))
        )
        assert response.status_code == 401

    def test_service_role_token_is_rejected(self, proxy_client: TestClient) -> None:
        response = proxy_client.post(
            "/explain", json=EXPLAIN_BODY, headers=auth(token(role="service_role"))
        )
        assert response.status_code == 401

    def test_wrong_audience_is_rejected(self, proxy_client: TestClient) -> None:
        response = proxy_client.post(
            "/explain", json=EXPLAIN_BODY, headers=auth(token(aud="some-other-service"))
        )
        assert response.status_code == 401

    def test_failures_do_not_say_which_check_failed(self, proxy_client: TestClient) -> None:
        expired = proxy_client.post(
            "/explain", json=EXPLAIN_BODY, headers=auth(token(exp=int(time.time()) - 10))
        ).json()
        forged = proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth("not.a.jwt")).json()
        assert expired == forged


class TestPrivacy:
    def test_a_transcript_is_refused_not_forwarded(self, proxy_client: TestClient) -> None:
        """The whole product promise, enforced at the boundary."""
        body = {**EXPLAIN_BODY, "transcript": "he told me to transfer the money"}
        response = proxy_client.post("/explain", json=body, headers=auth(token()))
        assert response.status_code == 422

    def test_audio_and_message_body_are_refused_too(self, proxy_client: TestClient) -> None:
        for field in ("audio", "message_body", "text"):
            body = {**EXPLAIN_BODY, field: "something private"}
            response = proxy_client.post("/explain", json=body, headers=auth(token()))
            assert response.status_code == 422, field

    def test_prompt_is_built_only_from_alert_facts(self) -> None:
        from app.api.proxy import ExplainRequest, _prompt

        prompt = _prompt(ExplainRequest(**EXPLAIN_BODY))
        assert "AUTHORITY_IMPERSONATION" in prompt
        assert "Ravi Verify" in prompt
        assert "48,000" in prompt
        # And it tells the model not to imply it heard the call.
        assert "must not imply" in prompt


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient and records how often it was called."""

    calls = 0
    payload: dict = {}
    status: int = 200

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def post(self, *args, **kwargs) -> _FakeResponse:
        type(self).calls += 1
        return _FakeResponse(type(self).status, type(self).payload)


class TestExplainCostControl:
    def test_at_most_one_completion_per_alert(
        self, proxy_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _FakeClient.calls = 0
        _FakeClient.status = 200
        _FakeClient.payload = {"content": [{"type": "text", "text": "Someone is rushing you."}]}
        monkeypatch.setattr("app.api.proxy.httpx.AsyncClient", _FakeClient)

        first = proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(token()))
        second = proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(token()))

        assert first.status_code == 200, first.text
        assert second.status_code == 200
        assert first.json()["cached"] is False
        assert second.json()["cached"] is True
        assert first.json()["explanation"] == second.json()["explanation"]
        # The point: the vendor was paid once, not twice.
        assert _FakeClient.calls == 1

    def test_upstream_failure_becomes_502_and_is_not_cached(
        self, proxy_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _FakeClient.calls = 0
        _FakeClient.status = 500
        _FakeClient.payload = {}
        monkeypatch.setattr("app.api.proxy.httpx.AsyncClient", _FakeClient)

        assert proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(token())).status_code == 502
        # A failure must not poison the cache for a later, working attempt.
        assert proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(token())).status_code == 502
        assert _FakeClient.calls == 2

    def test_upstream_error_does_not_leak_the_key(
        self, proxy_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _FakeClient.status = 401
        _FakeClient.payload = {"error": "invalid x-api-key anthropic-test-key"}
        monkeypatch.setattr("app.api.proxy.httpx.AsyncClient", _FakeClient)

        response = proxy_client.post("/explain", json=EXPLAIN_BODY, headers=auth(token()))
        assert "anthropic-test-key" not in response.text


class TestTranscribe:
    def test_requires_a_token(self, proxy_client: TestClient) -> None:
        response = proxy_client.post("/transcribe", files={"file": ("a.wav", b"RIFF", "audio/wav")})
        assert response.status_code == 401

    def test_empty_audio_is_a_400(self, proxy_client: TestClient) -> None:
        response = proxy_client.post(
            "/transcribe", files={"file": ("a.wav", b"", "audio/wav")}, headers=auth(token())
        )
        assert response.status_code == 400

    def test_oversized_audio_is_refused_before_the_vendor_is_called(
        self, proxy_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _FakeClient.calls = 0
        monkeypatch.setattr("app.api.proxy.httpx.AsyncClient", _FakeClient)
        monkeypatch.setenv("RUKO_MAX_AUDIO_BYTES", "1024")
        get_settings.cache_clear()

        big = b"\x00" * 4096
        response = proxy_client.post(
            "/transcribe", files={"file": ("a.wav", big, "audio/wav")}, headers=auth(token())
        )
        assert response.status_code == 413
        assert _FakeClient.calls == 0

    def test_transcript_is_returned_and_nothing_is_stored(
        self, proxy_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _FakeClient.calls = 0
        _FakeClient.status = 200
        _FakeClient.payload = {"transcript": "aapka account block ho jayega", "language_code": "hi-IN"}
        monkeypatch.setattr("app.api.proxy.httpx.AsyncClient", _FakeClient)

        response = proxy_client.post(
            "/transcribe", files={"file": ("a.wav", b"RIFFDATA", "audio/wav")}, headers=auth(token())
        )
        assert response.status_code == 200, response.text
        assert response.json()["text"] == "aapka account block ho jayega"
        # The proxy keeps no record of what it forwarded.
        assert not hasattr(proxy_client.app.state, "transcripts")


class TestUnconfiguredDeployment:
    def test_missing_vendor_key_is_503_not_a_crash(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RUKO_SUPABASE_JWT_SECRET", SECRET)
        monkeypatch.setenv("RUKO_SARVAM_API_KEY", "")
        monkeypatch.setenv("RUKO_ANTHROPIC_API_KEY", "")
        get_settings.cache_clear()
        with TestClient(create_app()) as client:
            response = client.post("/explain", json=EXPLAIN_BODY, headers=auth(token()))
            assert response.status_code == 503
        get_settings.cache_clear()


class TestTTLCache:
    def test_expires_entries(self) -> None:
        cache = TTLCache(max_size=10, ttl_seconds=100)
        cache.set("k", "v", now=0)
        assert cache.get("k", now=50) == "v"
        assert cache.get("k", now=101) is None

    def test_evicts_the_oldest_when_full(self) -> None:
        cache = TTLCache(max_size=2, ttl_seconds=100)
        cache.set("a", "1", now=0)
        cache.set("b", "2", now=0)
        cache.set("c", "3", now=0)
        assert cache.get("a", now=1) is None
        assert cache.get("c", now=1) == "3"
        assert len(cache) == 2
