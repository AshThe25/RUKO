package com.ruko.paynow

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/**
 * A very small view kit.
 *
 * The layouts are built in code rather than XML. This module has no design
 * system to inherit and only six screens, so code keeps the whole app readable
 * in one pass — and, more practically, it keeps the text nodes explicit, which
 * matters because those nodes are exactly what Ruko reads.
 */
object Ui {

    val PURPLE = Color.parseColor("#5B21B6")
    val PURPLE_DARK = Color.parseColor("#4C1D95")
    val INK = Color.parseColor("#111827")
    val MUTED = Color.parseColor("#6B7280")
    val LINE = Color.parseColor("#E5E7EB")
    val CANVAS = Color.parseColor("#F9FAFB")
    val GREEN = Color.parseColor("#059669")

    fun Context.dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics,
    ).toInt()

    fun column(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
    }

    fun row(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun text(
        context: Context,
        value: String,
        size: Float = 15f,
        color: Int = INK,
        bold: Boolean = false,
    ): TextView = TextView(context).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    fun rounded(color: Int, radiusDp: Int, context: Context): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = context.dp(radiusDp).toFloat()
        }

    fun circle(color: Int): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    /** A filled primary button. Disabled state is visibly different, not just inert. */
    fun button(context: Context, label: String, onClick: () -> Unit): TextView =
        text(context, label, size = 16f, color = Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            background = rounded(PURPLE, 14, context)
            setPadding(0, context.dp(16), 0, context.dp(16))
            isClickable = true
            setOnClickListener { onClick() }
        }

    fun spacer(context: Context, heightDp: Int): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, context.dp(heightDp),
        )
    }

    fun divider(context: Context): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1)
        setBackgroundColor(LINE)
    }

    fun lp(width: Int, height: Int, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(width, height, weight)

    const val MATCH = LinearLayout.LayoutParams.MATCH_PARENT
    const val WRAP = LinearLayout.LayoutParams.WRAP_CONTENT
}
