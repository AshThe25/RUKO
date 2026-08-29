# Android + iQOO 15 capabilities for Ruko

**Owner:** Puneesh · **Status:** baseline, partially unverified · **Last updated:** 2026-08-29

This document exists to stop us from claiming things Android does not actually
let a third-party app do. Every row is one of:

| Marker | Meaning |
| --- | --- |
| ✅ **AVAILABLE** | Works for a normal app with a user-granted permission. Safe to build on. |
| ⚠️ **CONDITIONAL** | Works, but with a caveat that changes the design. Read the note. |
| 🔬 **UNVERIFIED** | Plausible but not yet measured on the physical iQOO 15. Run `scripts/probe-device.sh`. |
| ❌ **NOT AVAILABLE** | Impossible for a normal app. Requires OEM/OS/payment-rail integration. Do not claim it. |

> **How to resolve a 🔬 row:** connect the iQOO 15 and run
> `./scripts/probe-device.sh`. It writes `docs/device-report.md` with measured
> values. Update the row here and cite the report. Nothing in the app's
> Engineering screen may show a value that was not measured.

## Environment status (2026-08-29)

The probe has **not** been run yet: no Android SDK is installed on the build
machine (`ANDROID_HOME` unset, no `~/Library/Android/sdk`) and no device is
attached (`adb devices` is empty). `adb` itself is present via Homebrew.

Consequence: the Kotlin in `android/` is written and unit-tested for its pure
logic, but **has not been compiled against the Android SDK and has not run on a
device.** That is tracked in "Open verification tasks" at the bottom and must be
closed before we claim any of it works.

---

## 1. The honest boundary

Ruko's thesis needs three things: hear the conversation, see the payment, and
interrupt before confirmation. Android gives a normal app only partial access to
each. Here is exactly where the line falls.

### 1.1 What Ruko genuinely does

- Captures **device microphone** audio in a user-started, notification-visible
  foreground session.
- Runs **ASR and manipulation classification entirely on-device**.
- Observes **call state** (idle / ringing / off-hook).
- Observes the **foreground app and visible screen text** via a user-granted
  AccessibilityService.
- Reads **notification metadata** via a user-granted NotificationListenerService.
- Draws an **intervention over the payment screen** via `SYSTEM_ALERT_WINDOW`.
- Pauses **its own demo payment flow** and warns before any real confirmation.

### 1.2 What Ruko does not do, and we must never say it does

| Claim we must avoid | Reality |
| --- | --- |
| "Ruko records the phone call" | ❌ `VOICE_CALL` / `VOICE_DOWNLINK` / `VOICE_UPLINK` audio sources need `CAPTURE_AUDIO_OUTPUT`, a `signature\|privileged` permission. Ruko hears the **room** through the mic, which works when the call is on speaker. |
| "Ruko intercepts UPI transactions" | ❌ There is no public API to observe or block a payment in GPay/PhonePe/Paytm. Ruko reads what is *visible on screen* via accessibility, and fully controls only its own `RukoPayDemo`. |
| "Ruko blocks the payment" | ❌ Ruko cannot cancel a third-party app's transaction. It interrupts the **user's decision** with an overlay. In the demo app it genuinely halts the flow. |
| "Ruko identifies the caller" | ⚠️ Caller number needs `READ_CALL_LOG`, which is restricted by Play policy. See §4. |
| "Ruko runs on the NPU" | 🔬 Unverified. See §6. Report the backend the runtime actually returned. |

This boundary is a **feature of the pitch**, not a weakness: the production
answer is OEM integration, which is precisely why we are pitching it to iQOO.

---

## 2. Microphone and audio capture

| Item | Status | Detail |
| --- | --- | --- |
| `RECORD_AUDIO` runtime permission | ✅ AVAILABLE | Standard runtime grant. |
| Foreground service with `microphone` type | ⚠️ CONDITIONAL | Android 14 (API 34+) requires `android:foregroundServiceType="microphone"` **and** the `FOREGROUND_SERVICE_MICROPHONE` permission. The service must be started **while the app is visible** — background starts throw `ForegroundServiceStartNotAllowedException`. Ruko starts protection from a user tap, which satisfies this. |
| Persistent notification | ✅ AVAILABLE | Non-dismissible while the mic session runs. Required by policy and by our own privacy stance (§23 of the build prompt). |
| Mic access **while a cellular call is active** | 🔬 UNVERIFIED | Android 10+ audio-capture concurrency gives the telephony stack priority. A normal app may receive **silence** for the duration of a call. This is device- and OEM-dependent and is the single highest-risk unknown in the project. |
| Privacy indicator | ✅ AVAILABLE | Android 12+ shows a green mic dot. We should point at it during the pitch — it proves we are not recording silently. |

