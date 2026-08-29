package com.ruko.nativemodule.payment

import com.ruko.core.EvidenceSource
import com.ruko.core.PaymentEvidence

/** Test injection. Never reachable in a release build. */
class MockPaymentProvider(
    private var evidence: PaymentEvidence? = null,
) : PaymentContextProvider {

    override val source = EvidenceSource.MOCK

    override fun isAvailable(): Boolean = evidence != null

    override fun current(): PaymentEvidence? = evidence

    fun set(next: PaymentEvidence?) {
        evidence = next
    }
}
