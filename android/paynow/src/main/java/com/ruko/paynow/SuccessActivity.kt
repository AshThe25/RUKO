package com.ruko.paynow

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import androidx.appcompat.app.AppCompatActivity
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/**
 * Payment receipt.
 *
 * Worth noting for the demo: Ruko's screen parser explicitly vetoes this
 * screen ("payment successful" is a completed-payment marker), so it will not
 * be mistaken for a live payment. That is the correct behaviour and it is
 * visible here.
 */
class SuccessActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val name = intent.getStringExtra(PayActivity.EXTRA_NAME) ?: "Unknown"
        val minor = intent.getLongExtra(PayActivity.EXTRA_AMOUNT_MINOR, 0L)

        val root = Ui.column(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            setPadding(dp(24), dp(64), dp(24), dp(24))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        root.addView(
            Ui.text(this, "✓", 40f, android.graphics.Color.WHITE, bold = true).apply {
                gravity = Gravity.CENTER
                background = Ui.circle(Ui.GREEN)
                layoutParams = Ui.lp(dp(84), dp(84))
            },
        )
        root.addView(Ui.spacer(this, 20))
        root.addView(Ui.text(this, "Payment successful", 22f, Ui.INK, bold = true))
        root.addView(Ui.spacer(this, 8))
        root.addView(Ui.text(this, "${Money.format(minor)} sent to $name", 15f, Ui.MUTED))
        root.addView(Ui.spacer(this, 6))
        root.addView(Ui.text(this, "Transaction ID ${Ledger.lastReference()}", 12f, Ui.MUTED))

        root.addView(Ui.spacer(this, 0), Ui.lp(MATCH, 0, 1f))
        root.addView(
            Ui.button(this, "Done") {
                startActivity(
                    Intent(this, HomeActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
                )
                finish()
            },
            Ui.lp(MATCH, WRAP),
        )

        setContentView(root)
    }
}
