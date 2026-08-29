# Ruko Android layer (`android/`)

**Owner: Puneesh.** Two Gradle modules:

| Module | What it is | Builds without the Android SDK? |
| --- | --- | --- |
| `ruko-core` | Pure Kotlin/JVM. Every decision the native layer makes. | **Yes** — 59 unit tests run anywhere. |
| `ruko-native` | Android library: services, runtime shells, the RN bridge. | No — needs the SDK. |

The split is the point. Everything that decides something — when the
microphone runs, whether a screen is a payment screen, whether a notification
is worth keeping, which compute backend is genuinely available — lives in
`ruko-core`, free of Android imports and tested on the JVM. `ruko-native` is
the thin shell that wires that logic to real Android APIs.

```bash
cd android && ./gradlew :ruko-core:test
```

`settings.gradle.kts` includes `:ruko-native` only when an Android SDK is
present, so the core tests stay runnable on any machine and in CI.

## ⚠️ Build status: `ruko-native` is written but NOT compiled

As of 2026-08-29 the build machine has no Android SDK (`ANDROID_HOME` unset,
no `~/Library/Android/sdk`) and no device attached. So:

- ✅ `ruko-core` compiles and its 59 tests pass.
- ❌ `ruko-native` has **never been compiled**, never run, and never been on a
  device.

Nothing in `ruko-native` should be described as working until that changes.
Tracked as task 1 in `docs/android-capabilities.md` §10.

## What is here

```
ruko-core/                          pure logic, unit tested
  VoiceActivityDetector             Tier-1 gate: only wake ASR on speech
  PaymentScreenParser               accessibility text -> amount + payee
  NotificationRelevanceFilter       filter, score and redact notifications
  InferenceBackendResolver          report the backend that actually loaded
  PayeeHasher                       salted payee pseudonyms
  ProtectionSessionMachine          what should be running right now

ruko-native/
  bridge/        RukoNativeModule, RukoNativePackage
  accessibility/ RukoAccessibilityService
  audio/         AudioSessionManager
  monitoring/    RukoForegroundService
  notifications/ RukoNotificationListenerService
  call/          CallContextProvider
  payment/       Accessibility / Demo / Mock providers + layering
  ai/            DeviceAiDiagnostics
```

## Integration surface for `mobile/` (Aishwarya)

Three changes, all in files Aishwarya owns. I have not touched them.

**1. `mobile/android/settings.gradle`**

```gradle
include ':ruko-core'
project(':ruko-core').projectDir = new File(rootProject.projectDir, '../../android/ruko-core')
include ':ruko-native'
project(':ruko-native').projectDir = new File(rootProject.projectDir, '../../android/ruko-native')
```

**2. `mobile/android/app/build.gradle`**

```gradle
implementation project(':ruko-native')
```

**3. `mobile/android/app/src/main/java/com/ruko/mobile/MainApplication.kt`**

```kotlin
packages.add(RukoNativePackage())
```

The module declares React Native as `compileOnly`, so it takes whatever RN
version `mobile/` is on rather than dragging in a second copy.

### The JS surface

Narrow on purpose. JS cannot reach the microphone, the accessibility tree or
the notification buffer directly.

| Method | Returns |
| --- | --- |
| `startProtection()` | protection state; rejects if a foreground service cannot start |
| `stopProtection()` | protection state |
| `getProtectionState()` | current state + what is running |
| `signal(name)` | applies a state-machine signal, returns the new state |
| `getPaymentContext()` | `PaymentEvidence` or null |
| `getCallContext()` | `CallEvidence` |
| `getNotificationContext()` | `NotificationEvidence` or null if not granted |
| `getDeviceAIBackend()` | runtime info + every backend probe and its reason |
| `getPermissionState()` | which permissions are actually granted |
| `openSettingsFor(name)` | opens the right Settings page |
| `beginDemoPayment(...)` / `endDemoPayment()` | RukoPayDemo hooks |

Events: `ruko:onProtectionState`, `ruko:onSpeechSegment`,
`ruko:onCallStateChanged`, `ruko:onNativeError`.

**Raw PCM never crosses the bridge.** `onSpeechSegment` carries the shape of an
utterance — duration and sample count — not its contents. Audio goes to the
local ASR inside the native layer and no further.

## Honesty rules this code enforces

These are the ones most likely to be quietly broken under demo pressure:

1. **`getDeviceAIBackend()` reports `isReady: false` today**, because ml/ has
   not shipped a model yet. It will report a backend when one genuinely loads
   and not before.
2. **Latency is null until measured.** The Engineering screen renders null as
   an em dash. There is a test for this in both Kotlin and TypeScript.
3. **NNAPI is reported unavailable on API 35+.** It is deprecated there and can
   fall back to a CPU reference driver that is *slower* than XNNPACK while
   sounding more impressive.
4. **A demo payment is labelled `DEMO`** (`EvidenceSource.DEMO`) everywhere it
   appears, including the audit trail. It is never presented as an intercepted
   UPI transaction.
5. **Digital silence during a call raises `AUDIO_SILENT_DURING_CALL`.** If the
   platform denies us capture, the UI says so instead of appearing to listen.
6. **`available = false` is not a measured zero.** An unreadable payment screen
   must never read as a safe payment. Every evidence block carries
   `available` + `source` + `unavailableReason`, per `common.schema.ts`.
7. **Money is integer paise everywhere.** `PaymentScreenParser` splits on the
   decimal point rather than going via a `Double`, because binary floating
   point cannot represent 0.10 exactly and a wrong amount on an intervention
   screen destroys trust in the whole product.

## Next on this module

1. Install the Android SDK and compile `ruko-native` for the first time.
2. Run `scripts/probe-device.sh` against the iQOO 15.
3. Measure whether mic capture survives an active call (§2.1 of the
   capabilities doc) — this is the highest-risk unknown in the project.
4. Build `RukoPayDemo` as a separate app module.
5. Overlay/intervention window, once the permission flow is agreed with
   Aishwarya's UI.
