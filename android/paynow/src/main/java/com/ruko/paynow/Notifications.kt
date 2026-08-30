package com.ruko.paynow

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts real system notifications for incoming messages.
 *
 * This is the point of contact with Ruko. An in-app-only message would look
 * identical on screen and prove nothing: Ruko reads messages through the system
 * NotificationListener, so the demo has to go through the real notification
 * path or it is not testing anything.
 *
 * Notifications are posted with MessagingStyle and a per-conversation id, which
 * is how messaging apps actually post, so the listener sees the same structure
 * it would see from WhatsApp.
 */
object Notifications {

    private const val CHANNEL_ID = "paynow_messages"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "New message notifications"
        }
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    fun postMessage(context: Context, sender: String, body: String, conversationId: String) {
        val person = androidx.core.app.Person.Builder().setName(sender).build()
        val style = NotificationCompat.MessagingStyle(person)
            .setConversationTitle(sender)
            .addMessage(body, System.currentTimeMillis(), person)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_email)
            .setContentTitle(sender)
            .setContentText(body)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()

        try {
            NotificationManagerCompat.from(context)
                .notify(conversationId.hashCode(), notification)
        } catch (denied: SecurityException) {
            // POST_NOTIFICATIONS was refused. The chat still plays on screen;
            // only the Ruko hand-off is lost, and silently swallowing the
            // crash is better than taking the demo down mid-conversation.
        }
    }
}
