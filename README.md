# Ruko

**Fraud systems ask whether a transaction is suspicious. Ruko asks whether the
person is being manipulated into making it.**

A user can be on their own phone, in their own UPI app, correctly
authenticated, entering their own PIN, voluntarily approving a payment — and
still be getting scammed. Every fraud check in the country passes, because the
attack was never on the device. It was on the person.

Ruko is an on-device safety layer that reads the *context around* a payment and
interrupts before the money moves.

---

## What it does

| | |
|---|---|
| **Reads the payment** | An accessibility service reads the amount and recipient off the confirmation screen of a UPI app it was not built for. |
| **Reads the pressure** | A quantised MiniLM classifier scores six manipulation patterns — authority, urgency, secrecy, threat, isolation, reward — in speech during a call or in message notifications. On-device, via NNAPI, in ~30 ms. |
| **Interrupts** | An overlay is drawn over the payment app, naming the amount, the recipient and the specific reason. The payment app stays alive underneath, so nothing is lost if the user continues. |
| **Escalates** | Over a limit a trusted contact sets, the payment stops and waits for their decision rather than the user's. |

### The two rules that shape everything

**The AI never decides.** A model scores language; a deterministic engine
decides. `signal × weight × gate`, every point traceable to a named reason,
each evidence family capped so none can carry a verdict alone. A model that
hallucinates a reason is a model that blocks a real payment on a made-up one,
so the part that can be wrong is kept away from the part that acts.

**Nothing leaves the phone.** Audio is processed in memory for one short window
and discarded. Notification text is redacted to a bounded excerpt with numbers
and links stripped *before* it is stored. What reaches a guardian is the
amount, the recipient and the reasons — never the conversation.

---

## The spend gate

A ₹7,878 top-up to a game store scored **10/100 SAFE**, and the score was
right: no caller, no messages, no speech, a first-time payee. Nothing about it
was deceptive.

That verdict is correct about manipulation and useless to the parent whose
child just spent ₹7,878. The harm there is the amount, not the lie, and no
amount of evidence-weighing produces a high score for a payment where nothing
suspicious was said.

So the limit is a **gate, not a signal**. It adds no points and cannot be
outvoted by an otherwise clean assessment. Below it (₹499 by default) ordinary
spending is completely unimpeded; at or above it the payment stops and waits
for a trusted contact.

---

## Repository layout

```
mobile/            React Native app — screens, state, risk engine, agent, tools
android/ruko-core  Pure Kotlin/JVM: every decision needing no Android API
android/ruko-native  Accessibility service, notification listener, overlay, RN bridge
android/paynow     PayNow — a standalone demo UPI wallet (see below)
guardian/          Guardian web console (Next.js)
backend/           FastAPI proxy holding the Sarvam and Anthropic keys
ml/                Datasets, training, evaluation, export, benchmarks
docs/contracts/    Shared TypeScript interfaces — the only coupling between modules
web/               Landing page and APK downloads
scripts/           demo.sh, grant-ruko.sh, preflight.py
```

### PayNow, and why it is a separate app

`android/paynow` is a working UPI wallet that shares **no module, no broadcast
and no private channel** with Ruko. It draws a payment screen and posts
ordinary message notifications, exactly as any wallet does; Ruko has to read it
through the accessibility tree and the notification listener the same way it
would read PhonePe.

A demo whose two halves are wired together proves nothing about whether the
detection works.

---

## Running it

Requires JDK 17 and an Android SDK.

```bash
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

```bash
# Build
cd mobile/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
cd android        && ./gradlew :paynow:assembleRelease

# Whole demo, one command: installs, grants, plays a scam, makes the payment
bash scripts/demo.sh            # bank-impersonation KYC scam
bash scripts/demo.sh grooming   # grooming into sextortion
bash scripts/demo.sh game       # a child's repeated game top-ups

# Check every cloud seam before demoing
python3 scripts/preflight.py
```

### Permissions, and what each one buys

| Permission | Without it |
|---|---|
| **Accessibility service** | Ruko never sees a payment. Non-negotiable. |
| **Display over other apps** | It can detect but never interrupt. |
| Notification access | Loses the message evidence family. |
| Microphone | Loses live call analysis. |
| Phone state | Loses "a call is active during this payment". |

Two traps worth knowing: reinstalling Ruko **clears its accessibility grant**,
and force-stopping it **kills the accessibility service without rebinding**. In
both cases Ruko keeps running and looks fine while seeing nothing. Re-run
`scripts/grant-ruko.sh` after either.

---

## Testing

```bash
cd mobile  && npm test                       # risk engine, agent, tools, adapters
cd android && ./gradlew :ruko-core:test      # parser and pure decision logic
```

`PayNowScreenParserTest` pins the parser against PayNow's exact on-screen text,
including that a completed-payment receipt is correctly *refused* as a live
payment.

---

## What is not built

Stated plainly, because a README that overclaims is worse than a short one.

- The guardian's approve/deny decision exists in the mobile app; the web
  console currently only acknowledges.
- Speech capture runs only during an active protected session, not
  continuously.
- Ruko cannot cancel a payment at the rails. It takes the screen, states the
  reason, and requires a deliberate second action. The UI says so.

## Team

| | |
|---|---|
| Aishwarya Tripathi | Mobile app, UI, state, integration |
| Vedant Beriwal | Model, risk engine, agent, evidence tools |
| Puneesh Gulati | Android native layer, guardian console, backend |

Built for the iQOO Hackathon.