### 2.1 Mitigation for the call-audio unknown

Two capture paths, decided by measurement, not by hope:

1. **If mic capture during a call works** — the scam call is placed to the iQOO
   on speakerphone and Ruko hears it. This is the real-world path.
2. **If the platform silences us during a call** — the demo runs with the
   scammer audio played aloud from a second device next to the iQOO while the
   Ruko session is active. Ruko is still doing genuine live ASR on live room
   audio; only the call-state signal is simulated, and the Engineering screen
   must label it `callActive: simulated`.

Both paths keep the AI real. Neither requires us to fake a transcript.
`scripts/probe-device.sh` plus a 60-second manual test resolves which applies.

---

## 3. Payment context

| Item | Status | Detail |
| --- | --- | --- |
| Detect foreground app package | ✅ AVAILABLE | Via `AccessibilityEvent.getPackageName()`. (`getRunningTasks` is long dead; `UsageStatsManager` needs `PACKAGE_USAGE_STATS`, a Settings-level grant, and is coarse.) |
| Read visible amount / payee text | ⚠️ CONDITIONAL | Via accessibility node traversal. Works only when the target app exposes text nodes; apps may mark views `FLAG_SECURE` or use canvas rendering, and layouts change between versions. **Never rely on this exclusively.** |
| Intercept / cancel a real UPI payment | ❌ NOT AVAILABLE | No public API. Production answer is OEM or payment-rail integration. |
| Overlay over a payment screen | ⚠️ CONDITIONAL | `SYSTEM_ALERT_WINDOW`, granted through a Settings screen. Some apps set `FLAG_SECURE`, which does not block the overlay but does block screenshots. Overlay is not permitted over system permission dialogs. |
| Control `RukoPayDemo` end-to-end | ✅ AVAILABLE | Our own app, our own flow. Genuinely halted. |

This is why `PaymentContextProvider` has three implementations and the source is
carried in the evidence object (`PaymentEvidence.source`) all the way to the
audit trail — a `demo_app` payment is never displayed as an intercepted one.

### 3.1 Accessibility and Play policy

Google Play restricts `AccessibilityService` to genuine accessibility purposes.
Ruko's use is a **prototype and OEM-integration proposal**, not a Play-shippable
design. Say this plainly in the README and to the judges; the credible
production story is that iQOO ships this at the OS layer, where accessibility
is not needed at all.

---

## 4. Call state

| Item | Status | Detail |
| --- | --- | --- |
| Call state (idle / ringing / off-hook) | ✅ AVAILABLE | `READ_PHONE_STATE` + `TelephonyManager.registerTelephonyCallback` (API 31+) / `PhoneStateListener` below that. |
| Call duration | ✅ AVAILABLE | Measured by us from the off-hook transition. |
| Incoming caller number | ⚠️ CONDITIONAL | `EXTRA_INCOMING_NUMBER` requires `READ_CALL_LOG` since Android 9. Play-policy restricted. |
| "Is this caller in my contacts" | ⚠️ CONDITIONAL | Needs the number (above) plus `READ_CONTACTS`. |

**Decision:** Ruko does not request `READ_CALL_LOG`. `CallEvidence.callerKnown`
defaults to `false` with `audioFromMicrophone: true`, and the risk engine treats
"unknown caller" as worth only 5 points (build prompt §20) — small enough that
degrading it honestly costs us almost nothing.

---

## 5. Notifications

| Item | Status | Detail |
| --- | --- | --- |
| Read posted notifications | ✅ AVAILABLE | `NotificationListenerService` + `BIND_NOTIFICATION_LISTENER_SERVICE`, user-granted in a Settings screen. |
| Filter to finance-related only | ✅ AVAILABLE | Our own filtering, applied **before** anything is stored. |
| Post our own high-priority alert | ✅ AVAILABLE | `POST_NOTIFICATIONS` runtime permission on API 33+. |

Ruko stores only a bounded, redacted excerpt and a suspicion score — never the
full notification body, and never notifications from non-financial apps.
A suspicious notification alone can never reach CRITICAL (build prompt §14).

---

## 6. On-device AI acceleration

This is the section most likely to tempt us into lying. It must not.

