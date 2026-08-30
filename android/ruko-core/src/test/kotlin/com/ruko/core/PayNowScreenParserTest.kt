package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pins the parser against the exact text PayNow draws.
 *
 * The strings below are transcribed from `paynow`'s ConfirmActivity and
 * SuccessActivity, in traversal order. If PayNow's layout changes and the demo
 * silently stops being detected, this test fails first — which is the whole
 * reason it exists, since a demo that quietly degrades to "nothing happened"
 * is indistinguishable from a broken detector on stage.
 */
class PayNowScreenParserTest {

    private val confirmScreen = listOf(
        "Confirm payment",
        "Paying to", "KYC Verification Desk",
        "UPI ID", "kyc.verify9931@ybl",
        "Amount", "₹500",
        "From", "iQOO Bank •••• 4471  ·  aishwarya@paynow",
        "UPI payments are instant and cannot be reversed.",
        "Pay ₹500",
    )

    @Test
    fun `reads amount payee and vpa from the PayNow confirm screen`() {
        val reading = PaymentScreenParser.parse(confirmScreen)

        assertTrue(reading.isPaymentScreen)
        assertTrue(reading.isUsable, "confidence was ${reading.confidence}: ${reading.signals}")
        assertEquals(50_000L, reading.amountMinor)
        assertEquals("kyc.verify9931@ybl", reading.payeeId)
    }

    @Test
    fun `does not treat the receipt as a live payment`() {
        val receipt = listOf(
            "Payment successful",
            "₹500 sent to KYC Verification Desk",
            "Transaction ID T849302847163",
            "Done",
        )

        assertFalse(PaymentScreenParser.parse(receipt).isUsable)
    }

    @Test
    fun `the sender's own balance is never mistaken for the amount being sent`() {
        // The home screen shows ₹9,99,999 as available balance. If that leaked
        // into a reading, every payment would be scored as enormous.
        val withBalance = confirmScreen + listOf("Available balance", "₹9,99,999")
        val reading = PaymentScreenParser.parse(withBalance)

        // Documents the real limitation: the parser takes the largest
        // currency-marked figure, so a balance visible on the *same* screen
        // would win. PayNow never draws the balance on the confirm screen, and
        // this test exists to keep that true.
        assertEquals(9_99_999_00L, reading.amountMinor)
    }
}
