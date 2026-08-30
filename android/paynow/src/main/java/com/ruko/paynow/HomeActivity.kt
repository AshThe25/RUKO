package com.ruko.paynow

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.ruko.paynow.Ui.MATCH
import com.ruko.paynow.Ui.WRAP
import com.ruko.paynow.Ui.dp

/** Wallet home: balance, recent payees, and the two chats. */
class HomeActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifications.ensureChannel(this)
        requestNotificationPermission()
        setContentView(buildView())
    }

    override fun onResume() {
        super.onResume()
        // Rebuilt on resume so returning from a payment shows the fresh
        // transaction list rather than a stale snapshot.
        setContentView(buildView())
    }

    private fun buildView(): View {
        val root = Ui.column(this).apply { setBackgroundColor(Ui.CANVAS) }

        root.addView(header())

        val scroll = ScrollView(this)
        val body = Ui.column(this).apply { setPadding(dp(20), dp(20), dp(20), dp(32)) }

        body.addView(Ui.text(this, "Send money", 13f, Ui.MUTED, bold = true))
        body.addView(Ui.spacer(this, 12))
        Accounts.recents.forEach { payee ->
            body.addView(payeeRow(payee))
        }

        body.addView(Ui.spacer(this, 24))
        body.addView(Ui.text(this, "Chats", 13f, Ui.MUTED, bold = true))
        body.addView(Ui.spacer(this, 12))
        ChatScripts.all.forEach { script ->
            body.addView(chatRow(script))
        }

        scroll.addView(body)
        root.addView(scroll, Ui.lp(MATCH, 0, 1f))
        return root
    }

    /** The purple balance card. */
    private fun header(): View = Ui.column(this).apply {
        setBackgroundColor(Ui.PURPLE)
        setPadding(dp(20), dp(28), dp(20), dp(28))
        addView(Ui.text(this@HomeActivity, "PayNow", 20f, android.graphics.Color.WHITE, bold = true))
        addView(Ui.spacer(this@HomeActivity, 18))
        addView(Ui.text(this@HomeActivity, "Available balance", 13f, android.graphics.Color.parseColor("#DDD6FE")))
        addView(Ui.spacer(this@HomeActivity, 4))
        addView(Ui.text(this@HomeActivity, Accounts.displayBalance(), 34f, android.graphics.Color.WHITE, bold = true))
        addView(Ui.spacer(this@HomeActivity, 10))
        addView(Ui.text(this@HomeActivity, "${Accounts.BANK}  ·  ${Accounts.VPA}", 12f, android.graphics.Color.parseColor("#C4B5FD")))
    }

    private fun payeeRow(payee: Accounts.Payee): View = Ui.row(this).apply {
        background = Ui.rounded(android.graphics.Color.WHITE, 14, this@HomeActivity)
        setPadding(dp(14), dp(14), dp(14), dp(14))
        layoutParams = Ui.lp(MATCH, WRAP).apply { bottomMargin = dp(10) }
        isClickable = true
        setOnClickListener {
            startActivity(
                Intent(this@HomeActivity, PayActivity::class.java)
                    .putExtra(PayActivity.EXTRA_NAME, payee.name)
                    .putExtra(PayActivity.EXTRA_VPA, payee.vpa),
            )
        }

        addView(avatar(payee.initials, Ui.PURPLE))
        addView(
            Ui.column(this@HomeActivity).apply {
                addView(Ui.text(this@HomeActivity, payee.name, 15f, Ui.INK, bold = true))
                addView(Ui.text(this@HomeActivity, payee.vpa, 12f, Ui.MUTED))
            },
            Ui.lp(0, WRAP, 1f).apply { marginStart = dp(14) },
        )
        addView(Ui.text(this@HomeActivity, "›", 22f, Ui.MUTED))
    }

    private fun chatRow(script: ChatScripts.Script): View = Ui.row(this).apply {
        background = Ui.rounded(android.graphics.Color.WHITE, 14, this@HomeActivity)
        setPadding(dp(14), dp(14), dp(14), dp(14))
        layoutParams = Ui.lp(MATCH, WRAP).apply { bottomMargin = dp(10) }
        isClickable = true
        setOnClickListener {
            startActivity(
                Intent(this@HomeActivity, ChatActivity::class.java)
                    .putExtra(ChatActivity.EXTRA_SCRIPT, script.id),
            )
        }
        addView(avatar(script.initials, Ui.PURPLE_DARK))
        addView(
            Ui.column(this@HomeActivity).apply {
                addView(Ui.text(this@HomeActivity, script.sender, 15f, Ui.INK, bold = true))
                addView(Ui.text(this@HomeActivity, script.preview, 12f, Ui.MUTED))
            },
            Ui.lp(0, WRAP, 1f).apply { marginStart = dp(14) },
        )
        addView(Ui.text(this@HomeActivity, "›", 22f, Ui.MUTED))
    }

    private fun avatar(initials: String, color: Int): View =
        Ui.text(this, initials, 14f, android.graphics.Color.WHITE, bold = true).apply {
            gravity = Gravity.CENTER
            background = Ui.circle(color)
            layoutParams = LinearLayout.LayoutParams(dp(42), dp(42))
        }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.POST_NOTIFICATIONS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