| Backend | Status | Detail |
| --- | --- | --- |
| CPU (XNNPACK) | ✅ AVAILABLE | Always works. This is the honest baseline and the guaranteed fallback. |
| GPU delegate (LiteRT / OpenCL) | 🔬 UNVERIFIED | Usually available on Adreno. Measure before claiming. |
| NNAPI | ⚠️ CONDITIONAL | **Deprecated from Android 15 (API 35).** If the iQOO 15 ships Android 16, NNAPI is legacy and may fall back to a CPU reference driver — which would be *slower* than XNNPACK while sounding more impressive. Do not use it for the headline claim. |
| Qualcomm QNN / Hexagon HTP | 🔬 UNVERIFIED | Requires the QNN backend `.so` files bundled in our APK, matching the exact HTP architecture version of the SoC, plus `libcdsprpc.so` on device. The probe script lists what is present. |

### 6.1 Rules for the Engineering screen

1. `getDeviceAIBackend()` reports the backend the runtime **actually
   initialised**, read back from the session — never the one we requested.
2. Latency is **measured** on real inference. If nothing has run, the screen
   shows `—`, not a number.
3. If QNN initialisation fails we fall back to CPU and the screen says `CPU`.
   A silent fallback that still displays "QUALCOMM" is the exact failure mode
   the build prompt forbids, and a judge who taps the screen will catch it.
4. `RiskAlertPayload.runtime.lastLatencyMs` is nullable for this reason.

### 6.2 Recommended order of work

Ship CPU first and make it fast enough. Attempt QNN only after the vertical
slice is green (build prompt phase 8). A measured 40 ms CPU classifier is a
better demo than a broken NPU claim.

---

## 7. Background survival on iQOO / OriginOS

vivo-family builds are among the most aggressive at killing background work.

| Item | Status | Detail |
| --- | --- | --- |
| Foreground service survives screen-off | 🔬 UNVERIFIED | Must be tested on the device with a 10-minute session. |
| Battery-optimisation exemption | ⚠️ CONDITIONAL | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` opens a system dialog. vivo also has its own per-app background switch that adb cannot set. |
| Auto-start after reboot | ⚠️ CONDITIONAL | vivo gates this behind a proprietary "Autostart" setting. Ruko does not need it — protection is user-started. |

**Demo hardening:** before the run, put the iQOO in the demo state manually —
battery optimisation off for Ruko, vivo background switch on, screen kept awake.
Add these to the demo checklist rather than trying to solve OEM policy in code.

---

## 8. Permissions Ruko requests, and the reason shown to the user

Every permission is requested in context with an explanation first, never by
dumping the user into Settings (build prompt §24).

| Permission | Type | Why the user is told |
| --- | --- | --- |
| `RECORD_AUDIO` | runtime | "Used to detect manipulation during protected sessions." |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` | normal | Keeps the protected session alive and visible. |
| `POST_NOTIFICATIONS` | runtime | Shows the session notice and urgent warnings. |
| `READ_PHONE_STATE` | runtime | "Used to know when you are on a call, so protection can start." |
| `SYSTEM_ALERT_WINDOW` | special | "Used to warn you over the payment screen before you confirm." |
| `BIND_NOTIFICATION_LISTENER_SERVICE` | special | "Used to identify suspicious payment-related messages." |
| `BIND_ACCESSIBILITY_SERVICE` | special | "Used to understand payment context and protect you before confirmation." |
| `INTERNET` | normal | Guardian relay only. Core protection never needs it. |

Deliberately **not** requested: `READ_CALL_LOG`, `READ_CONTACTS`,
`READ_SMS`, location, `PACKAGE_USAGE_STATS`.

---

## 9. Offline guarantee

Core protection has no network dependency. Verify it, do not assert it:

```bash
adb shell svc wifi disable && adb shell svc data disable
# run the full critical scenario end to end
adb shell svc wifi enable
```

Expected: ASR, classification, risk scoring and intervention all still work; the
Guardian tile reads `OFFLINE`; the phone stays protected. This is a required
line item in the demo script, and it is the fastest way to prove to a judge that
the intelligence is genuinely local.

---

## 10. Open verification tasks

Ordered by how much of the plan collapses if the answer is bad.

| # | Task | Blocks | Status |
| --- | --- | --- | --- |
| 1 | Install Android SDK (API 36) + build tools on the dev machine | all Android work | ⬜ |
| 2 | Run `scripts/probe-device.sh` against the iQOO 15 | §1, §6, §7 | ⬜ |
| 3 | Measure whether mic capture yields audio during an active call | §2.1, demo shape | ⬜ |
| 4 | Confirm foreground mic service survives 10 min with screen off | §7 | ⬜ |
| 5 | Measure CPU classifier latency; only then attempt GPU/QNN | §6 | ⬜ |
| 6 | Confirm overlay draws above the payment screen | §3 | ⬜ |
| 7 | Run the offline test in §9 | offline claim | ⬜ |

Tick a row only when the evidence is in `docs/device-report.md` or a commit.
