package com.ruko.core

/**
 * Turns the bag of visible strings an AccessibilityService can see into a
 * structured payment reading — or, far more often, into an honest "this is not
 * a payment screen".
 *
 * This is the fragile part of the system and it is written to fail loudly
 * rather than guess. Layouts change between app versions, views can be
 * `FLAG_SECURE`, and text can be drawn to a canvas where no node exists. Every
 * reading therefore carries a [PaymentScreenReading.confidence] and the list of
 * signals that produced it, and the caller is expected to fall back to
 * `DemoPaymentProvider` when confidence is low.
 *
 * Pure logic: no Android imports, so it is unit-tested on the JVM.
 */
object PaymentScreenParser {

    data class PaymentScreenReading(
        val isPaymentScreen: Boolean,
        /** Integer paise, or null when no amount could be read. */
        val amountMinor: Long?,
        /** Display name, bounded to 64 chars. Null when not found. */
        val payee: String?,
        /** Raw VPA if one was visible. Never leaves the device un-hashed. */
        val payeeId: String?,
        /** [0,1]. Below [MIN_USABLE_CONFIDENCE] the caller must not act on it. */
        val confidence: Double,
        /** Which cues fired. Shown in the Engineering screen for debugging. */
        val signals: List<String>,
    ) {
        val isUsable: Boolean
            get() = isPaymentScreen && amountMinor != null && confidence >= MIN_USABLE_CONFIDENCE
    }

    const val MIN_USABLE_CONFIDENCE = 0.5

    /** Words that suggest a screen is about to move money. */
    private val PAYMENT_KEYWORDS = listOf(
        "pay", "paying", "payment", "send money", "transfer",
        "upi", "amount", "proceed to pay", "confirm payment",
    )

    /** Words that mean "the next thing is the recipient". */
    private val PAYEE_MARKERS = listOf("paying to", "to:", "send to", "recipient", "payee", "to ")

    /**
     * Words that mean this is a *record* of a payment, not a live one.
     * Without this veto, a transaction history screen reads as an active payment.
     */
    private val COMPLETED_MARKERS = listOf(
        "paid successfully", "payment successful", "transaction successful",
        "sent successfully", "completed", "receipt", "transaction history",
        "payment failed", "transaction id",
    )

