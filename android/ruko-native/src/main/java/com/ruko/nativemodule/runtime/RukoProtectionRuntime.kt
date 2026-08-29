package com.ruko.nativemodule.runtime

import android.content.Context
import com.ruko.core.PayeeHasher
import com.ruko.nativemodule.accessibility.RukoAccessibilityService
import com.ruko.nativemodule.audio.AudioSessionManager
import com.ruko.nativemodule.monitoring.RukoForegroundService
import com.ruko.nativemodule.payment.AccessibilityPaymentProvider
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The single owner of a protected session in this process.
 *
 * Before this existed there were three independent microphone owners — the
 * React Native bridge, the engineering screen and (in intent only) the harness —
 * and the harness's "Start protection" started just the foreground *notification*,
 * never the microphone and never the accessibility provider. That is precisely
 * why enabling accessibility changed nothing and the green dot appeared with no
 * audio behind it (Puneesh brief §2, §3).
 *
 * Everything now goes through here, so the process has exactly one microphone,
 * one attached [AccessibilityPaymentProvider], and one authoritative answer to
 * "is a session live?". The foreground service provides the visible, un-swipeable
 * notification; this runtime owns the capture that notification promises.
 */
object RukoProtectionRuntime {

    private val sessionActive = AtomicBoolean(false)

    private var appContext: Context? = null
    private var payeeSalt: ByteArray? = null

    private var accessibilityProvider: AccessibilityPaymentProvider? = null
    private var audioSession: AudioSessionManager? = null

    /** Forwarded to the current owner (harness or RN bridge). All optional. */
    var onSpeechSegment: ((pcm: ShortArray, durationMs: Int) -> Unit)? = null
    var onError: ((code: String, message: String) -> Unit)? = null
    var onAllSilentDuringCall: (() -> Unit)? = null

    /** Idempotent. Builds the shared components once, bound to the app context. */
    @Synchronized
    fun ensureInitialised(context: Context) {
        if (appContext != null) return
        val app = context.applicationContext
        appContext = app

        val salt = loadOrCreateSalt(app)
        payeeSalt = salt

        accessibilityProvider = AccessibilityPaymentProvider { payeeId ->
            PayeeHasher.hash(payeeId, salt)
        }

        audioSession = AudioSessionManager(app).apply {
            onError = { code, message -> this@RukoProtectionRuntime.onError?.invoke(code, message) }
            onAllSilentDuringCall = { this@RukoProtectionRuntime.onAllSilentDuringCall?.invoke() }
        }
    }

    /** The one payment provider the accessibility service reads into. */
    fun paymentProvider(context: Context): AccessibilityPaymentProvider {
        ensureInitialised(context)
        return accessibilityProvider!!
    }

    /** The one microphone owner, shared by the protection session and diagnostics. */
    fun audio(context: Context): AudioSessionManager {
        ensureInitialised(context)
        return audioSession!!
    }

    /** Whether a protected session is genuinely live right now. */
    val isRunning: Boolean get() = sessionActive.get()

    /** Live frame level in dBFS, for the engineering screen. */
    val lastLevelDb: Double get() = audioSession?.lastLevelDb ?: -80.0

    /** Current adaptive noise floor in dBFS, for the engineering screen. */
    val noiseFloorDb: Double get() = audioSession?.noiseFloorDb ?: -80.0

    /**
     * Start a full protected session: the visible foreground service, the
     * accessibility provider attached, and the microphone actually capturing.
     *
     * Must be called while the app is visible — Android 14 refuses a
     * microphone-type foreground service started from the background.
     *
     * @return null on success, or a human-readable reason the session did not
     *   start (already surfaced by [onError] when it is a microphone failure).
     */
    @Synchronized
    fun start(context: Context): String? {
        ensureInitialised(context)
        if (sessionActive.get()) return null

        val refusal = RukoForegroundService.start(context)
        if (refusal != null) return refusal

        RukoAccessibilityService.attach(accessibilityProvider!!)

        val started = audioSession!!.start { pcm, durationMs ->
            onSpeechSegment?.invoke(pcm, durationMs)
        }
        if (!started) {
            // The mic refused (permission or device). Undo the visible parts so
            // we do not show a protection notification over a dead session.
            RukoAccessibilityService.detach()
            RukoForegroundService.stop(context)
            return "The microphone could not start."
        }

        sessionActive.set(true)
        return null
    }

    /** UI-initiated stop: tears down the mic, the provider and the service. */
    @Synchronized
    fun stop(context: Context) {
        if (!sessionActive.compareAndSet(true, false)) {
            // Even if we think nothing is live, make the visible state honest.
            RukoForegroundService.stop(context)
            return
        }
        audioSession?.stop()
        RukoAccessibilityService.detach()
        RukoForegroundService.stop(context)
    }

    /**
     * Called by [RukoForegroundService] when its own Stop action fires. Releases
     * the capture without asking the service to stop again (it already is).
     */
    @Synchronized
    fun onForegroundServiceStopped() {
        if (!sessionActive.compareAndSet(true, false)) return
        audioSession?.stop()
        RukoAccessibilityService.detach()
    }

    private fun loadOrCreateSalt(context: Context): ByteArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
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

    private const val PREFS = "ruko_native"
    private const val KEY_SALT = "payee_salt"
    private const val SALT_BYTES = 32
}
