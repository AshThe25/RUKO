# Ruko — session handoff

Everything a fresh session needs to continue. Written 2026-08-30.

Repo: `~/Projects/RUKO` · branch `main` · latest commit `232e4af`.
Push to `origin/main` (github.com/AshThe25/RUKO). Teammates push to the same
branch, so **always `git pull --rebase origin main` before pushing**.

House rule: **never add `Co-Authored-By` lines to commits.**

---

## 1. What Ruko is

An on-device Android app that detects social-engineering during calls and
messages and interrupts *before* a payment completes. Two apps are involved:

| Module | What it is |
|---|---|
| `mobile/` | The product. React Native 0.76.5 + TypeScript, Zustand, state-driven Router (not a nav library). Package `com.rukomobile`. |
| `android/ruko-core` | Pure Kotlin/JVM. Every decision that needs no Android API. Unit-tested on any machine. |
| `android/ruko-native` | Android library: accessibility service, notification listener, foreground service, RN bridge, overlay. |
| `android/paynow` | **PayNow** — a standalone demo UPI wallet. Package `com.ruko.paynow`. Shares *no code* with Ruko by design. |
| `web/` | Landing page + both APK downloads. |
| `backend/` | FastAPI proxy on Render holding Sarvam/Claude keys, verified by Supabase JWT. |

The risk engine is deterministic: `signal × weight × gate`. The AI never
decides. Weights version `ruko-weights-v1`.

---

## 2. Machine setup

```bash
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

JDK 17 is required. The `android/` project uses AGP 9.3 + Gradle 9;
`mobile/android/` uses the React Native Gradle plugin. They are separate
builds — `mobile/android/settings.gradle` includes `../../android/ruko-core`
and `ruko-native` by relative path.

---

## 3. Build and install

```bash
# Ruko (the product)
cd ~/Projects/RUKO/mobile/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
adb install -r app/build/outputs/apk/release/app-release.apk

# PayNow (the demo wallet)
cd ~/Projects/RUKO/android
./gradlew :paynow:assembleRelease --no-daemon
adb install -r paynow/build/outputs/apk/release/paynow-release.apk
```

Tests:
```bash
cd ~/Projects/RUKO/mobile && npx jest __tests__/nativeAdapters.test.ts   # 16 pass
cd ~/Projects/RUKO/android && ./gradlew :ruko-core:test --no-daemon
```

---

## 4. Permissions — and the two that actually matter

| Permission | Grants | Without it |
|---|---|---|
| **Accessibility service** | Reading the payment screen | Ruko never sees a payment. Non-negotiable. |
| **Display over other apps** | Drawing the warning over the UPI app | Detects but cannot interrupt — the product claim is lost |
| Notification access | Reading scam messages | Loses the notification evidence family |
| `RECORD_AUDIO` | Live call analysis | Loses the conversation family |
| `READ_PHONE_STATE` | Knowing a call is active during a payment | Loses "call during payment" |
| `POST_NOTIFICATIONS` | Ruko's own foreground-service notice | FGS cannot show its notice |

Grant all of them:
```bash
adb shell appops set com.rukomobile SYSTEM_ALERT_WINDOW allow
for p in RECORD_AUDIO READ_PHONE_STATE POST_NOTIFICATIONS READ_CONTACTS READ_CALL_LOG; do
  adb shell pm grant com.rukomobile android.permission.$p 2>/dev/null
done
adb shell settings put secure enabled_accessibility_services \
  "com.reskill.hacktracker/com.reskill.hacktracker.services.HackTrackerAccessibilityService:com.rukomobile/com.ruko.nativemodule.accessibility.RukoAccessibilityService"
adb shell settings put secure accessibility_enabled 1
adb shell cmd notification allow_listener \
  com.rukomobile/com.ruko.nativemodule.notifications.RukoNotificationListenerService
adb shell pm grant com.ruko.paynow android.permission.POST_NOTIFICATIONS
```

Verify accessibility is genuinely *bound*, not merely listed:
```bash
adb shell dumpsys accessibility | sed -n '/Bound services/,/Enabled services/p' | grep -o "label=Ruko[^,]*"
```

### Two gotchas that will waste an hour each
- **Reinstalling Ruko resets the accessibility grant.** Re-run the
  `settings put` after every `adb install`, then restart the app.
- **Force-stopping Ruko kills the accessibility service and it does not
  rebind.** Toggle the setting off/on to bring it back. Do not force-stop
  mid-demo.

---

## 5. Driving the demo on the iQOO (1440×3168)

```bash
adb shell am start -n com.ruko.paynow/.HomeActivity     # PayNow home
adb shell input tap 711 1338                            # "KYC Verification Desk" payee
adb shell input tap 717 1615                            # keypad 5
adb shell input tap 717 2631                            # keypad 0
adb shell input tap 717 2631                            # keypad 0   -> ₹500
adb shell input tap 717 2990                            # "Proceed to Pay"
```
Chats are below the payees: swipe up (`adb shell input swipe 720 2400 720 900 300`)
then tap `711 2278` for the KYC thread. It auto-plays ~15s and posts a real
system notification per incoming line.

PayNow's three scenarios: **KYC bank scam** (→ ₹500), **grooming/sextortion**
(→ ₹2000), and **child game top-up** (repeated ₹500 — caught by cumulative
spend, not by language).

Watch the chain:
```bash
adb logcat -c && adb logcat | grep -E "RukoA11y|RukoPay|RukoBridge"
```

---

## 6. Where things actually stand

### Verified working
The detection chain runs end to end:
```
RukoA11y: read 11 nodes from com.ruko.paynow
RukoPay : parsed usable=true amount=50000 conf=1.0
          signals=[keywords:..., currency-marked amount, upi id visible, payee name resolved]
