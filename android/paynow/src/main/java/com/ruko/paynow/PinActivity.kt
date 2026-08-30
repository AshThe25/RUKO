package com.ruko.paynow

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/**
 * UPI PIN entry.
 *
 * Any four digits are accepted. This is a demo wallet with no real rails
 * behind it, and a wrong-PIN path would only add a way for the demo to fail
 * that has nothing to do with what is being shown.
 */
class PinActivity : AppCompatActivity() {

    private var entered = ""
    private lateinit var dots: android.widget.LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val name = intent.getStringExtra(PayActivity.EXTRA_NAME) ?: "Unknown"
        val vpa = intent.getStringExtra(PayActivity.EXTRA_VPA) ?: "unknown@upi"
        val minor = intent.getLongExtra(PayActivity.EXTRA_AMOUNT_MINOR, 0L)

        val root = Ui.column(this).apply {
            setBackgroundColor(Ui.PURPLE_DARK)
            setPadding(dp(20), dp(36), dp(20), dp(20))
        }

        root.addView(
            Ui.text(this, "Enter UPI PIN", 18f, android.graphics.Color.WHITE, bold = true)
                .apply { gravity = Gravity.CENTER },
            Ui.lp(MATCH, WRAP),
        )
        root.addView(Ui.spacer(this, 8))
        root.addView(
            Ui.text(this, "Paying ${Money.format(minor)} to $name", 13f, android.graphics.Color.parseColor("#C4B5FD"))
                .apply { gravity = Gravity.CENTER },
            Ui.lp(MATCH, WRAP),
        )
        root.addView(Ui.spacer(this, 32))

        dots = Ui.row(this).apply { gravity = Gravity.CENTER }
        root.addView(dots, Ui.lp(MATCH, WRAP))
        renderDots()

        root.addView(Ui.spacer(this, 24))
        root.addView(keypad(name, vpa, minor), Ui.lp(MATCH, 0, 1f))

        setContentView(root)
    }

    private fun renderDots() {
        dots.removeAllViews()
        repeat(PIN_LENGTH) { index ->
            val filled = index < entered.length
            dots.addView(
                View(this).apply {
                    background = Ui.circle(
                        if (filled) android.graphics.Color.WHITE
                        else android.graphics.Color.parseColor("#6D28D9"),
                    )
                    layoutParams = Ui.lp(dp(14), dp(14)).apply { marginStart = dp(8); marginEnd = dp(8) }
                },
            )
        }
    }

    private fun keypad(name: String, vpa: String, minor: Long): View {
        val keys = listOf(
            listOf("1", "2", "3"), listOf("4", "5", "6"),
            listOf("7", "8", "9"), listOf("", "0", "⌫"),
        )
        return Ui.column(this).apply {
            keys.forEach { rowKeys ->
                addView(
                    Ui.row(this@PinActivity).apply {
                        rowKeys.forEach { key ->
                            addView(
                                Ui.text(this@PinActivity, key, 24f, android.graphics.Color.WHITE, bold = true).apply {
                                    gravity = Gravity.CENTER
                                    isClickable = key.isNotEmpty()
                                    setOnClickListener { onKey(key, name, vpa, minor) }
                                },
                                Ui.lp(0, MATCH, 1f),
                            )
                        }
                    },
                    Ui.lp(MATCH, 0, 1f),
                )
            }
        }
    }

    private fun onKey(key: String, name: String, vpa: String, minor: Long) {
        entered = when {
            key == "⌫" -> entered.dropLast(1)
            key.isEmpty() -> entered
            entered.length >= PIN_LENGTH -> entered
            else -> entered + key
        }
        renderDots()

        if (entered.length == PIN_LENGTH) {
            // A short pause so the fourth dot is visibly filled before the
            // screen changes; instant navigation reads as a dropped tap.
            Handler(Looper.getMainLooper()).postDelayed({
                Ledger.record(this, name, vpa, minor)
                startActivity(
                    Intent(this, SuccessActivity::class.java)
                        .putExtra(PayActivity.EXTRA_NAME, name)
                        .putExtra(PayActivity.EXTRA_VPA, vpa)
                        .putExtra(PayActivity.EXTRA_AMOUNT_MINOR, minor),
                )
                finish()
            }, 220)
        }
    }

    private companion object {
        const val PIN_LENGTH = 4
    }
}
