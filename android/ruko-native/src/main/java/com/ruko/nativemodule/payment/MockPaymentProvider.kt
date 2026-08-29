package com.ruko.nativemodule.payment

import com.ruko.core.PaymentContextSource
import com.ruko.core.PaymentEvidence

/** Test injection. Never reachable in a release build. */
class MockPaymentProvider(
    private var evidence: PaymentEvidence? = null,
) : PaymentContextProvider {

    override val source = PaymentContextSource.MOCK

    override fun isAvailable(): Boolean = evidence != null

    override fun current(): PaymentEvidence? = evidence

    fun set(next: PaymentEvidence?) {
        evidence = next
    }
}
