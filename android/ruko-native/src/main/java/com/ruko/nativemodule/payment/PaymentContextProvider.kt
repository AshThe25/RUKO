package com.ruko.nativemodule.payment

import com.ruko.core.PaymentContextSource
import com.ruko.core.PaymentEvidence

/**
 * Where a payment context comes from.
 *
 * Three implementations, one interface, and the source travels with the
 * evidence all the way to the audit trail. That last part is the point: a
 * payment read from our own demo app must never be presented as an
 * intercepted real UPI transaction (build prompt §12, §37).
 */
interface PaymentContextProvider {
    val source: PaymentContextSource

    /** True when this provider can currently produce anything at all. */
    fun isAvailable(): Boolean

    /** The current payment context, or null when there is no live payment. */
    fun current(): PaymentEvidence?
}

/**
 * Tries providers in order and takes the first that answers.
 *
 * Accessibility first when it is genuinely working; the demo app when it is
 * not. The fallback is not a failure mode we hide — the resolved source is
 * reported on the Engineering screen so it is obvious which one is live.
 */
class LayeredPaymentContextProvider(
    private val providers: List<PaymentContextProvider>,
) : PaymentContextProvider {

    override val source: PaymentContextSource
        get() = activeProvider()?.source ?: PaymentContextSource.MOCK

    override fun isAvailable(): Boolean = providers.any { it.isAvailable() }

    override fun current(): PaymentEvidence? =
        providers.firstOrNull { it.isAvailable() }?.current()

    /** Which provider would answer right now. For diagnostics. */
    fun activeProvider(): PaymentContextProvider? = providers.firstOrNull { it.isAvailable() }
}
