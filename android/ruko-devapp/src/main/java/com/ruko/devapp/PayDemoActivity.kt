package com.ruko.devapp

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.ruko.core.PayeeHasher
import com.ruko.devapp.Ui.dp
import com.ruko.nativemodule.payment.DemoPaymentProvider
import com.ruko.nativemodule.overlay.RukoInterventionOverlay
import java.security.SecureRandom

/**
 * RukoPayDemo — the controlled payment app (build prompt §37).
 *
 * This exists for one reason: no public Android API lets a normal app observe
 * or halt a real UPI payment. So Ruko needs one payment flow it genuinely
 * controls end to end, in order to demonstrate the protection honestly.
 *
 * It deliberately looks like an ordinary payment app rather than like Ruko —
 * light theme, its own task, its own label. The point of the demo is that Ruko
 * detects this screen **from the outside**, the same way it would detect any
 * other payment app, using the accessibility layer.
 *
 * The scam detection above it is real. Only this payment surface is ours.
 */
class PayDemoActivity : AppCompatActivity() {

    /**
     * ₹48,000 in paise — the amount from the pitch. Integer money only; the
     * rupee value never exists as a float anywhere in the pipeline.
     */
    private val amountMinor = 4_800_000L
    private val payeeName = "Ravi Verify"
    private val payeeId = "ravi.verify@okaxis"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            setBackgroundColor(Color.WHITE)
        }

        root.addView(
            TextView(this).apply {
                text = "RukoPay"
                setTextColor(Color.parseColor("#FF101418"))
                textSize = 15f
                letterSpacing = 0.12f
                typeface = Typeface.DEFAULT_BOLD
            },
        )

        root.addView(
            TextView(this).apply {
                text = "Paying to"
                setTextColor(Color.parseColor("#FF6B7280"))
                textSize = 13f
                setPadding(0, dp(40), 0, dp(6))
            },
        )

        // These node texts are exactly what RukoAccessibilityService reads and
        // PaymentScreenParser turns into a PaymentEvidence. Keeping them in the
        // ordinary "label then value" shape a real payment app uses is the
        // whole point — the parser must not be tuned to something artificial.
        root.addView(
            TextView(this).apply {
                text = payeeName
                setTextColor(Color.parseColor("#FF101418"))
                textSize = 22f
                typeface = Typeface.DEFAULT_BOLD
            },
        )

        root.addView(
            TextView(this).apply {
                text = payeeId
                setTextColor(Color.parseColor("#FF6B7280"))
                textSize = 14f
                setPadding(0, dp(4), 0, 0)
            },
        )

        root.addView(
            TextView(this).apply {
                text = "₹48,000"
                setTextColor(Color.parseColor("#FF101418"))
                textSize = 44f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(0, dp(36), 0, dp(8))
            },
        )

        root.addView(
            TextView(this).apply {
                text = "UPI • Axis Bank ••4417"
                setTextColor(Color.parseColor("#FF6B7280"))
                textSize = 13f
            },
        )

        val pay = Button(this).apply {
            text = "PAY NOW"
            isAllCaps = true
            textSize = 15f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FF1A73E8"))
                cornerRadius = dp(8).toFloat()
            }
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, dp(16))
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                topMargin = dp(48)
            }
        }
        root.addView(pay)

        root.addView(
            TextView(this).apply {
                text = "Demo payment surface. No money moves. Ruko must detect this " +
                    "screen from outside, the same way it would detect any payment app."
                setTextColor(Color.parseColor("#FF9AA3AF"))
                textSize = 12f
                setPadding(0, dp(20), 0, 0)
            },
        )

        pay.setOnClickListener {
            // Hand the payment to the native layer exactly as a real detection
            // would. From here the pipeline is the real one.
            DemoPaymentProvider.beginPayment(
                amountMinor = amountMinor,
                payee = payeeName,
                payeeHash = PayeeHasher.hash(payeeId, sessionSalt),
            )
            // #10: a real intervention drawn above this payment screen. RukoPay
            // runs in its own task, so the only way to warn over it is a genuine
            // system overlay — which is exactly what a real deployment would do.
            val shown = RukoInterventionOverlay.show(
                context = this,
                title = "Slow down — ₹48,000 to a new payee",
                message = "You are about to send ₹48,000 to \u201C$payeeName\u201D " +
                    "($payeeId), a payee with no prior history on this device. If someone " +
                    "on a call told you to pay this, stop and verify first.",
            )
            if (shown) {
                Toast.makeText(
                    this,
                    "Ruko raised an intervention over this screen.",
                    Toast.LENGTH_SHORT,
                ).show()
            } else {
                Toast.makeText(
                    this,
                    "Payment published, but ‘Display over other apps’ is off — grant it " +
                        "in the harness to see the intervention overlay.",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }

        setContentView(root)
    }

    override fun onDestroy() {
        DemoPaymentProvider.endPayment()
        RukoInterventionOverlay.hide(this)
        super.onDestroy()
    }

    private companion object {
        /**
         * A throwaway salt: this harness has no persistent profile, and a
         * hard-coded one would make the hashes comparable across installs.
         */
        val sessionSalt: ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }
    }
}