    private val AMOUNT_REGEX =
        Regex("""(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)

    private val BARE_AMOUNT_REGEX =
        Regex("""\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]{2,7}(?:\.[0-9]{1,2})?)\b""")

    private val VPA_REGEX =
        Regex("""\b([a-zA-Z0-9][a-zA-Z0-9._-]{1,48}@[a-zA-Z]{2,20})\b""")

    private const val MAX_PAYEE_LENGTH = 64

    /**
     * @param texts visible node texts, in traversal order. Order matters: a
     *   payee name is usually the node right after a "To" marker.
     */
    fun parse(texts: List<String>): PaymentScreenReading {
        val cleaned = texts.map { it.trim() }.filter { it.isNotEmpty() }
        if (cleaned.isEmpty()) return notPayment("no visible text (screen may be FLAG_SECURE)")

        val haystack = cleaned.joinToString(" \n ").lowercase()
        val signals = mutableListOf<String>()

        if (COMPLETED_MARKERS.any { it in haystack }) {
            return notPayment("screen describes a completed or failed payment")
        }

        val keywordHits = PAYMENT_KEYWORDS.filter { it in haystack }
        if (keywordHits.isEmpty()) return notPayment("no payment vocabulary present")
        signals += "keywords:${keywordHits.joinToString("|")}"

        val currencyAmount = findCurrencyAmount(cleaned)
        if (currencyAmount != null) signals += "currency-marked amount"

        val amountMinor = currencyAmount ?: findBareAmountNearKeyword(cleaned)?.also {
            signals += "amount near 'amount' label (weaker)"
        }

        val vpa = cleaned.firstNotNullOfOrNull { VPA_REGEX.find(it)?.groupValues?.get(1) }
        if (vpa != null) signals += "upi id visible"

        val payee = findPayee(cleaned, vpa)
        if (payee != null) signals += "payee name resolved"

        val confidence = scoreConfidence(
            hasCurrencyAmount = currencyAmount != null,
            hasAnyAmount = amountMinor != null,
            hasVpa = vpa != null,
            hasPayee = payee != null,
            keywordHits = keywordHits.size,
        )

        return PaymentScreenReading(
            isPaymentScreen = true,
            amountMinor = amountMinor,
            payee = payee,
            payeeId = vpa,
            confidence = confidence,
            signals = signals,
        )
    }

    private fun notPayment(reason: String) = PaymentScreenReading(
        isPaymentScreen = false,
        amountMinor = null,
        payee = null,
        payeeId = null,
        confidence = 0.0,
        signals = listOf(reason),
    )

    /**
     * Prefers the largest currency-marked amount on screen. Payment screens
     * routinely show a smaller "wallet balance" or "cashback" alongside the
     * amount being sent; the amount being sent is the one that matters and is
     * almost always the largest currency-marked figure in the flow.
     */
    private fun findCurrencyAmount(texts: List<String>): Long? =
        texts.flatMap { AMOUNT_REGEX.findAll(it).toList() }
            .mapNotNull { normaliseAmount(it.groupValues[1]) }
            .maxOrNull()

    /** Fallback: a bare number on or next to a line that says "amount". */
    private fun findBareAmountNearKeyword(texts: List<String>): Long? {
        val index = texts.indexOfFirst { it.contains("amount", ignoreCase = true) }
        if (index < 0) return null
        val window = texts.subList(index, minOf(index + 3, texts.size))
        return window.flatMap { BARE_AMOUNT_REGEX.findAll(it).toList() }
            .mapNotNull { normaliseAmount(it.groupValues[1]) }
            .maxOrNull()
    }

    /**
     * Rupee string to integer paise.
     *
     * Handles Indian grouping (1,00,000) as well as western (100,000), and
     * splits on the decimal point rather than going through a Double. Binary
     * floating point cannot represent 0.10 exactly, and money that is a little
     * bit wrong is worse than money that is missing — a wrong amount on an
     * intervention screen destroys the user's trust in the whole product.
     */
    private fun normaliseAmount(raw: String): Long? {
        val cleaned = raw.replace(",", "")
        val rupeePart: String
        val paisePart: String

        val dot = cleaned.indexOf('.')
        if (dot < 0) {
            rupeePart = cleaned
            paisePart = "00"
        } else {
            rupeePart = cleaned.substring(0, dot)
            // "5" means 50 paise, "50" means 50 paise, "" means 0.
            paisePart = cleaned.substring(dot + 1).padEnd(2, '0').take(2)
        }

        val rupees = rupeePart.toLongOrNull() ?: return null
        val paise = if (paisePart.isEmpty()) 0L else paisePart.toLongOrNull() ?: return null

        val total = rupees * 100 + paise
        if (total <= 0 || total > MAX_PLAUSIBLE_AMOUNT_MINOR) return null
        return total
    }

    private fun findPayee(texts: List<String>, vpa: String?): String? {
        // 1. The line immediately after an explicit "to" marker.
        texts.forEachIndexed { index, text ->
            val lower = text.lowercase()
            val marker = PAYEE_MARKERS.firstOrNull { lower.startsWith(it) || lower == it.trim() }
            if (marker != null) {
                val inline = text.drop(marker.length).trim().trimStart(':').trim()
                if (isPlausibleName(inline)) return bound(inline)
                val next = texts.getOrNull(index + 1)?.trim()
                if (next != null && isPlausibleName(next)) return bound(next)
            }
        }
        // 2. The name portion of a visible UPI ID, as a last resort.
        if (vpa != null) {
            val local = vpa.substringBefore('@').replace('.', ' ').replace('_', ' ').trim()
            if (isPlausibleName(local)) return bound(local)
        }
        return null
    }

    /** A name, not a label, a number, or a currency string. */
    private fun isPlausibleName(candidate: String): Boolean {
        if (candidate.length !in 2..MAX_PAYEE_LENGTH) return false
        if (candidate.any { it.isDigit() }) return false
        if (AMOUNT_REGEX.containsMatchIn(candidate)) return false
        if (candidate.lowercase() in PAYMENT_KEYWORDS) return false
        return candidate.any { it.isLetter() }
    }

    private fun bound(value: String) = value.take(MAX_PAYEE_LENGTH).trim()

    private fun scoreConfidence(
        hasCurrencyAmount: Boolean,
        hasAnyAmount: Boolean,
        hasVpa: Boolean,
        hasPayee: Boolean,
        keywordHits: Int,
    ): Double {
        var score = 0.0
        if (hasCurrencyAmount) score += 0.45 else if (hasAnyAmount) score += 0.20
        if (hasVpa) score += 0.25
        if (hasPayee) score += 0.15
        score += minOf(keywordHits, 3) * 0.05
        return minOf(1.0, score)
    }

    /** ₹10 crore, in paise. Anything above this is a parse error, not a payment. */
    private const val MAX_PLAUSIBLE_AMOUNT_MINOR = 10_000_000_000L
}
