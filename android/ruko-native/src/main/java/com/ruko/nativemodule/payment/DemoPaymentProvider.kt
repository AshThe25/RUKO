package com.ruko.nativemodule.payment

import com.ruko.core.PaymentContextSource
import com.ruko.core.PaymentEvidence
import java.time.Instant
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

    override val source = PaymentContextSource.DEMO_APP

    private val active = AtomicReference<PaymentEvidence?>(null)

    override fun isAvailable(): Boolean = active.get() != null

    override fun current(): PaymentEvidence? = active.get()

    /** Called by RukoPayDemo when the user reaches a confirmation screen. */
    fun beginPayment(amountRupees: Long, payee: String, payeeHash: String) {
        require(amountRupees > 0) { "amount must be positive" }
        require(payee.isNotBlank()) { "payee must not be blank" }

        active.set(
            PaymentEvidence(
                active = true,
                amount = amountRupees,
                payee = payee.take(MAX_PAYEE_LENGTH),
                payeeHash = payeeHash,
                source = PaymentContextSource.DEMO_APP,
                packageName = DEMO_PACKAGE,
                observedAt = Instant.now().toString(),
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
