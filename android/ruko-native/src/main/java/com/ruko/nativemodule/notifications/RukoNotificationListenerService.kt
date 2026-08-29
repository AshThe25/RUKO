package com.ruko.nativemodule.notifications

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.ruko.core.NotificationEvidence
import com.ruko.core.NotificationRelevanceFilter
import java.util.ArrayDeque

/**
 * Turns finance-related notifications into corroborating evidence.
 *
 * The filtering happens *before* anything is kept: a notification that is not
 * finance-related and does not match a scam pattern never enters the buffer, is
 * never logged, and is never counted. What survives is a redacted excerpt with
 * links, amounts and long digit runs stripped.
 *
 * A suspicious notification on its own can never reach CRITICAL — the filter
 * caps single-notification suspicion, and the risk engine weights it as
 * corroboration (build prompt §14). The value is in the combination: a phishing
 * SMS *plus* a live call *plus* a new payee is a very different picture from
 * any one of them alone.
 *
 * All the logic lives in `ruko-core` and is unit tested; this class is the
 * Android shell around it.
 */
class RukoNotificationListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        connected = true
    }

    override fun onListenerDisconnected() {
        connected = false
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val posted = sbn ?: return
        if (posted.packageName == packageName) return // never our own

        val extras = posted.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()

        val relevant = NotificationRelevanceFilter.evaluate(
            NotificationRelevanceFilter.IncomingNotification(
                packageName = posted.packageName,
                title = title,
                text = text,
                postedAtEpochMs = posted.postTime,
            ),
        ) ?: return // irrelevant: nothing is retained

        synchronized(buffer) {
            buffer.addLast(relevant)
            while (buffer.size > MAX_BUFFERED) buffer.removeFirst()
        }
    }

    companion object {
        @Volatile
        private var connected = false

        private val buffer = ArrayDeque<NotificationRelevanceFilter.RelevantNotification>()

        /** Small on purpose: this is a lookback window, not a history. */
        private const val MAX_BUFFERED = 20

        /** True only when the user has granted notification access in Settings. */
        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners",
            ).orEmpty()
            val component = ComponentName(context, RukoNotificationListenerService::class.java)
            return connected ||
                enabled.split(":").any { it == component.flattenToString() }
        }

        fun evidence(
            nowEpochMs: Long = System.currentTimeMillis(),
            lookbackMinutes: Int = NotificationRelevanceFilter.DEFAULT_LOOKBACK_MINUTES,
        ): NotificationEvidence = synchronized(buffer) {
            NotificationRelevanceFilter.aggregate(buffer.toList(), nowEpochMs, lookbackMinutes)
        }

        /** Called when a protected session ends: the window should not outlive it. */
        fun clear() = synchronized(buffer) { buffer.clear() }
    }
}
