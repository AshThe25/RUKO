package com.ruko.paynow

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/**
 * The confirmation screen — the one that matters.
 *
 * Every field here is a separate text node with its own label, which is how a
 * real UPI confirmation is built and what an accessibility reader can actually
 * traverse. Nothing is drawn to a canvas or baked into an image, because that
 * would make the screen unreadable to Ruko for reasons that have nothing to do
 * with whether the detection works.
 */
class ConfirmActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val name = intent.getStringExtra(PayActivity.EXTRA_NAME) ?: "Unknown"
        val vpa = intent.getStringExtra(PayActivity.EXTRA_VPA) ?: "unknown@upi"
        val minor = intent.getLongExtra(PayActivity.EXTRA_AMOUNT_MINOR, 0L)

        val root = Ui.column(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            setPadding(dp(20), dp(28), dp(20), dp(20))
        }

        root.addView(Ui.text(this, "Confirm payment", 22f, Ui.INK, bold = true))
        root.addView(Ui.spacer(this, 24))

        root.addView(field("Paying to", name))
        root.addView(field("UPI ID", vpa))
        root.addView(field("Amount", Money.format(minor)))
        root.addView(field("From", "${Accounts.BANK}  ·  ${Accounts.VPA}"))

        root.addView(Ui.spacer(this, 16))
        root.addView(
            Ui.text(this, "UPI payments are instant and cannot be reversed.", 12f, Ui.MUTED),
        )

        root.addView(Ui.spacer(this, 0), Ui.lp(MATCH, 0, 1f))
        root.addView(
            Ui.button(this, "Pay ${Money.format(minor)}") {
                startActivity(
                    Intent(this, PinActivity::class.java)
                        .putExtra(PayActivity.EXTRA_NAME, name)
                        .putExtra(PayActivity.EXTRA_VPA, vpa)
                        .putExtra(PayActivity.EXTRA_AMOUNT_MINOR, minor),
                )
                finish()
            },
            Ui.lp(MATCH, WRAP),
        )

        setContentView(root)
    }

    private fun field(label: String, value: String): View = Ui.column(this).apply {
        layoutParams = Ui.lp(MATCH, WRAP).apply { bottomMargin = dp(18) }
        addView(Ui.text(this@ConfirmActivity, label, 12f, Ui.MUTED))
        addView(Ui.spacer(this@ConfirmActivity, 3))
        addView(Ui.text(this@ConfirmActivity, value, 17f, Ui.INK, bold = true))
        addView(Ui.spacer(this@ConfirmActivity, 12))
        addView(Ui.divider(this@ConfirmActivity))
    }
}