RukoPay : announcing payment, listener=true
RukoBridge: emit -> JS: ruko:onPaymentDetected
```
JS receives it and starts an investigation. The investigation screen appears.

`PayNowScreenParserTest` (in `ruko-core`) pins the parser against PayNow's
exact screen text, including that the *receipt* screen is correctly refused
as a completed payment.

### THE NEXT BUG — start here
The investigation scores **00/100 SAFE** and so never interrupts. On the
investigation screen every evidence tool is empty:

- **Payment: "No payment in progress"** — about the very payment that just
  triggered the investigation. This is the main thread to pull.
- **Notifications: "No recent payment messages"** — despite 12 real
  notifications having been posted by PayNow.
- Recipient, Amount, Conversation: never ran.
- Footer: *"Evaluated in 0 ms from 0 evidence families"*.

So: the plumbing is connected, but the agent's evidence tools are not reading
from it. Likely suspects, in order:

1. `mobile/src/tools/` — the six evidence tools. Does the payment tool read
   `runtime.services.payment.current()`, and does that reach
   `LayeredPaymentContextProvider` on the native side?
2. `mobile/src/services/native/nativeProviders.ts` → `toPaymentEvidence`.
   Check `active`/`available` and the 15s staleness window in
   `AccessibilityPaymentProvider.freshReading()`. A plausible race: leaving
   the payment app calls `clear()`, wiping the reading mid-investigation.
3. `useProtectionController.onPaymentDetected` writes to `demo.bus`, but in a
   native build `services.payment` is the **native** provider and may never
   look at the bus. The detected payment may need passing to the agent
   directly rather than via the bus.
4. Notification evidence: `RukoNotificationListenerService` +
   `NotificationRelevanceFilter`. Verify the listener is delivering at all —
   it has no logging yet.

### Never yet observed
**The overlay has never appeared on screen.** `InterventionOverlay`
(`android/ruko-native/.../intervention/InterventionOverlay.kt`) is written and
compiles but has never been seen. `showIntervention` has never been called
from JS, because the score never reaches `BLOCK_WARNING`/`STRONG_WARNING`.
Do not claim the demo works until you have watched it appear.

Also unbuilt: the guardian approve/deny console UI.

---

## 7. Design decisions worth not undoing

- **The overlay is a window, not an activity.** Launching Ruko's own activity
  backgrounds the UPI app, which discards the pending payment — the user
  returns to an empty screen. `TYPE_APPLICATION_OVERLAY` leaves the payment
  where it was so "continue anyway" genuinely continues.
- **PayNow shares no code with Ruko.** No module, no broadcast, no private
  channel. It is allowlisted in `RukoAccessibilityService.PAYMENT_PACKAGES`
  exactly like PhonePe. A demo whose halves are wired together proves nothing.
- **PayNow's balance never depletes.** If a payment is stopped, it was stopped
  by Ruko, never by the demo wallet running short.
- **Payment watching must not require the microphone.** `startPaymentWatch`
  needs no mic and no foreground service. They were coupled once and it meant
  Ruko only watched for payments while already listening.
- **`startPaymentWatch` attaches unconditionally.** The provider is a static
  field, so attaching before the service is up is the correct order. Do not
  reintroduce an `isConnected()` guard that rejects.
- Amounts are integer paise everywhere. Never route money through a Double.
- New Architecture is **off** (`newArchEnabled=false`): `onnxruntime-react-native`
  and `react-native-fs` are old-arch only.
- `ndk { abiFilters 'arm64-v8a' }` keeps the APK at 48 MB instead of 129 MB.

---

## 8. Cleanup owed

The diagnostic `Log.i` calls in `RukoAccessibilityService`,
`AccessibilityPaymentProvider` and `RukoNativeModule.emit`/`showIntervention`
were added for this investigation. Keep them while debugging; decide before
final submission whether they stay.
