package com.ruko.core

import kotlin.math.min

/**
 * Decides which notifications are worth looking at, scores how scam-shaped they
 * are, and redacts them before anything is stored.
 *
 * Two rules from the build prompt drive the whole design:
 *
 *   §14 "Do NOT treat a suspicious notification alone as proof of fraud."
 *   §23 "Privacy is a product feature."
 *
 * So: everything irrelevant is dropped *before* storage, what survives is
 * redacted to a bounded excerpt with numbers and links stripped, and the
 * aggregate suspicion is capped so a notification can never on its own push an
 * assessment to CRITICAL. It is corroboration, not evidence of guilt.
 */
object NotificationRelevanceFilter {

    data class IncomingNotification(
        val packageName: String,
        val title: String,
        val text: String,
        val postedAtEpochMs: Long,
    )

    data class RelevantNotification(
        val packageName: String,
        /** Redacted and bounded. Safe to persist. */
        val excerpt: String,
        val suspicion: Confidence,
        val matchedPatterns: List<String>,
        val postedAtEpochMs: Long,
    )

    const val MAX_EXCERPT_LENGTH = 120
    const val MAX_EXCERPTS = 3
    const val DEFAULT_LOOKBACK_MINUTES = 30

    /**
     * A single notification can contribute at most this much suspicion, no
     * matter how many scam phrases it stacks. Corroboration, not proof.
     */
    const val MAX_SINGLE_SUSPICION = 0.75

    /** Only notifications from these categories are considered at all. */
    private val FINANCE_CONTEXT_TERMS = listOf(
        "bank", "account", "upi", "payment", "transaction", "debit", "credit",
        "kyc", "refund", "otp", "card", "wallet", "parcel", "courier", "delivery",
        "customs", "loan", "insurance", "rupee", "₹",
    )

    /**
     * Phrases that show up in scam notifications and essentially never in a
     * legitimate bank alert. Weighted by how diagnostic each one is.
     */
    private val SUSPICION_PATTERNS: List<Pair<Regex, Pair<String, Double>>> = listOf(
        Regex("""account (will be |is |has been )?(blocked|frozen|suspended|deactivated)""", RegexOption.IGNORE_CASE)
            to ("account-freeze threat" to 0.35),
        Regex("""complete (your )?kyc""", RegexOption.IGNORE_CASE)
            to ("kyc pressure" to 0.30),
        Regex("""(verify|update) (your )?(bank|account|details|pan|aadhaar)""", RegexOption.IGNORE_CASE)
            to ("verification lure" to 0.25),
        Regex("""(parcel|package|shipment) (is )?(held|detained|stuck|on hold)""", RegexOption.IGNORE_CASE)
            to ("courier hold" to 0.30),
        Regex("""customs (duty|clearance|fee)""", RegexOption.IGNORE_CASE)
            to ("customs fee lure" to 0.30),
        Regex("""(within|in) \d+ (hours?|minutes?|hrs?|mins?)""", RegexOption.IGNORE_CASE)
            to ("deadline pressure" to 0.20),
        Regex("""(immediately|urgent(ly)?|last warning|final notice)""", RegexOption.IGNORE_CASE)
            to ("urgency language" to 0.20),
        Regex("""click (here|this link|below)""", RegexOption.IGNORE_CASE)
            to ("link bait" to 0.20),
        Regex("""(share|send|enter) (the )?(otp|pin|cvv|password)""", RegexOption.IGNORE_CASE)
            to ("credential request" to 0.40),
        Regex("""refund (of )?(₹|rs\.?|inr)?\s*\d""", RegexOption.IGNORE_CASE)
            to ("refund lure" to 0.25),
        Regex("""(call|contact) (us )?(on |at )?\+?\d{6,}""", RegexOption.IGNORE_CASE)
            to ("callback number in message" to 0.25),
    )

    private val URL_REGEX = Regex("""https?://\S+|\b\S+\.(com|in|net|org|co|xyz|link)/\S*""", RegexOption.IGNORE_CASE)
    private val LONG_DIGIT_REGEX = Regex("""\d{4,}""")
    private val AMOUNT_REGEX = Regex("""(?:₹|rs\.?|inr)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?""", RegexOption.IGNORE_CASE)

    /**
     * @return null when the notification is not finance-related at all. Nothing
     *   about it is stored, logged, or counted.
     */
    fun evaluate(notification: IncomingNotification): RelevantNotification? {
        val combined = "${notification.title} ${notification.text}".trim()
        if (combined.isBlank()) return null
        if (!isFinanceRelated(combined)) return null

        val matched = SUSPICION_PATTERNS.mapNotNull { (regex, meta) ->
            if (regex.containsMatchIn(combined)) meta else null
        }
        if (matched.isEmpty()) return null

        val suspicion = min(MAX_SINGLE_SUSPICION, matched.sumOf { it.second })

        return RelevantNotification(
            packageName = notification.packageName,
            excerpt = redact(combined),
            suspicion = suspicion,
            matchedPatterns = matched.map { it.first },
            postedAtEpochMs = notification.postedAtEpochMs,
        )
    }

    /**
     * Folds the recent relevant notifications into the evidence object.
     *
     * Aggregate suspicion is the strongest single notification, not a sum:
     * five copies of the same phishing SMS are one signal, not five.
     */
    fun aggregate(
        relevant: List<RelevantNotification>,
        nowEpochMs: Long,
        lookbackMinutes: Int = DEFAULT_LOOKBACK_MINUTES,
    ): NotificationEvidence {
        val cutoff = nowEpochMs - lookbackMinutes * 60_000L
        val inWindow = relevant.filter { it.postedAtEpochMs >= cutoff }

        return NotificationEvidence(
            available = true,
            source = EvidenceSource.ANDROID_API,
            suspicion = inWindow.maxOfOrNull { it.suspicion } ?: 0.0,
            matchCount = inWindow.size,
            excerpts = inWindow.sortedByDescending { it.suspicion }
                .take(MAX_EXCERPTS)
                .map { it.excerpt },
            lookbackMinutes = lookbackMinutes,
        )
    }

    private fun isFinanceRelated(text: String): Boolean {
        val lower = text.lowercase()
        return FINANCE_CONTEXT_TERMS.any { it in lower }
    }

    /**
     * Strips the parts that would make a stored excerpt sensitive: links,
     * account/phone digits and amounts. What remains is the *shape* of the
     * message, which is all the risk engine needs.
     */
    private fun redact(text: String): String =
        text.replace(URL_REGEX, "[link]")
            .replace(AMOUNT_REGEX, "[amount]")
            .replace(LONG_DIGIT_REGEX, "[number]")
            .replace(Regex("""\s+"""), " ")
            .trim()
            .take(MAX_EXCERPT_LENGTH)
}
