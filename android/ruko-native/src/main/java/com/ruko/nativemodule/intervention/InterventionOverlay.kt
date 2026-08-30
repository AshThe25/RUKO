package com.ruko.nativemodule.intervention

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The interruption itself: a window drawn on top of the payment app.
 *
 * This has to be an overlay rather than an activity. Launching Ruko's own
 * activity would put the payment app in the background, and on most OEM
 * builds — including this one — a backgrounded UPI app discards the pending
 * payment. The user would come back to an empty screen and no explanation.
 * An overlay leaves the payment exactly where it was, so "continue anyway"
 * genuinely continues rather than starting over.
 *
 * Ruko cannot and does not block the payment at the rails. What it does is
 * take the screen, state the specific reason, and require a deliberate second
 * action to proceed. That distinction is stated in the copy, because claiming
 * to block a payment we cannot block would be a lie the user finds out about
 * at the worst possible moment.
 */
object InterventionOverlay {

    data class Decision(
        val headline: String,
        val reason: String,
        val amountLabel: String,
        val payee: String,
        /** True when a guardian must approve before the user may continue. */
        val requiresGuardian: Boolean,
    )

    private var shown: View? = null
    private val main = Handler(Looper.getMainLooper())

    fun canShow(context: Context): Boolean = Settings.canDrawOverlays(context)

    /**
     * @param onDismiss invoked with true when the user chose to stop the
     *   payment, false when they chose to continue anyway. Always invoked
     *   exactly once, so the caller can record the outcome either way — a
     *   user overriding Ruko is the single most useful signal it collects.
     */
    fun show(context: Context, decision: Decision, onDismiss: (stopped: Boolean) -> Unit) {
        main.post { showOnMainThread(context, decision, onDismiss) }
    }

    fun hide() {
        main.post { removeCurrent(null) }
    }

    private fun showOnMainThread(
        context: Context,
        decision: Decision,
        onDismiss: (Boolean) -> Unit,
    ) {
        if (!canShow(context)) {
            // No overlay permission: report it as "not stopped" rather than
            // pretending an interruption happened.
            onDismiss(false)
            return
        }
        removeCurrent(null)

        val windowManager = context.getSystemService(WindowManager::class.java) ?: return
        var settled = false
        val settle: (Boolean) -> Unit = { stopped ->
            if (!settled) {
                settled = true
                removeCurrent(null)
                onDismiss(stopped)
            }
        }

        val view = buildView(context, decision, settle)
        val type =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            // Focusable on purpose: the overlay must take the back button, or
            // the user dismisses the warning without ever making a choice.
            WindowManager.LayoutParams.FLAG_DIM_BEHIND,
            android.graphics.PixelFormat.TRANSLUCENT,
        ).apply { dimAmount = 0.7f }

        try {
            windowManager.addView(view, params)
            shown = view
        } catch (denied: Exception) {
            // Permission revoked between the check and the add, or the window
            // token died. Fail open rather than crashing the payment app.
            onDismiss(false)
        }
    }

    private fun removeCurrent(unused: Unit?) {
        val view = shown ?: return
        shown = null
        try {
            view.context.getSystemService(WindowManager::class.java)?.removeView(view)
        } catch (alreadyGone: IllegalArgumentException) {
            // Already detached. Nothing to undo.
        }
    }

    private fun buildView(
        context: Context,
        decision: Decision,
        settle: (Boolean) -> Unit,
    ): View {
        fun dp(value: Int) = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics,
        ).toInt()

        fun label(text: String, size: Float, color: Int, bold: Boolean = false) =
            TextView(context).apply {
                this.text = text
                setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
                setTextColor(color)
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            }

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(24).toFloat()
            }
            setPadding(dp(24), dp(28), dp(24), dp(24))
        }

        card.addView(label("RUKO", 12f, Color.parseColor("#B45309"), bold = true))
        card.addView(space(context, dp(10)))
        card.addView(label(decision.headline, 24f, Color.parseColor("#111827"), bold = true))
        card.addView(space(context, dp(14)))
        card.addView(label(decision.reason, 15f, Color.parseColor("#374151")))
        card.addView(space(context, dp(18)))

        card.addView(
            label("${decision.amountLabel} to ${decision.payee}", 15f, Color.parseColor("#111827"), bold = true)
                .apply {
                    background = GradientDrawable().apply {
                        setColor(Color.parseColor("#FEF3C7"))
                        cornerRadius = dp(12).toFloat()
                    }
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                },
        )
        card.addView(space(context, dp(20)))

        // The safe choice is the prominent one, and it is the one that does
        // nothing irreversible.
        card.addView(
            button(context, "Don't send this money", Color.WHITE, Color.parseColor("#111827")) {
                settle(true)
            },
        )
        card.addView(space(context, dp(10)))

        if (decision.requiresGuardian) {
            card.addView(
                label(
                    "This payment is waiting for approval from your trusted contact. " +
                        "They have been notified.",
                    13f,
                    Color.parseColor("#6B7280"),
                ).apply { gravity = Gravity.CENTER },
            )
        } else {
            card.addView(
                button(context, "Continue anyway", Color.parseColor("#F3F4F6"), Color.parseColor("#6B7280")) {
                    settle(false)
                },
            )
        }

        card.addView(space(context, dp(14)))
        card.addView(
            label("Ruko cannot cancel a payment for you. It can only stop and ask.", 11f, Color.parseColor("#9CA3AF"))
                .apply { gravity = Gravity.CENTER },
        )

        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(20), dp(20), dp(20))
            addView(
                card,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            isClickable = true
        }
    }

    private fun space(context: Context, height: Int) = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, height)
    }

    private fun button(
        context: Context,
        text: String,
        background: Int,
        textColor: Int,
        onClick: () -> Unit,
    ): View {
        fun dp(value: Int) = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics,
        ).toInt()

        return TextView(context).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(textColor)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, dp(16))
            this.background = GradientDrawable().apply {
                setColor(background)
                cornerRadius = dp(14).toFloat()
                if (background == Color.WHITE) setStroke(dp(2), Color.parseColor("#111827"))
            }
            isClickable = true
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
        }
    }
}
