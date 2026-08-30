package com.ruko.paynow

/**
 * The demo wallet.
 *
 * The balance is unbounded on purpose: a demo must never fail for the boring
 * reason that a made-up account ran out of made-up money. Payments always
 * succeed here, which also keeps the demo honest about where the interruption
 * comes from — if a payment is stopped, it was stopped by Ruko, never by
 * PayNow running short.
 */
object Accounts {

    const val VPA = "aishwarya@paynow"
    const val BANK = "iQOO Bank •••• 4471"

    /** Displayed balance. Never decremented — see the class comment. */
    fun displayBalance(): String = Money.format(9_99_99_900L)

    data class Payee(val name: String, val vpa: String, val initials: String)

    /**
     * Recent payees. The two demo-relevant ones sit alongside ordinary
     * contacts so the payment screen looks like a real one rather than a
     * single-purpose prop.
     */
    val recents = listOf(
        Payee("Rahul Sharma", "rahul.sharma@okaxis", "RS"),
        Payee("KYC Verification Desk", "kyc.verify9931@ybl", "KV"),
        Payee("Meera Iyer", "meera@okhdfcbank", "MI"),
        Payee("Amazon Pay", "amazon@apl", "AP"),
        Payee("Rohit (Instagram)", "rohit.9x@paytm", "RI"),
        Payee("Diamond Store (Free Fire)", "diamondstore@ybl", "DS"),
    )
}
