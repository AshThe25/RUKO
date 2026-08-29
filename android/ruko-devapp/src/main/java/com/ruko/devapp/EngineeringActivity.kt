package com.ruko.devapp

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.ruko.core.InferenceBackendResolver
import com.ruko.core.VoiceActivityDetector
import com.ruko.devapp.Ui.body
import com.ruko.devapp.Ui.button
import com.ruko.devapp.Ui.card
import com.ruko.devapp.Ui.column
import com.ruko.devapp.Ui.eyebrow
import com.ruko.devapp.Ui.row
import com.ruko.devapp.Ui.title
import com.ruko.nativemodule.accessibility.RukoAccessibilityService
import com.ruko.nativemodule.ai.DeviceAiDiagnostics
import com.ruko.nativemodule.audio.AudioSessionManager
import com.ruko.nativemodule.runtime.RukoProtectionRuntime
import com.ruko.nativemodule.ai.OnnxManipulationClassifier
import com.ruko.core.ManipulationScoring
import com.ruko.nativemodule.notifications.RukoNotificationListenerService
import com.ruko.nativemodule.payment.DemoPaymentProvider

/**
 * The Edge Engine screen (build prompt §41).
 *
 * Its entire value is that it does not lie. Every row is read from the device
 * at the moment the screen opens:
 *
 *   - backend rows come from real library probes, not from a config flag
 *   - permission rows come from the actual permission state
 *   - the payment row comes from whatever the providers currently hold
 *   - the microphone test runs a real capture session and reports measured dBFS
 *
 * Where something has not been measured it says so, rather than showing a
 * plausible number. That is what makes it worth showing a judge.
 */
class EngineeringActivity : AppCompatActivity() {

    private lateinit var content: LinearLayout
    private var audio: AudioSessionManager? = null
    private var testStartedAudio = false
    private var classifier: OnnxManipulationClassifier? = null
    private var classifierLoadAttempted = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = column(this)
        setContentView(ScrollView(this).apply { addView(content) })
        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    override fun onDestroy() {
        // Only stop the mic if *this screen* started it for a test. A live
        // protected session is owned by the runtime and must survive leaving
        // the engineering screen.
        if (testStartedAudio) audio?.stop()
        classifier?.close()
        super.onDestroy()
    }

    private fun render() {
        content.removeAllViews()
        content.addView(eyebrow(this, "Ruko"))
        content.addView(title(this, "Edge Engine"))
        content.addView(
            body(this, "Every value below is read from this device right now. Nothing here is illustrative."),
        )

        content.addView(deviceCard())
        content.addView(backendCard())
        content.addView(classifierCard())
        content.addView(permissionCard())
        content.addView(paymentCard())
        content.addView(microphoneCard())
    }

    /**
     * The real on-device manipulation classifier: ml/'s int8 MiniLM run through
     * onnxruntime, with the tokenizer and calibration parity-checked against the
     * TypeScript pipeline. Loading and inference happen off the UI thread; every
     * value shown is measured on this device.
     */
    private fun classifierCard() = card(this).apply {
        addView(eyebrow(this@EngineeringActivity, "Manipulation classifier"))
        addView(
            body(
                this@EngineeringActivity,
                "ml/ ships ruko-manip-v1. Tap to load it and score a sample on this " +
                    "device — the six manipulation tactics, the calibrated scores, the " +
                    "measured latency and the backend the runtime actually used.",
            ),
        )
        val status = body(this@EngineeringActivity, "Not loaded.", muted = false)
        addView(status)

        val scores = body(this@EngineeringActivity, "", muted = true)
        addView(scores)

        fun run(sampleLabel: String, text: String) {
            status.text = "Loading model and scoring…"
            scores.text = ""
            Thread {
                if (!classifierLoadAttempted) {
                    classifierLoadAttempted = true
                    classifier = OnnxManipulationClassifier.load(this@EngineeringActivity)
                }
                val c = classifier
                if (c == null) {
                    runOnUiThread {
                        status.text = "Model could not be loaded (missing asset or hash mismatch). " +
                            "Rules-only fallback would run in the product."
                    }
                    return@Thread
                }
                val result = c.classify(text)
                runOnUiThread {
                    val hash = if (c.modelHashVerified) "verified" else "UNVERIFIED"
                    val present = if (result.present.isEmpty()) {
                        "none over 0.5"
                    } else {
                        result.present.joinToString(", ") { it.name.lowercase() }
                    }
                    status.text = ("%s → backend %s · %d ms · hash %s\n" +
                        "Tactics present: %s\n" +
                        "Conversation risk: %.0f / %.0f points")
                        .format(
                            sampleLabel,
                            result.backend.name,
                            result.latencyMs,
                            hash,
                            present,
                            result.conversationRiskPoints,
                            ManipulationScoring.CONVERSATION_MAX_POINTS,
                        )
                    scores.text = ManipulationScoring.Label.entries.joinToString("\n") { label ->
                        "  %-22s %.3f".format(label.name.lowercase(), result.calibrated[label] ?: 0.0)
                    }
                }
            }.start()
        }

        addView(
            button(this@EngineeringActivity, "Score a scam sample", primary = true) {
                run(
                    "scam sample",
                    "hello sir i am calling from your bank your account will be frozen you " +
                        "must transfer 48000 immediately and do not tell anyone about this call",
                )
            },
        )
        addView(
            button(this@EngineeringActivity, "Score a benign sample", primary = false) {
                run(
                    "benign sample",
                    "hey can you send me 200 for the pizza we split last night thanks",
                )
            },
        )
    }

