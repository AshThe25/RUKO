package com.ruko.nativemodule.payment

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.ruko.core.EvidenceSource
import com.ruko.core.PaymentEvidence
import com.ruko.core.PaymentScreenParser

/**
 * Reads the payment from whatever is on screen, via the accessibility service.
 *
 * This is the fragile path and it is built to admit that. It answers only when
 * [PaymentScreenParser] is confident enough to be useful; otherwise
 * [isAvailable] is false and [LayeredPaymentContextProvider] falls through to
 * the demo provider. It never guesses an amount.
 *
 * The parsing itself lives in `ruko-core` and is unit tested on the JVM. This
 * class only holds the latest reading and hashes the payee.
 */
class AccessibilityPaymentProvider(
    private val payeeHasher: (String) -> String,
) : PaymentContextProvider {

    /**
     * Called once when a payment first appears on screen.
     *
     * Polling alone was not enough: nothing polled this provider unless a
     * session was already running, so a payment the user started on their own
     * was read and then silently discarded. Ruko has to be told a payment
     * appeared in order to interrupt it.
     */
    @Volatile
    var onPaymentAppeared: ((PaymentEvidence) -> Unit)? = null

    /**
     * Identity of the payment we have already announced. A payment screen
     * fires content-changed events continuously, so without this the callback
     * would fire dozens of times for one payment.
     */
    @Volatile
    private var announced: String? = null

    override val source = EvidenceSource.ACCESSIBILITY

    @Volatile
    private var latest: Reading? = null

    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var pendingAnnounce: Runnable? = null

    private data class Reading(
        val parsed: PaymentScreenParser.PaymentScreenReading,
        val packageName: String,
        val observedAtEpochMs: Long,
    )

    /** Called by [com.ruko.nativemodule.accessibility.RukoAccessibilityService]. */
    fun onScreenRead(
        texts: List<String>,
        packageName: String,
        nowEpochMs: Long = System.currentTimeMillis(),
    ) {
        val parsed = PaymentScreenParser.parse(texts)
        Log.i(
            "RukoPay",
            "parsed usable=${parsed.isUsable} amount=${parsed.amountMinor} " +
                "conf=${parsed.confidence} signals=${parsed.signals}",
        )
        if (!parsed.isUsable) {
            latest = null
            return
        }
        latest = Reading(parsed, packageName, nowEpochMs)

        // Amount plus payee is the payment's identity. Two genuinely separate
        // payments of the same amount to the same payee are indistinguishable
        // here, which is the right trade: announcing one of them twice would be
        // far worse than treating a rapid repeat as the same screen.
        val identity = "${parsed.amountMinor}:${parsed.payeeId ?: parsed.payee}"
        if (identity == announced) return

        // Let the amount settle before announcing.
        //
        // An amount keypad emits a usable reading per keystroke: typing 2500
        // produces ₹2, ₹25, ₹250, ₹2500 in under a second, and announcing the
        // first of those meant Ruko investigated -- and warned about -- a ₹2
        // payment while the user was being talked into ₹2,500. The score was
        // computed from a real reading; it was simply the wrong one, and an
        // intervention that names the wrong amount is worse than none.
        //
        // So the announcement is debounced: each new reading replaces the
        // pending one, and only a figure that has stopped changing is acted
        // on. The cost is [SETTLE_MS] before an investigation starts, against a
        // user who is still typing.
        pendingAnnounce?.let(handler::removeCallbacks)
        val announce = Runnable {
            // Re-read at fire time rather than capturing: the screen may have
            // moved on to the confirm sheet, and that is the better reading.
            val evidence = current() ?: return@Runnable
            announced = "${evidence.amountMinor}:${parsed.payeeId ?: parsed.payee}"
            val listener = onPaymentAppeared
            Log.i(
                "RukoPay",
                "announcing payment amount=${evidence.amountMinor} listener=${listener != null}",
            )
            listener?.invoke(evidence)
        }
        pendingAnnounce = announce
        handler.postDelayed(announce, SETTLE_MS)
    }

    /** Called when the payment screen goes away. */
    fun clear() {
        latest = null
        // Leaving the payment screen ends the payment. The next one is new
        // even if it is for the same amount to the same payee.
        announced = null
        // A payment that is no longer on screen must not be announced by a
        // timer that was already in flight when the user walked away.
        pendingAnnounce?.let(handler::removeCallbacks)
        pendingAnnounce = null
    }

    override fun isAvailable(): Boolean = freshReading() != null

    override fun current(): PaymentEvidence? {
        val reading = freshReading() ?: return null
        val amountMinor = reading.parsed.amountMinor ?: return null

        return PaymentEvidence(
            available = true,
            source = EvidenceSource.ACCESSIBILITY,
            active = true,
            amountMinor = amountMinor,
            payeeDisplayName = reading.parsed.payee ?: UNKNOWN_PAYEE,
            // The raw VPA is hashed here and never stored or transmitted.
            payeeHash = payeeHasher(reading.parsed.payeeId ?: reading.parsed.payee ?: UNKNOWN_PAYEE),
            appPackage = reading.packageName,
            timestamp = reading.observedAtEpochMs,
        )
    }

    /** Diagnostics only: what the parser saw and why it scored as it did. */
    fun lastSignals(): List<String> = latest?.parsed?.signals.orEmpty()

    /**
     * A reading goes stale quickly. Screens change faster than events arrive,
     * and acting on a payment the user already left would be worse than not
     * acting at all.
     */
    private fun freshReading(): Reading? {
        val reading = latest ?: return null
        val age = System.currentTimeMillis() - reading.observedAtEpochMs
        return if (age <= STALE_AFTER_MS) reading else null
    }

    private companion object {
        const val STALE_AFTER_MS = 15_000L
        const val UNKNOWN_PAYEE = "Unknown recipient"

        /**
         * How long an amount must stop changing before Ruko acts on it.
         *
         * Longer than the gap between two keystrokes, shorter than the pause
         * before someone taps "Proceed to Pay". Tapping proceed also produces a
         * fresh confirm-screen reading, so the settle window restarts there and
         * the figure Ruko investigates is the one on the confirmation.
         */
        const val SETTLE_MS = 800L
    }
}
