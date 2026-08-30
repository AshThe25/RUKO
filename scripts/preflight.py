#!/usr/bin/env python3
"""Check every seam the app needs before a demo or a release build.

    python3 scripts/preflight.py

WHY: the failure this catches is silent. A missing RUKO_BACKEND_URL does not
crash anything — BACKEND_URL resolves to '' and cloud transcription simply never
runs, which looks exactly like "the model didn't detect it". The same is true of
an unexposed schema and of a phone signed into a different Supabase project than
the proxy verifies against. Every one of those presents as "the demo is broken"
with no error to read.

Nothing here is mutated. It reads config and asks the live services.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENV = REPO / "mobile" / ".env"
TIMEOUT = 20

OK, WARN, FAIL = "  ok  ", " warn ", " FAIL "
problems: list[str] = []


def report(status: str, label: str, detail: str = "") -> None:
    print(f"[{status}] {label}" + (f"\n         {detail}" if detail else ""))
    if status == FAIL:
        problems.append(label)


def get(url: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read(4000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(4000).decode("utf-8", "replace")
    except Exception as e:  # DNS, TLS, timeout
        return 0, str(e)


def read_env() -> dict[str, str]:
    if not ENV.exists():
        report(FAIL, "mobile/.env exists", "copy mobile/.env.example to mobile/.env")
        return {}
    values = dict(re.findall(r"^([A-Z_]+)=(.*)$", ENV.read_text(), re.M))
    return {k: v.strip() for k, v in values.items()}


def main() -> int:
    print("Ruko preflight\n" + "=" * 60)
    env = read_env()
    if not env:
        return 1

    supabase = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_PUBLISHABLE_KEY", "")
    backend = env.get("RUKO_BACKEND_URL", "")

    # --- 1. the app's build-time configuration -------------------------------
    for name, value in (("SUPABASE_URL", supabase),
                        ("SUPABASE_PUBLISHABLE_KEY", key),
                        ("RUKO_BACKEND_URL", backend)):
        if value:
            report(OK, f"{name} set")
        else:
            report(FAIL, f"{name} set",
                   "empty — read at BUILD time, so fixing it means rebuilding the APK")

    if key.startswith("sb_secret") or "service_role" in key:
        report(FAIL, "publishable key is not a service-role key",
               "a service-role key must never ship in a client")
    elif key:
        report(OK, "publishable key looks like a client key")

    # --- 2. Supabase ---------------------------------------------------------
    if supabase:
        status, body = get(f"{supabase}/rest/v1/alerts?select=id&limit=1",
                           {"apikey": key, "Accept-Profile": "ruko"})
        if "PGRST106" in body:
            report(FAIL, "ruko schema exposed to the API",
                   "Dashboard -> Project Settings -> API -> Exposed schemas -> add 'ruko'")
        elif status in (200, 401, 403) or "42501" in body:
            report(OK, "ruko schema exposed", "(RLS still governs the rows, as intended)")
        else:
            report(WARN, "ruko schema exposed", f"unexpected: HTTP {status} {body[:120]}")

        status, body = get(f"{supabase}/auth/v1/settings", {"apikey": key})
        if status == 200:
            providers = json.loads(body).get("external", {})
            if providers.get("google"):
                report(OK, "Google sign-in enabled")
            else:
                report(FAIL, "Google sign-in enabled",
                       "Dashboard -> Authentication -> Providers -> Google")
        else:
            report(WARN, "auth settings readable", f"HTTP {status}")

    # --- 3. the proxy --------------------------------------------------------
    if backend:
        status, body = get(f"{backend}/health")
        if status == 200 and "ok" in body:
            report(OK, "proxy reachable", f"{backend} -> {body.strip()[:80]}")
        else:
            report(FAIL, "proxy reachable", f"{backend} -> HTTP {status}")

        # 401 is the correct answer to an unauthenticated call: it proves the
        # route exists AND that it refuses anonymous callers. 404 means the
        # deployment predates the proxy.
        for endpoint in ("/transcribe", "/explain"):
            status, _ = get(f"{backend}{endpoint}")
            if status in (401, 405):
                report(OK, f"{endpoint} deployed and refuses anonymous callers")
            elif status == 404:
                report(FAIL, f"{endpoint} deployed",
                       "404 — this deployment predates the proxy; redeploy Render")
            else:
                report(WARN, f"{endpoint} deployed", f"HTTP {status}")

    print("=" * 60)
    if problems:
        print(f"{len(problems)} blocking problem(s):")
        for p in problems:
            print(f"  - {p}")
    else:
        print("all checks passed")

    print("\nCannot be checked from here — confirm in the Render dashboard:")
    print("  * RUKO_SUPABASE_URL must equal", supabase or "<the app's project>")
    print("    A token from a different project is an invalid token: every")
    print("    /transcribe call would return 401 and look like a broken model.")
    print("  * RUKO_SARVAM_API_KEY set, or /transcribe returns 503 once signed in.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
