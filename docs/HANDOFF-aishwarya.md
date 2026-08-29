# Handoff to Aishwarya — the 3 items that live in mobile/

Everything in Puneesh's `android/` layer (his 12-item list) is fixed on
`feature/vedant-integration`, and ml/'s model is integrated into the native
harness. Three items remain and they are all in **your** `mobile/` files, so
they are yours to apply — I did not touch them.

## #9 — Kotlin/TS bridge units (mobile/src/services/native/)
The Kotlin bridge already sends integer **paise** as `amountMinor` and a numeric
epoch-ms `observedAt` (see RukoNativeModule.kt). The TS adapter disagrees:

- `mobile/src/services/native/RukoNative.ts:40` — `observedAt: string` should be
  `number` (epoch ms).
- `mobile/src/services/native/nativeProviders.ts:90-92` — it reads `raw.amount`
  and does `Math.round(raw.amount * 100)`. Kotlin already sends `amountMinor` in
  paise, so this both reads the wrong field and multiplies again. Use
  `raw.amountMinor` directly; drop the `* 100`.

## #7 — wire the native module into the RN app (mobile/android/)
`mobile/android/` does not include Puneesh's Gradle projects. Add:
- in `settings.gradle`: include `:ruko-native` and `:ruko-core` (or depend on the
  published AAR).
- in `mobile/android/app/build.gradle`: `implementation project(':ruko-native')`.
- register `RukoNativePackage()` in `MainApplication`.

## #8 — minSdk (mobile/android/)
`mobile/android` is minSdk 24; `ruko-native` is minSdk 26. Raise the app to 26
(simplest) once the native module is included.

Once #7 lands, your RukoServices can swap the stubs for the real engines exactly
as INTEGRATION.md describes — my `evaluateRisk`, `RukoAgent`, and the classifier.
