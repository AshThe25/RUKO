package com.ruko.devapp

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Small view helpers so the harness screens stay readable.
 *
 * Deliberately plain Android views: no Compose, no data binding. This module
 * has to build fast and fail obviously, because its whole job is to tell the
 * truth about the device.
 */
object Ui {

    fun Context.dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics,
        ).toInt()

    fun column(context: Context, padding: Int = 20): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val p = with(Ui) { context.dp(padding) }
            setPadding(p, p, p, p)
        }

    fun eyebrow(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text.uppercase()
            setTextColor(ContextCompat.getColor(context, R.color.text_muted))
            textSize = 11f
            letterSpacing = 0.16f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }

    fun title(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(ContextCompat.getColor(context, R.color.text))
            textSize = 24f
            letterSpacing = -0.01f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }

    fun body(context: Context, text: String, muted: Boolean = true): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(
                ContextCompat.getColor(context, if (muted) R.color.text_muted else R.color.text),
            )
            textSize = 14f
            setLineSpacing(with(Ui) { context.dp(4) }.toFloat(), 1f)
        }

    fun mono(context: Context, text: String, color: Int): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(color)
            textSize = 13f
            typeface = android.graphics.Typeface.MONOSPACE
        }

    /** A label/value row. Values are always measured or probed, never illustrative. */
    fun row(context: Context, label: String, value: String, valueColor: Int? = null): View =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val gap = with(Ui) { context.dp(3) }
            setPadding(0, gap * 2, 0, gap * 2)
            addView(
                TextView(context).apply {
                    this.text = label.uppercase()
                    setTextColor(ContextCompat.getColor(context, R.color.text_faint))
                    textSize = 10f
                    letterSpacing = 0.14f
                },
            )
            addView(
                mono(
                    context,
                    value,
                    valueColor ?: ContextCompat.getColor(context, R.color.text),
                ),
            )
        }

    fun card(context: Context): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val p = with(Ui) { context.dp(16) }
            setPadding(p, p, p, p)
            background = GradientDrawable().apply {
                setColor(ContextCompat.getColor(context, R.color.surface))
                cornerRadius = with(Ui) { context.dp(10) }.toFloat()
                setStroke(1, ContextCompat.getColor(context, R.color.border))
            }
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                topMargin = with(Ui) { context.dp(12) }
            }
        }

    fun button(context: Context, text: String, primary: Boolean, onClick: () -> Unit): Button =
        Button(context).apply {
            this.text = text
            isAllCaps = false
            textSize = 15f
            setTextColor(if (primary) Color.WHITE else ContextCompat.getColor(context, R.color.text))
            background = GradientDrawable().apply {
                cornerRadius = with(Ui) { context.dp(8) }.toFloat()
                if (primary) {
                    setColor(ContextCompat.getColor(context, R.color.critical))
                } else {
                    setColor(Color.TRANSPARENT)
                    setStroke(2, ContextCompat.getColor(context, R.color.border))
                }
            }
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                topMargin = with(Ui) { context.dp(10) }
            }
            setPadding(0, with(Ui) { context.dp(14) }, 0, with(Ui) { context.dp(14) })
            setOnClickListener { onClick() }
        }
}
