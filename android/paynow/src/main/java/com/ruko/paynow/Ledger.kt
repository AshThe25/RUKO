package com.ruko.paynow

import android.content.Context
import kotlin.random.Random

/**
 * A record of what the demo wallet has paid.
 *
 * Kept because Ruko's cumulative-spend rule is about a *sequence* of small
 * payments, not one large one. Six ₹500 transfers is the scenario, and it only
 * reads as real if PayNow genuinely remembers the earlier five.
 */
object Ledger {

    private const val PREFS = "paynow_ledger"
    private const val KEY_COUNT = "count"
    private const val KEY_TOTAL = "totalMinor"
    private const val KEY_REF = "lastRef"

    fun record(context: Context, name: String, vpa: String, amountMinor: Long) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit()
            .putInt(KEY_COUNT, prefs.getInt(KEY_COUNT, 0) + 1)
            .putLong(KEY_TOTAL, prefs.getLong(KEY_TOTAL, 0L) + amountMinor)
            .putString(KEY_REF, newReference())
            .apply()
        lastReference = prefs.getString(KEY_REF, null) ?: newReference()
    }

    private var lastReference: String = newReference()

    fun lastReference(): String = lastReference

    private fun newReference(): String = buildString {
        append("T")
        repeat(12) { append(Random.nextInt(0, 10)) }
    }
}
