package com.ruko.nativemodule.monitoring

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.ruko.nativemodule.R

/**
 * Keeps a protected session alive and, just as importantly, visible.
 *
 * The notification is not a platform tax to be minimised — it is the honest
 * signal that Ruko is listening. It cannot be swiped away while the session
 * runs, it says plainly that nothing is recorded or uploaded, and it carries a
 * one-tap stop. Combined with Android 12's green microphone dot, a user can
 * always tell at a glance whether Ruko is on.
 *
 * Android 14+ requires the `microphone` foreground-service type and forbids
 * starting one from the background, so this is only ever started from a user
 * action in the app.
 */
class RukoForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        createChannel()
        startInForeground()

        // Not START_STICKY: if the system kills this, silently resurrecting a
        // microphone session the user cannot see would be exactly the kind of
        // behaviour the notification above exists to rule out.
        return START_NOT_STICKY
    }

    private fun startInForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, RukoForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.ruko_session_title))
            .setContentText(getString(R.string.ruko_session_text))
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // LOW, not HIGH: this is a persistent status, not an alert. The
            // alert is the intervention, and it must not have to compete with
            // its own status notification for attention.
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, getString(R.string.ruko_session_stop), stopIntent)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.ruko_channel_protection),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.ruko_channel_protection_description)
                setShowBadge(false)
            },
        )
    }

    companion object {
        const val CHANNEL_ID = "ruko_protection"
        const val NOTIFICATION_ID = 4201
        const val ACTION_STOP = "com.ruko.nativemodule.STOP_PROTECTION"

        /**
         * Must be called while the app is visible. From Android 12 a background
         * start throws `ForegroundServiceStartNotAllowedException`, and from 14
         * a microphone-type service is refused outright.
         *
         * @return null on success, or a message explaining the refusal.
         */
        fun start(context: Context): String? = try {
            context.startForegroundService(Intent(context, RukoForegroundService::class.java))
            null
        } catch (error: Exception) {
            error.message ?: "Protection could not start from the background."
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, RukoForegroundService::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
