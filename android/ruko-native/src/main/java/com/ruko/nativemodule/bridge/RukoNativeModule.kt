package com.ruko.nativemodule.bridge

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.ruko.core.InferenceBackendResolver
import com.ruko.core.NativeErrorCode
import com.ruko.core.PayeeHasher
import com.ruko.core.ProtectionSessionMachine
import com.ruko.nativemodule.accessibility.RukoAccessibilityService
import com.ruko.nativemodule.ai.DeviceAiDiagnostics
import com.ruko.nativemodule.audio.AudioSessionManager
import com.ruko.nativemodule.call.CallContextProvider
import com.ruko.nativemodule.monitoring.RukoForegroundService
import com.ruko.nativemodule.notifications.RukoNotificationListenerService
import com.ruko.nativemodule.payment.AccessibilityPaymentProvider
import com.ruko.nativemodule.payment.DemoPaymentProvider
import com.ruko.nativemodule.payment.LayeredPaymentContextProvider
import java.security.SecureRandom

/**
 * The single door between React Native and the Android layer.
 *
 * Kept deliberately narrow (Puneesh brief §1: "Do not expose unnecessary
 * native internals"). JS can start and stop a protected session, ask what the
 * current context is, and read diagnostics. It cannot reach the microphone, the
 * accessibility tree, or the notification buffer directly.
 *
 * The state machine that decides what should be running lives in `ruko-core`
 * and is unit tested; this class applies its demands to real Android services.
 */
class RukoNativeModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private val machine = ProtectionSessionMachine()

    private val payeeSalt: ByteArray by lazy { loadOrCreateSalt() }

    private val accessibilityPayments = AccessibilityPaymentProvider { payeeId ->
        PayeeHasher.hash(payeeId, payeeSalt)
    }

    private val payments = LayeredPaymentContextProvider(
        listOf(accessibilityPayments, DemoPaymentProvider),
    )

    private val calls = CallContextProvider(reactContext).apply {
        onCallStateChanged = { active ->
            apply(
                machine.on(
                    if (active) {
                        ProtectionSessionMachine.Signal.CallStarted
                    } else {
                        ProtectionSessionMachine.Signal.CallEnded
                    },
                ),
            )
            emit(EVENT_CALL_STATE, Arguments.createMap().apply { putBoolean("active", active) })
        }
    }

    private val audio = AudioSessionManager(reactContext).apply {
        onError = { code, message -> emitError(code, message, recoverable = true) }
        onAllSilentDuringCall = {
            // The platform is handing us zeros. Say so rather than appearing to
            // listen. See docs/android-capabilities.md §2.1.
            emitError(
                NativeErrorCode.AUDIO_SILENT_DURING_CALL,
                "This device is not giving Ruko microphone audio during the call.",
                recoverable = true,
            )
        }
    }

    @Volatile
    private var lastMeasuredLatencyMs: Long? = null

    // ---------------------------------------------------------------- session

    @ReactMethod
    fun startProtection(promise: Promise) {
        // Must be called while the app is visible: Android 14 refuses a
        // microphone foreground service started from the background.
        val refusal = RukoForegroundService.start(reactContext)
        if (refusal != null) {
            promise.reject(NativeErrorCode.FGS_START_NOT_ALLOWED, refusal)
            return
        }

        RukoAccessibilityService.attach(accessibilityPayments)
        calls.start()
        apply(machine.on(ProtectionSessionMachine.Signal.ProtectionEnabled))
        promise.resolve(stateMap())
    }

    @ReactMethod
    fun stopProtection(promise: Promise) {
        apply(machine.on(ProtectionSessionMachine.Signal.ProtectionDisabled))
        calls.stop()
        RukoAccessibilityService.detach()
        RukoNotificationListenerService.clear()
        RukoForegroundService.stop(reactContext)
        promise.resolve(stateMap())
    }

    @ReactMethod
    fun getProtectionState(promise: Promise) = promise.resolve(stateMap())

    /**
     * Signals from the JS layer that change what should be running.
     *
     * Deliberately not a generic setState: only the signals the state machine
     * understands are accepted, and an unknown one is an error rather than a
     * silent no-op.
     */
    @ReactMethod
    fun signal(name: String, promise: Promise) {
        val signal = when (name) {
            "PAYMENT_SCREEN_DETECTED" -> ProtectionSessionMachine.Signal.PaymentScreenDetected
            "PAYMENT_SCREEN_DISMISSED" -> ProtectionSessionMachine.Signal.PaymentScreenDismissed
            "SUSPICIOUS_EVIDENCE" -> ProtectionSessionMachine.Signal.SuspiciousEvidence
            "INTERVENTION_DISMISSED" -> ProtectionSessionMachine.Signal.InterventionDismissed
            else -> {
                promise.reject(NativeErrorCode.NATIVE_INTERNAL_ERROR, "unknown signal $name")
                return
            }
        }
        apply(machine.on(signal))
        promise.resolve(stateMap())
    }

    // ---------------------------------------------------------------- context

    @ReactMethod
    fun getPaymentContext(promise: Promise) {
        val evidence = payments.current()
        if (evidence == null) {
            promise.resolve(null)
            return
        }
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("active", evidence.active)
                putDouble("amount", evidence.amount.toDouble())
                putString("currency", evidence.currency)
                putString("payee", evidence.payee)
                putString("payeeHash", evidence.payeeHash)
                putString("source", evidence.source.name)
                putString("packageName", evidence.packageName)
                putString("observedAt", evidence.observedAt)
            },
        )
    }

    @ReactMethod
    fun getCallContext(promise: Promise) {
        val evidence = calls.current()
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("active", evidence.active)
                putBoolean("callerKnown", evidence.callerKnown)
                putDouble("durationSeconds", evidence.durationSeconds.toDouble())
                putBoolean("audioFromMicrophone", evidence.audioFromMicrophone)
            },
        )
    }

    @ReactMethod
    fun getNotificationContext(promise: Promise) {
        if (!RukoNotificationListenerService.isEnabled(reactContext)) {
            promise.resolve(null)
            return
        }
        val evidence = RukoNotificationListenerService.evidence()
        promise.resolve(
            Arguments.createMap().apply {
                putDouble("suspicion", evidence.suspicion)
                putInt("matchCount", evidence.matchCount)
                putInt("lookbackMinutes", evidence.lookbackMinutes)
                putArray(
                    "excerpts",
                    Arguments.createArray().apply { evidence.excerpts.forEach { pushString(it) } },
                )
            },
        )
    }

    // ------------------------------------------------------------ diagnostics

    /**
     * Powers the Engineering screen.
     *
     * Reports what was probed and what is actually running — never an
     * aspiration. `lastLatencyMs` stays null until a real inference has been
     * measured, and the UI renders null as an em dash.
     */
    @ReactMethod
    fun getDeviceAIBackend(promise: Promise) {
        val probes = DeviceAiDiagnostics.probeAll()
        val resolution = InferenceBackendResolver.resolve(probes)
        val runtime = InferenceBackendResolver.report(
            engine = "onnxruntime-android",
            model = "ruko-risk-v1",
            resolution = resolution,
            // False until ml/ ships a model and it genuinely loads. Reporting
            // ready here would put a fabricated backend on the screen.
            isReady = false,
            measuredLatencyMs = lastMeasuredLatencyMs,
        )

        promise.resolve(
            Arguments.createMap().apply {
                putString("engine", runtime.engine)
                putString("model", runtime.model)
                putString("backend", runtime.backend.name)
                putBoolean("isLocal", runtime.isLocal)
                putBoolean("isReady", runtime.isReady)
                runtime.lastLatencyMs?.let { putDouble("lastLatencyMs", it.toDouble()) }
                    ?: putNull("lastLatencyMs")
                putString("degradedReason", runtime.degradedReason)
                putArray(
                    "probes",
                    Arguments.createArray().apply {
                        probes.forEach { probe ->
                            pushMap(
                                Arguments.createMap().apply {
                                    putString("backend", probe.backend.name)
                                    putBoolean("available", probe.available)
                                    putString("detail", probe.detail)
                                },
                            )
                        }
                    },
                )
            },
        )
    }

    /** Which permissions are actually granted. Drives the onboarding screen. */
    @ReactMethod
    fun getPermissionState(promise: Promise) {
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("microphone", audio.hasPermission())
                putBoolean("phoneState", calls.hasPermission())
                putBoolean("accessibility", RukoAccessibilityService.isConnected())
                putBoolean("notifications", RukoNotificationListenerService.isEnabled(reactContext))
                putBoolean("overlay", Settings.canDrawOverlays(reactContext))
                putBoolean("online", isOnline())
            },
        )
    }

    /**
     * Opens the right Settings page for a special permission.
     *
     * These three cannot be granted by a runtime dialog. The app explains why
     * first and then brings the user here — never a cold drop into Settings
     * (build prompt §24).
     */
    @ReactMethod
    fun openSettingsFor(permission: String, promise: Promise) {
        val action = when (permission) {
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "notifications" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
            "overlay" -> Settings.ACTION_MANAGE_OVERLAY_PERMISSION
            "battery" -> Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            else -> {
                promise.reject(NativeErrorCode.NATIVE_INTERNAL_ERROR, "unknown permission $permission")
                return
            }
        }
        runCatching {
            reactContext.startActivity(
                Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onFailure {
            promise.reject(NativeErrorCode.NATIVE_INTERNAL_ERROR, it.message ?: "could not open settings")
            return
        }
        promise.resolve(true)
    }

    // ------------------------------------------------------------------ demo

    /** Called by RukoPayDemo. Clearly labelled as the demo surface, not an interception. */
    @ReactMethod
    fun beginDemoPayment(amountRupees: Double, payee: String, payeeId: String, promise: Promise) {
        DemoPaymentProvider.beginPayment(
            amountRupees = amountRupees.toLong(),
            payee = payee,
            payeeHash = PayeeHasher.hash(payeeId, payeeSalt),
        )
        apply(machine.on(ProtectionSessionMachine.Signal.PaymentScreenDetected))
        promise.resolve(stateMap())
    }

    @ReactMethod
    fun endDemoPayment(promise: Promise) {
        DemoPaymentProvider.endPayment()
        apply(machine.on(ProtectionSessionMachine.Signal.PaymentScreenDismissed))
        promise.resolve(stateMap())
    }

    // RN requires these for NativeEventEmitter; the counting happens in JS.
    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Int) = Unit

    // -------------------------------------------------------------- internals

    /**
     * The one place Android services are switched on and off.
     *
     * Everything else asks the state machine what should be running; this
     * applies that answer. Keeping it in a single function is what stops the
     * microphone from being started in five places and stopped in three.
     */
    private fun apply(state: ProtectionSessionMachine.ProtectionState) {
        val demands = machine.demands()

        if (demands.microphoneActive && !audio.isRunning) {
            audio.start { pcm, durationMs ->
                emit(
                    EVENT_SPEECH,
                    Arguments.createMap().apply {
                        putInt("durationMs", durationMs)
                        putInt("sampleCount", pcm.size)
                        // The PCM itself never crosses the bridge. It goes to
                        // the local ASR in the native layer; JS gets the shape
                        // of the utterance, not its contents.
                    },
                )
            }
        } else if (!demands.microphoneActive && audio.isRunning) {
            audio.stop()
        }

        emit(EVENT_STATE, stateMap().apply { putString("state", state.name) })
    }

    private fun stateMap(): WritableMap {
        val demands = machine.demands()
        return Arguments.createMap().apply {
            putString("state", machine.state.name)
            putBoolean("microphoneActive", demands.microphoneActive)
            putBoolean("foregroundServiceActive", demands.foregroundServiceActive)
            putBoolean("screenWatchActive", demands.screenWatchActive)
            putBoolean("overlayVisible", demands.overlayVisible)
            putBoolean("guardianConnected", demands.guardianConnected)
            putString("paymentSource", payments.activeProvider()?.source?.name)
        }
    }

    private fun emit(event: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    private fun emitError(code: String, message: String, recoverable: Boolean) {
        emit(
            EVENT_ERROR,
            Arguments.createMap().apply {
                putString("code", code)
                putString("message", message)
                putBoolean("recoverable", recoverable)
            },
        )
    }

    private fun isOnline(): Boolean {
        val manager = reactContext.getSystemService(ConnectivityManager::class.java) ?: return false
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * A per-install random salt for payee hashing, in app-private storage.
     *
     * Without it, a bare SHA-256 of a UPI handle would be trivially reversible
     * by dictionary attack — the handle space is small and predictable.
     */
    private fun loadOrCreateSalt(): ByteArray {
        val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_SALT, null)
        if (existing != null) {
            return android.util.Base64.decode(existing, android.util.Base64.NO_WRAP)
        }
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        prefs.edit()
            .putString(KEY_SALT, android.util.Base64.encodeToString(salt, android.util.Base64.NO_WRAP))
            .apply()
        return salt
    }

    companion object {
        const val NAME = "RukoNative"

        const val EVENT_STATE = "ruko:onProtectionState"
        const val EVENT_SPEECH = "ruko:onSpeechSegment"
        const val EVENT_CALL_STATE = "ruko:onCallStateChanged"
        const val EVENT_ERROR = "ruko:onNativeError"

        private const val PREFS = "ruko_native"
        private const val KEY_SALT = "payee_salt"
        private const val SALT_BYTES = 32
    }
}
