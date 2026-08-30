# Running the Ruko demo

Verified end to end on the iQOO 15 (I2501, Android 16, 1440×3168) on 2026-08-30.
The overlay was watched appearing over a live PayNow payment — see §4.

## 1. Build and install both apps

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/android-sdk"

cd android && ./gradlew :paynow:assembleRelease
adb install -r paynow/build/outputs/apk/release/paynow-release.apk

cd ../mobile/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

JDK 21, not 17 — 17 is not installed on this machine and both builds are fine
on 21. `mobile/android/local.properties` must point at `~/android-sdk`; the
Homebrew command-line-tools directory has no `platforms/` and the build fails
against it.

## 2. Grant permissions — every time you reinstall

```bash
./scripts/grant-ruko.sh
```

Two grants do **not** survive a reinstall, and both fail silently:

- **Accessibility** is dropped. Without it Ruko never sees a payment.
- **The notification listener is left allowed but unbound.** The setting still
  lists the service while nothing is connected, which looks exactly like a code
  bug. Only a `disallow_listener` / `allow_listener` cycle rebinds it — the
  script does this.

Do not force-stop Ruko mid-demo: it kills the accessibility service and it does
not rebind.

## 3. Drive it

1. Open **Ruko** once and leave protection on.
2. Open **PayNow** → tap the **KYC Verification Desk** chat.
3. Let the script play (~15s). It posts real system notifications; Ruko reads
   and scores each one.
4. Tap the **kyc.verify9931@ybl** link in the message — it is a live pay link
   and opens the payment screen prefilled with ₹500, which is how the attack
   actually arrives.
5. **Proceed to Pay** → **Pay ₹500**.

Watch the chain:

```bash
adb logcat -c && adb logcat | grep -E "RukoA11y|RukoPay|RukoNotif|RukoBridge"
```

## 4. What you should see

```
RukoNotif: kept from com.ruko.paynow suspicion=0.55 patterns=[account-freeze threat, deadline pressure]
RukoPay  : parsed usable=true amount=50000 conf=1.0
RukoPay  : announcing payment amount=50000 listener=true
RukoBridge: emit -> JS: ruko:onPaymentDetected
RukoNotif: getNotificationContext -> matches=4 suspicion=0.55
```

Then, over the payment app: **"Wait — check this before you pay."** with
*Don't send this money* / *Continue anyway*.

Score **66/100 · PRESSURE**, from three evidence families:

| Family | Signal | Points |
| --- | --- | --- |
| CONVERSATION | coercion 96%, authority 81%, credential request 92% | ~49 |
| PAYEE_BEHAVIOUR | never paid this recipient | 10 |
| NOTIFICATION | 4 messages using financial pressure language | 1.7 |

Nothing on that screen is hardcoded. The percentages are `ruko-manip-v1` running
on NNAPI in ~24 ms, the score is `ruko-weights-v1` arithmetic over evidence that
was actually gathered, and the Engineering screen reports the backend the runtime
returned.

## 5. Known limits — say these out loud rather than hiding them

- **The conversation family is currently read from message text, not speech.**
  Live-call ASR is not shipping, so with no call the model reads the redacted
  notification excerpts instead. The UI says "In your messages:" and the reasons
  say "these messages", never "the caller".
- Behaviour/history is a stub, so amount-anomaly reports "not enough history yet"
  rather than a number. The app says so on the home screen.
- The guardian console UI is not built. Guardian shows Offline.
