package com.ruko.nativemodule.overlay

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The intervention drawn *over* whatever payment screen is in front — including
 * RukoPay, which is a separate task and cannot be reached from inside this app
 * any other way.
 *
 * The manifest has always declared SYSTEM_ALERT_WINDOW, but nothing used it, so
 * "overlay: granted" on the engineering screen proved only that a permission
 * existed, not that Ruko could act on it (Puneesh brief §10). This is the actual
 * window. It is a real `TYPE_APPLICATION_OVERLAY`, added and removed through the
 * WindowManager, and it survives task switches because it is not owned by any
 * one activity.
 *
 * It is deliberately loud and unmissable: an intervention the user can ignore is
 * not an intervention. A single Dismiss returns control; Ruko never blocks the
 * payment itself, it makes the user stop and look.
 */
object RukoInterventionOverlay {

    private var view: View? = null

    /** Whether the platform will let us draw over other apps right now. */
    fun canShow(context: Context): Boolean = Settings.canDrawOverlays(context)

    /**
     * Show the intervention. No-op (returns false) if overlay permission is not
     * granted — the caller should route the user to Settings rather than fail
     * silently. Idempotent: showing while already visible replaces the content.
     */
    fun show(
        context: Context,
        title: String,
        message: String,
        onDismiss: (() -> Unit)? = null,
    ): Boolean {
        if (!canShow(context)) return false
        val app = context.applicationContext
        val windowManager = app.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return false

        hide(context)

        val card = LinearLayout(app).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(app, 22), dp(app, 22), dp(app, 22), dp(app, 22))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FF1B0E0E"))
                cornerRadius = dp(app, 18).toFloat()
                setStroke(dp(app, 2), Color.parseColor("#FFE5484D"))
            }
        }

        card.addView(
            TextView(app).apply {
                text = "⚠  Ruko"
                setTextColor(Color.parseColor("#FFE5484D"))
                textSize = 13f
                letterSpacing = 0.12f
                typeface = Typeface.DEFAULT_BOLD
            },
        )
        card.addView(
            TextView(app).apply {
                text = title
                setTextColor(Color.WHITE)
                textSize = 21f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(0, dp(app, 10), 0, 0)
            },
        )
        card.addView(
            TextView(app).apply {
                text = message
                setTextColor(Color.parseColor("#FFE9D8D8"))
                textSize = 15f
                setPadding(0, dp(app, 10), 0, 0)
            },
        )
        card.addView(
            Button(app).apply {
                text = "I understand — dismiss"
                isAllCaps = false
                textSize = 15f
                setTextColor(Color.WHITE)
                typeface = Typeface.DEFAULT_BOLD
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#FFE5484D"))
                    cornerRadius = dp(app, 10).toFloat()
                }
                setPadding(0, dp(app, 14), 0, dp(app, 14))
                layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                    topMargin = dp(app, 18)
                }
                setOnClickListener {
                    hide(app)
                    onDismiss?.invoke()
                }
            },
        )

        val wrapper = LinearLayout(app).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(app, 20), 0, dp(app, 20), 0)
            addView(
                card,
                LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
            )
        }

        val type =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

        val params = WindowManager.LayoutParams(
            MATCH_PARENT,
            MATCH_PARENT,
            type,
            // Dim what is behind it, but let the user still see the payment they
            // are being warned about. Not focusable so the payment app keeps its
            // state; the only control here is our Dismiss button.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_DIM_BEHIND,
            PixelFormat.TRANSLUCENT,
        ).apply {
            dimAmount = 0.55f
            gravity = Gravity.CENTER
        }

        return try {
            windowManager.addView(wrapper, params)
            view = wrapper
            true
        } catch (t: Throwable) {
            view = null
            false
        }
    }

    /** Remove the overlay if present. Safe to call when nothing is showing. */
    fun hide(context: Context) {
        val current = view ?: return
        val app = context.applicationContext
        val windowManager = app.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        runCatching { windowManager?.removeView(current) }
        view = null
    }

    val isShowing: Boolean get() = view != null

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()
}
