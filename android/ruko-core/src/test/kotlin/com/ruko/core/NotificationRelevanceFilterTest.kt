package com.ruko.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NotificationRelevanceFilterTest {

    private fun notif(title: String, text: String, pkg: String = "com.example.sms", at: Long = NOW) =
        NotificationRelevanceFilter.IncomingNotification(pkg, title, text, at)

    @Test
    fun `an unrelated notification is dropped entirely`() {
        assertNull(NotificationRelevanceFilter.evaluate(notif("Rahul", "see you at 7")))
    }

    @Test
    fun `a finance notification with no scam shape is dropped`() {
        assertNull(
            NotificationRelevanceFilter.evaluate(
                notif("HDFC Bank", "Your account was debited by Rs. 240 at Cafe Coffee Day."),
            ),
        )
    }

    @Test
    fun `an account-freeze phishing message is caught and scored`() {
        val result = NotificationRelevanceFilter.evaluate(
            notif("Alert", "Your account will be blocked. Complete KYC immediately."),
        )
        assertNotNull(result)
        assertTrue(result.suspicion > 0.5)
        assertTrue(result.matchedPatterns.contains("account-freeze threat"))
        assertTrue(result.matchedPatterns.contains("kyc pressure"))
    }

    @Test
    fun `no single notification can exceed the corroboration cap`() {
        val stacked = NotificationRelevanceFilter.evaluate(
            notif(
                "URGENT",
                "Your account will be frozen. Complete KYC immediately within 2 hours. " +
                    "Click here and share the OTP. Verify your bank details. Parcel is held, customs duty due.",
            ),
        )
        assertNotNull(stacked)
        assertEquals(NotificationRelevanceFilter.MAX_SINGLE_SUSPICION, stacked.suspicion)
        assertTrue(
            stacked.suspicion < 1.0,
            "a notification alone must never be able to prove fraud",
        )
    }

    @Test
    fun `links, amounts and long digit runs are stripped before storage`() {
        val result = NotificationRelevanceFilter.evaluate(
            notif(
                "Refund",
                "Refund of Rs. 4,999 pending. Verify your account at http://bit.ly/x9 or call 9876543210",
            ),
        )
        assertNotNull(result)
        assertTrue("[link]" in result.excerpt)
        assertTrue("[amount]" in result.excerpt)
        assertTrue("9876543210" !in result.excerpt)
        assertTrue("bit.ly" !in result.excerpt)
    }

    @Test
    fun `excerpts are bounded`() {
        val result = NotificationRelevanceFilter.evaluate(
            notif("Bank", "Complete KYC immediately. " + "padding ".repeat(200)),
        )
        assertNotNull(result)
        assertTrue(result.excerpt.length <= NotificationRelevanceFilter.MAX_EXCERPT_LENGTH)
    }

    @Test
    fun `aggregate takes the strongest signal, not the sum of duplicates`() {
        val one = requireNotNull(
            NotificationRelevanceFilter.evaluate(notif("Bank", "Account will be blocked. Complete KYC immediately.")),
        )
        val many = List(5) { one }

        val single = NotificationRelevanceFilter.aggregate(listOf(one), NOW)
        val repeated = NotificationRelevanceFilter.aggregate(many, NOW)

        assertEquals(single.suspicion, repeated.suspicion, "five copies of one phishing SMS is one signal")
        assertEquals(5, repeated.matchCount)
    }

    @Test
    fun `aggregate keeps at most three excerpts`() {
        val items = List(10) {
            requireNotNull(
                NotificationRelevanceFilter.evaluate(
                    notif("Bank $it", "Account will be blocked. Complete KYC immediately."),
                ),
            )
        }
        val evidence = NotificationRelevanceFilter.aggregate(items, NOW)
        assertTrue(evidence.excerpts.size <= NotificationRelevanceFilter.MAX_EXCERPTS)
    }

    @Test
    fun `notifications outside the lookback window are ignored`() {
        val old = requireNotNull(
            NotificationRelevanceFilter.evaluate(
                notif("Bank", "Account will be blocked. Complete KYC immediately.", at = NOW - 60 * 60_000L),
            ),
        )
        val evidence = NotificationRelevanceFilter.aggregate(listOf(old), NOW, lookbackMinutes = 30)
        assertEquals(0, evidence.matchCount)
        assertEquals(0.0, evidence.suspicion)
    }

    @Test
    fun `a blank notification is dropped`() {
        assertNull(NotificationRelevanceFilter.evaluate(notif("", "   ")))
    }

    private companion object {
        const val NOW = 1_756_000_000_000L
    }
}
