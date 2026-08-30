package com.ruko.paynow

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/** Amount entry. A keypad, because a soft keyboard on an amount field is not
 *  what a UPI app looks like and the demo should not have to explain itself. */
class PayActivity : AppCompatActivity() {

    private var typed = ""
    private lateinit var amountView: android.widget.TextView

    private val payeeName by lazy { intent.getStringExtra(EXTRA_NAME) ?: "Unknown" }
    private val payeeVpa by lazy { intent.getStringExtra(EXTRA_VPA) ?: "unknown@upi" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = Ui.column(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            setPadding(dp(20), dp(28), dp(20), dp(20))
        }

        root.addView(Ui.text(this, "Paying to", 13f, Ui.MUTED))
        root.addView(Ui.spacer(this, 4))
        root.addView(Ui.text(this, payeeName, 20f, Ui.INK, bold = true))
        root.addView(Ui.text(this, payeeVpa, 13f, Ui.MUTED))
        root.addView(Ui.spacer(this, 28))

        amountView = Ui.text(this, "₹0", 46f, Ui.INK, bold = true).apply {
            gravity = Gravity.CENTER
        }
        root.addView(amountView, Ui.lp(MATCH, WRAP))
        root.addView(Ui.spacer(this, 6))
        root.addView(
            Ui.text(this, "Enter amount", 13f, Ui.MUTED).apply { gravity = Gravity.CENTER },
            Ui.lp(MATCH, WRAP),
        )

        root.addView(Ui.spacer(this, 20))
        root.addView(keypad(), Ui.lp(MATCH, 0, 1f))

        root.addView(
            Ui.button(this, "Proceed to Pay") { proceed() },
            Ui.lp(MATCH, WRAP),
        )

        setContentView(root)
    }

    private fun keypad(): View {
        val keys = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf(".", "0", "⌫"),
        )
        return Ui.column(this).apply {
            keys.forEach { rowKeys ->
                addView(
                    Ui.row(this@PayActivity).apply {
                        rowKeys.forEach { key -> addView(keyView(key), Ui.lp(0, MATCH, 1f)) }
                    },
                    Ui.lp(MATCH, 0, 1f),
                )
            }
        }
    }

    private fun keyView(key: String): View =
        Ui.text(this, key, 24f, Ui.INK, bold = true).apply {
            gravity = Gravity.CENTER
            isClickable = true
            setOnClickListener { onKey(key) }
        }

    private fun onKey(key: String) {
        typed = when {
            key == "⌫" -> typed.dropLast(1)
            // A second decimal point, or a third decimal digit, is silently
            // ignored rather than accepted and then quietly reinterpreted.
            key == "." && typed.contains(".") -> typed
            key == "." && typed.isEmpty() -> "0."
            typed.contains(".") && typed.substringAfter(".").length >= 2 -> typed
            typed.length >= 9 -> typed
            else -> typed + key
        }
        val minor = Money.parse(typed)
        amountView.text = if (minor == null) "₹0" else Money.format(minor)
    }

    private fun proceed() {
        val minor = Money.parse(typed)
        if (minor == null) {
            android.widget.Toast.makeText(this, "Enter an amount", android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(
            Intent(this, ConfirmActivity::class.java)
                .putExtra(EXTRA_NAME, payeeName)
                .putExtra(EXTRA_VPA, payeeVpa)
                .putExtra(EXTRA_AMOUNT_MINOR, minor),
        )
        finish()
    }

    companion object {
        const val EXTRA_NAME = "name"
        const val EXTRA_VPA = "vpa"
        const val EXTRA_AMOUNT_MINOR = "amountMinor"
    }
}
