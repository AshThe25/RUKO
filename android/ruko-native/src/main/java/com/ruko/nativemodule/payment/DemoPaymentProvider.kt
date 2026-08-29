package com.ruko.nativemodule.payment

import com.ruko.core.EvidenceSource
import com.ruko.core.PaymentEvidence
import java.util.concurrent.atomic.AtomicReference

/**
 * Backs `RukoPayDemo`, the controlled payment app (build prompt §37).
 *
 * This exists because no public Android API lets an app observe or halt a real
 * UPI payment. The demo app is the one payment flow Ruko genuinely controls
 * end to end — so the *protection* can be demonstrated honestly even though the
 * *interception* cannot be.
 *
 * The scam detection running above this is real. Only the payment surface is ours.
 */
object DemoPaymentProvider : PaymentContextProvider {

    override val source = EvidenceSource.DEMO

    private val active = AtomicReference<PaymentEvidence?>(null)

    override fun isAvailable(): Boolean = active.get() != null

    override fun current(): PaymentEvidence? = active.get()

    /**
     * Called by RukoPayDemo when the user reaches a confirmation screen.
     *
     * @param amountMinor integer paise, matching payment.schema.ts.
     */
    fun beginPayment(amountMinor: Long, payee: String, payeeHash: String) {
        require(amountMinor > 0) { "amount must be positive" }
        require(payee.isNotBlank()) { "payee must not be blank" }

        active.set(
            PaymentEvidence(
                available = true,
                source = EvidenceSource.DEMO,
                active = true,
                amountMinor = amountMinor,
                payeeDisplayName = payee.take(MAX_PAYEE_LENGTH),
                payeeHash = payeeHash,
                appPackage = DEMO_PACKAGE,
                timestamp = System.currentTimeMillis(),
            ),
        )
    }

    /** Called when the demo payment completes, is cancelled, or is blocked. */
    fun endPayment() {
        active.set(null)
    }

    const val DEMO_PACKAGE = "com.ruko.paydemo"
    private const val MAX_PAYEE_LENGTH = 64
}
