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

        // The balance is excluded by its caption, so the amount being sent
        // wins even when both are on screen. This used to assert the opposite
        // and documented it as a known limitation; on the device that
        // limitation was not theoretical. PayNow's home screen draws the
        // balance above a "Send money" list, so every payment was investigated
        // as ₹9,99,999 going to the account holder's own UPI id, whoever the
        // user had actually chosen to pay.
        assertEquals(50_000L, reading.amountMinor)
    }

    @Test
    fun `the PayNow home screen is not a payment`() {
        // The exact shape that broke it: a balance, the user's own VPA, and a
        // "Send money" list of people they might pay. Nobody is being paid yet.
        val home = listOf(
            "PayNow",
            "Available balance",
            "₹9,99,999",
            "iQOO Bank •••• 4471 · aishwarya@paynow",
            "Send money",
            "Rahul Sharma", "rahul.sharma@okaxis",
            "KYC Verification Desk", "kyc.verify9931@ybl",
        )

        val reading = PaymentScreenParser.parse(home)

        assertFalse(
            reading.isUsable,
            "home screen read as a payment of ${reading.amountMinor}: ${reading.signals}",
        )
    }
}
