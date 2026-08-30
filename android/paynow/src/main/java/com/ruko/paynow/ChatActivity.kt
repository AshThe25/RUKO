package com.ruko.paynow

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/**
 * A message thread that plays a scripted conversation.
 *
 * Each incoming line is both drawn in the thread and posted as a real system
 * notification, so Ruko sees it the way it would see any messaging app. The
 * script plays on a timer rather than on taps: a live demo where the presenter
 * has to keep tapping "next" looks like a slideshow, and the delays also give
 * Ruko's pipeline the same realistic spacing between messages it would get in
 * a real conversation.
 */
class ChatActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var thread: android.widget.LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var script: ChatScripts.Script

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifications.ensureChannel(this)
        script = ChatScripts.byId(intent.getStringExtra(EXTRA_SCRIPT))

        val root = Ui.column(this).apply { setBackgroundColor(Ui.CANVAS) }
        root.addView(header())

        thread = Ui.column(this).apply { setPadding(dp(14), dp(14), dp(14), dp(14)) }
        scroll = ScrollView(this)
        scroll.addView(thread)
        root.addView(scroll, Ui.lp(MATCH, 0, 1f))

        root.addView(composer())
        setContentView(root)

        play()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
    }

    private fun header(): View = Ui.row(this).apply {
        setBackgroundColor(Ui.PURPLE)
        setPadding(dp(16), dp(22), dp(16), dp(16))
        addView(
            Ui.text(this@ChatActivity, script.initials, 13f, android.graphics.Color.WHITE, bold = true).apply {
                gravity = Gravity.CENTER
                background = Ui.circle(Ui.PURPLE_DARK)
                layoutParams = Ui.lp(dp(38), dp(38))
            },
        )
        addView(
            Ui.column(this@ChatActivity).apply {
                addView(Ui.text(this@ChatActivity, script.sender, 16f, android.graphics.Color.WHITE, bold = true))
                addView(Ui.text(this@ChatActivity, "online", 12f, android.graphics.Color.parseColor("#C4B5FD")))
            },
            Ui.lp(0, WRAP, 1f).apply { marginStart = dp(12) },
        )
    }

    /** Plays each scripted line at its own offset from the start of the thread. */
    private fun play() {
        script.lines.forEach { line ->
            handler.postDelayed({ append(line) }, line.afterMs)
        }
    }

    private fun append(line: ChatScripts.Line) {
        thread.addView(bubble(line.text, line.incoming))
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        if (line.incoming) {
            Notifications.postMessage(this, script.sender, line.text, script.id)
        }
    }

    private fun bubble(body: String, incoming: Boolean): View = Ui.row(this).apply {
        layoutParams = Ui.lp(MATCH, WRAP).apply { bottomMargin = dp(8) }
        gravity = if (incoming) Gravity.START else Gravity.END
        addView(
            Ui.text(
                this@ChatActivity, body, 15f,
                if (incoming) Ui.INK else android.graphics.Color.WHITE,
            ).apply {
                background = Ui.rounded(
                    if (incoming) android.graphics.Color.WHITE else Ui.PURPLE, 16, this@ChatActivity,
                )
                setPadding(dp(14), dp(11), dp(14), dp(11))
                maxWidth = resources.displayMetrics.widthPixels * 3 / 4
                // Only incoming messages are linkified. A UPI id the user typed
                // themselves is not a thing that should offer to pay itself.
                if (incoming) linkifyPayTargets(this, body)
            },
        )
    }

    /**
     * Turns a UPI id inside a message into a tappable pay link.
     *
     * This is how the scam actually arrives. Nobody reads "kyc.verify9931@ybl"
     * out of a chat bubble and retypes it into a payee field -- the message
     * hands them a link, they tap it, and the payment screen opens already
     * filled in with the attacker's id and the amount demanded. Making the
     * demo go through the payee list instead was quietly making the attack
     * look more effortful than it is, and it skipped the one moment Ruko is
     * built for: the jump straight from the pressure to the keypad.
     *
     * PayNow still shares no code with Ruko. This is an ordinary deep link
     * inside one app; Ruko sees the payment screen it opens through the
     * accessibility tree exactly as before.
     */
    private fun linkifyPayTargets(view: android.widget.TextView, body: String) {
        val matches = VPA_REGEX.findAll(body).toList()
        if (matches.isEmpty()) return

        // The amount named in the same message, when there is one -- the
        // demanded figure, prefilled the way a real payment link would.
        val amountMinor = AMOUNT_REGEX.find(body)
            ?.groupValues?.get(1)
            ?.let { Money.parse(it.replace(",", "")) }

        val span = SpannableString(body)
        matches.forEach { match ->
            val vpa = match.value
            val payee = Accounts.recents.firstOrNull { it.vpa == vpa }
            span.setSpan(
                object : ClickableSpan() {
                    override fun onClick(widget: View) = openPayment(vpa, payee?.name, amountMinor)
                    override fun updateDrawState(ds: android.text.TextPaint) {
                        ds.color = Ui.PURPLE
                        ds.isUnderlineText = true
                    }
                },
                match.range.first, match.range.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            span.setSpan(
                StyleSpan(android.graphics.Typeface.BOLD),
                match.range.first, match.range.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            span.setSpan(
                UnderlineSpan(),
                match.range.first, match.range.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        view.text = span
        view.movementMethod = LinkMovementMethod.getInstance()
        view.highlightColor = android.graphics.Color.TRANSPARENT
    }

    private fun openPayment(vpa: String, name: String?, amountMinor: Long?) {
        startActivity(
            Intent(this, PayActivity::class.java)
                .putExtra(PayActivity.EXTRA_NAME, name ?: vpa.substringBefore('@'))
                .putExtra(PayActivity.EXTRA_VPA, vpa)
                .apply { if (amountMinor != null) putExtra(PayActivity.EXTRA_PREFILL_MINOR, amountMinor) },
        )
    }

    /** Live and functional — the presenter can type a reply mid-demo. */
    private fun composer(): View {
        val input = EditText(this).apply {
            hint = "Message"
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15f)
        }
        return Ui.row(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            setPadding(dp(12), dp(8), dp(12), dp(12))
            addView(
                input.apply {
                    background = Ui.rounded(Ui.CANVAS, 20, this@ChatActivity)
                },
                Ui.lp(0, WRAP, 1f),
            )
            addView(
                Ui.text(this@ChatActivity, "Send", 15f, Ui.PURPLE, bold = true).apply {
                    setPadding(dp(14), dp(12), dp(4), dp(12))
                    isClickable = true
                    setOnClickListener {
                        val body = input.text.toString().trim()
                        if (body.isEmpty()) return@setOnClickListener
                        append(ChatScripts.Line(body, incoming = false, afterMs = 0))
                        input.setText("")
                    }
                },
            )
        }
    }

    companion object {
        const val EXTRA_SCRIPT = "script"

        private val VPA_REGEX =
            Regex("""\b[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}@[a-zA-Z]{2,20}\b""")

        private val AMOUNT_REGEX =
            Regex("""(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)
    }
}
