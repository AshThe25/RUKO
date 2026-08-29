package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PaymentScreenParserTest {

    @Test
    fun `reads amount and payee from a typical UPI confirmation screen`() {
        val reading = PaymentScreenParser.parse(
            listOf(
                "Paying to",
                "Ravi Verify",
                "ravi.verify@okaxis",
                "₹48,000",
                "PAY NOW",
            ),
        )

        assertTrue(reading.isPaymentScreen)
        assertTrue(reading.isUsable)
        assertEquals(4_800_000L, reading.amountMinor, "₹48,000 is 4,800,000 paise")
        assertEquals("Ravi Verify", reading.payee)
        assertEquals("ravi.verify@okaxis", reading.payeeId)
    }

    @Test
    fun `handles Indian lakh grouping`() {
        val reading = PaymentScreenParser.parse(listOf("Pay", "To: Meera Landlord", "₹1,00,000"))
        assertEquals(10_000_000L, reading.amountMinor)
    }

    @Test
    fun `handles Rs and INR prefixes`() {
        assertEquals(250_000L, PaymentScreenParser.parse(listOf("Payment", "To: Ravi", "Rs. 2,500")).amountMinor)
        assertEquals(250_000L, PaymentScreenParser.parse(listOf("Payment", "To: Ravi", "INR 2500")).amountMinor)
    }

    @Test
    fun `picks the amount being sent, not the wallet balance shown beside it`() {
        val reading = PaymentScreenParser.parse(
            listOf("Send money", "To: Ravi Verify", "₹48,000", "Balance ₹1,240", "PAY"),
        )
        assertEquals(4_800_000L, reading.amountMinor, "₹48,000 is 4,800,000 paise")
    }

    @Test
    fun `a completed transaction is not treated as an active payment`() {
        val reading = PaymentScreenParser.parse(
            listOf("Payment successful", "₹48,000", "Paid to Ravi Verify", "Transaction ID 99281"),
        )
        assertFalse(reading.isPaymentScreen)
        assertFalse(reading.isUsable)
    }

    @Test
    fun `a failed transaction is also not an active payment`() {
        val reading = PaymentScreenParser.parse(listOf("Payment failed", "₹48,000", "Try again"))
        assertFalse(reading.isPaymentScreen)
    }

    @Test
    fun `an unrelated screen is rejected`() {
        val reading = PaymentScreenParser.parse(listOf("Inbox", "3 new messages", "Settings"))
        assertFalse(reading.isPaymentScreen)
        assertEquals(0.0, reading.confidence)
    }

    @Test
    fun `an empty node tree is reported honestly, not guessed at`() {
        val reading = PaymentScreenParser.parse(emptyList())
        assertFalse(reading.isPaymentScreen)
        assertNull(reading.amountMinor)
        assertTrue(reading.signals.single().contains("FLAG_SECURE"))
    }

    @Test
    fun `a payment screen with no readable amount is not usable`() {
        val reading = PaymentScreenParser.parse(listOf("Send money", "To: Ravi Verify"))
        assertTrue(reading.isPaymentScreen)
        assertNull(reading.amountMinor)
        assertFalse(reading.isUsable, "must fall back to DemoPaymentProvider rather than guess")
    }

    @Test
    fun `derives a payee from the UPI id when no name node exists`() {
        val reading = PaymentScreenParser.parse(listOf("Pay", "ravi.verify@okaxis", "₹500"))
        assertEquals("ravi verify", reading.payee)
    }

    @Test
    fun `does not mistake a currency string for a payee name`() {
        val reading = PaymentScreenParser.parse(listOf("Pay", "To:", "₹48,000"))
        assertNull(reading.payee)
    }

    @Test
    fun `paise are preserved exactly, not lost to floating point`() {
        assertEquals(
            4_800_050L,
            PaymentScreenParser.parse(listOf("Pay", "To: Ravi", "₹48,000.50")).amountMinor,
        )
        // A single decimal digit means tenths of a rupee: 0.1 == 10 paise.
        assertEquals(
            10L,
            PaymentScreenParser.parse(listOf("Pay", "To: Ravi", "₹0.1")).amountMinor,
        )
    }

    @Test
    fun `an absurd figure is rejected as a parse error`() {
        val reading = PaymentScreenParser.parse(listOf("Pay", "To: Ravi", "₹999,999,999,999"))
        assertNull(reading.amountMinor)
    }

    @Test
    fun `payee names are bounded`() {
        val long = "A".repeat(400)
        val reading = PaymentScreenParser.parse(listOf("Pay", "To: $long", "₹100"))
        assertTrue((reading.payee?.length ?: 0) <= 64)
    }

    @Test
    fun `confidence rises with corroborating signals`() {
        val weak = PaymentScreenParser.parse(listOf("Payment", "Amount", "48000"))
        val strong = PaymentScreenParser.parse(
            listOf("Paying to", "Ravi Verify", "ravi.verify@okaxis", "₹48,000", "Confirm payment"),
        )
        assertTrue(strong.confidence > weak.confidence)
        assertTrue(strong.confidence >= PaymentScreenParser.MIN_USABLE_CONFIDENCE)
    }
}