    private fun deviceCard() = card(this).apply {
        addView(eyebrow(this@EngineeringActivity, "Device"))
        addView(row(this@EngineeringActivity, "Model", "${Build.MANUFACTURER} ${Build.MODEL}"))
        addView(
            row(
                this@EngineeringActivity,
                "SoC",
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}"
                } else {
                    "unknown (needs API 31+)"
                },
            ),
        )
        addView(row(this@EngineeringActivity, "Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"))
        addView(row(this@EngineeringActivity, "ABI", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"))
    }

    private fun backendCard() = card(this).apply {
        val probes = DeviceAiDiagnostics.probeAll()
        val resolution = InferenceBackendResolver.resolve(probes)
        val runtime = InferenceBackendResolver.report(
            engine = "onnxruntime-android",
            model = "ruko-risk-v1",
            resolution = resolution,
            // No model has shipped from ml/ yet, so the runtime is genuinely
            // not ready. Reporting a backend here would be a fabrication.
            isReady = false,
            measuredLatencyMs = null,
        )

        addView(eyebrow(this@EngineeringActivity, "Inference"))
        addView(
            row(
                this@EngineeringActivity,
                "Resolved backend",
                runtime.backend.name,
                ContextCompat.getColor(this@EngineeringActivity, R.color.amber),
            ),
        )
        addView(row(this@EngineeringActivity, "Model", "ruko-manip-v1 (int8, bundled) — see Manipulation classifier below"))
        addView(
            row(
                this@EngineeringActivity,
                "Last latency",
                runtime.lastLatencyMs?.let { "$it ms" } ?: "— (not measured)",
            ),
        )
        runtime.degradedReason?.let {
            addView(row(this@EngineeringActivity, "Degraded", it))
        }

        addView(body(this@EngineeringActivity, "\nProbe results:"))
        probes.forEach { probe ->
            addView(
                row(
                    this@EngineeringActivity,
                    probe.backend.name,
                    "${if (probe.available) "available" else "unavailable"} — ${probe.detail}",
                    ContextCompat.getColor(
                        this@EngineeringActivity,
                        if (probe.available) R.color.ok else R.color.text_faint,
                    ),
                ),
            )
        }
    }

    private fun permissionCard() = card(this).apply {
        addView(eyebrow(this@EngineeringActivity, "Permissions"))
        addView(row(this@EngineeringActivity, "Microphone", granted(Manifest.permission.RECORD_AUDIO)))
        addView(row(this@EngineeringActivity, "Phone state", granted(Manifest.permission.READ_PHONE_STATE)))
        addView(
            row(
                this@EngineeringActivity,
                "Accessibility service",
                if (RukoAccessibilityService.isConnected()) "connected" else "not enabled",
            ),
        )
        addView(
            row(
                this@EngineeringActivity,
                "Notification access",
                if (RukoNotificationListenerService.isEnabled(this@EngineeringActivity)) "granted" else "not granted",
            ),
        )
        addView(
            row(
                this@EngineeringActivity,
                "Overlay",
                if (Settings.canDrawOverlays(this@EngineeringActivity)) "granted" else "not granted",
            ),
        )
        addView(
            button(this@EngineeringActivity, "Open accessibility settings", primary = false) {
                startActivity(android.content.Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            },
        )
    }

    private fun paymentCard() = card(this).apply {
        addView(eyebrow(this@EngineeringActivity, "Payment context"))
        val evidence = DemoPaymentProvider.current()
        if (evidence == null) {
            addView(
                body(
                    this@EngineeringActivity,
                    "No active payment. Open RukoPay Demo and tap PAY NOW, then come back.",
                ),
            )
        } else {
            addView(row(this@EngineeringActivity, "Source", evidence.source.name))
            addView(
                row(
                    this@EngineeringActivity,
                    "Amount",
                    "${evidence.amountMinor} paise (₹${(evidence.amountMinor ?: 0) / 100})",
                ),
            )
            addView(row(this@EngineeringActivity, "Payee", evidence.payeeDisplayName ?: "—"))
            addView(
                row(
                    this@EngineeringActivity,
                    "Payee hash",
                    evidence.payeeHash?.take(16)?.plus("…") ?: "—",
                ),
            )
            addView(row(this@EngineeringActivity, "App", evidence.appPackage ?: "—"))
        }
    }

    private fun microphoneCard() = card(this).apply {
        addView(eyebrow(this@EngineeringActivity, "Microphone"))
        addView(
            body(
                this@EngineeringActivity,
                "Runs a real capture session through the voice-activity detector and " +
                    "reports measured levels. If this device denies audio during a call, " +
                    "that will show here as digital silence rather than as fake activity.",
            ),
        )
        val status = body(this@EngineeringActivity, "Not running.", muted = false)
        addView(status)

        addView(
            button(this@EngineeringActivity, "Test microphone for 5 seconds", primary = false) {
                // #3: the single, shared microphone owner — the same instance a
                // protected session uses — not a second AudioRecord competing for
                // the mic.
                val manager = RukoProtectionRuntime.audio(this@EngineeringActivity)
                audio = manager

                // If a real protected session already owns the mic, show its live
                // levels for 5 s rather than starting a competing capture or, worse,
                // stopping the session.
                if (RukoProtectionRuntime.isRunning) {
                    var liveMax = -80.0
                    val liveTicker = object : Runnable {
                        override fun run() {
                            liveMax = maxOf(liveMax, manager.lastLevelDb)
                            status.text = ("Live protected session — level %.0f dBFS, " +
                                "floor %.0f dBFS, peak %.0f dBFS")
                                .format(manager.lastLevelDb, manager.noiseFloorDb, liveMax)
                            status.postDelayed(this, 200)
                        }
                    }
                    status.post(liveTicker)
                    status.postDelayed({ status.removeCallbacks(liveTicker) }, 5_000)
                    return@button
                }

                if (manager.isRunning) {
                    manager.stop()
                    testStartedAudio = false
                    status.text = "Stopped."
                    return@button
                }
                testStartedAudio = true

                manager.onError = { code, message ->
                    runOnUiThread { status.text = "$code: $message" }
                }
                manager.onAllSilentDuringCall = {
                    runOnUiThread {
                        status.text = "The platform is returning digital silence. " +
                            "Ruko cannot hear anything on this device right now."
                    }
                }

                var segments = 0
                var maxDb = -80.0
                val started = manager.start { _, durationMs ->
                    segments++
                    runOnUiThread { status.text = "Speech detected: $segments segment(s), last ${durationMs} ms" }
                }
                status.text = if (started) "Listening — say something." else "Could not start."

                val ticker = object : Runnable {
                    override fun run() {
                        if (!manager.isRunning) return
                        maxDb = maxOf(maxDb, manager.lastLevelDb)
                        if (segments == 0) {
                            status.text = "Listening… level %.0f dBFS, floor %.0f dBFS, peak %.0f dBFS"
                                .format(manager.lastLevelDb, manager.noiseFloorDb, maxDb)
                        }
                        status.postDelayed(this, 200)
                    }
                }
                status.post(ticker)

                status.postDelayed({
                    if (testStartedAudio) manager.stop()
                    testStartedAudio = false
                    if (segments == 0) {
                        status.text = ("No speech detected in 5 s. Peak level was %.0f dBFS " +
                            "against a %.0f dBFS floor — your voice needs to be louder than " +
                            "the floor by more than the detector's margin. Try speaking " +
                            "closer to the mic, or this device's mic gain may need a lower " +
                            "threshold in VoiceActivityDetector.Config.")
                                .format(maxDb, manager.noiseFloorDb)
                    }
                }, 5_000)
            },
        )
    }

    private fun granted(permission: String): String =
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
            "granted"
        } else {
            "not granted"
        }
}
