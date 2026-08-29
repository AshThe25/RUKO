package com.ruko.nativemodule.payment

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

    override val source = EvidenceSource.ACCESSIBILITY

    @Volatile
    private var latest: Reading? = null

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
        latest = if (parsed.isUsable) Reading(parsed, packageName, nowEpochMs) else null
    }

    /** Called when the payment screen goes away. */
    fun clear() {
        latest = null
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
    }
}
