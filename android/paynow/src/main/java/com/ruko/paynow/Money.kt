package com.ruko.paynow

import java.text.NumberFormat
import java.util.Locale

/**
 * Rupee formatting, in integer paise throughout.
 *
 * Amounts never pass through a Double. Binary floating point cannot represent
 * 0.10 exactly, and a demo that displays ₹499.99 where the user typed ₹500 is
 * a demo that undermines the thing it is demonstrating — Ruko reads these
 * numbers off the screen, so what is drawn has to be exactly right.
 */
object Money {

    private val formatter: NumberFormat =
        NumberFormat.getInstance(Locale("en", "IN")).apply {
            minimumFractionDigits = 0
            maximumFractionDigits = 2
        }

    /** "50000" paise -> "₹500". Grouped the Indian way: ₹1,00,000. */
    fun format(minor: Long): String = "₹" + formatter.format(minor / 100.0)

    /** Digits typed on the keypad ("500", "500.50") -> paise. Null if unusable. */
    fun parse(typed: String): Long? {
        if (typed.isBlank()) return null
        val dot = typed.indexOf('.')
        val rupees: String
        val paise: String
        if (dot < 0) {
            rupees = typed
            paise = "00"
        } else {
            rupees = typed.substring(0, dot).ifEmpty { "0" }
            paise = typed.substring(dot + 1).padEnd(2, '0').take(2)
        }
        val r = rupees.toLongOrNull() ?: return null
        val p = paise.toLongOrNull() ?: return null
        val total = r * 100 + p
        return if (total > 0) total else null
    }
}
