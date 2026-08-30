package com.ruko.paynow

import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
            },
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
    }
}
