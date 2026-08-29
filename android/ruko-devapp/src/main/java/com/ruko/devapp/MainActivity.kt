package com.ruko.devapp

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.ruko.devapp.Ui.body
import com.ruko.devapp.Ui.button
import com.ruko.devapp.Ui.card
import com.ruko.devapp.Ui.column
import com.ruko.devapp.Ui.eyebrow
import com.ruko.devapp.Ui.row
import com.ruko.devapp.Ui.title
import com.ruko.nativemodule.accessibility.RukoAccessibilityService
import com.ruko.nativemodule.notifications.RukoNotificationListenerService
import com.ruko.nativemodule.runtime.RukoProtectionRuntime

/**
 * Entry point of the native harness.
 *
 * Three things it can do, all of which need a real device:
 *   - open RukoPayDemo, so the accessibility layer has a payment screen to read
 *   - open the Edge Engine screen, which reports what the device really supports
 *   - start and stop a real protected session — foreground service, accessibility
 *     provider and microphone together, all through [RukoProtectionRuntime]
 *
 * It is not the Ruko product. It exists so the Android layer can be verified on
 * the iQOO 15 without waiting for the React Native app.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var toggle: Button
    private lateinit var permissionCard: LinearLayout
    private var statusLine: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Mic failures during a session surface here rather than vanishing.
        RukoProtectionRuntime.onError = { _, message ->
            runOnUiThread {
                statusLine?.text = message
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            }
        }

        val root = column(this)
        root.addView(eyebrow(this, "Ruko"))
        root.addView(title(this, "Native harness"))
        root.addView(
            body(
                this,
                "Exercises the Android layer directly on this device. This is not the " +
                    "Ruko product interface — it is how we verify that the services, " +
                    "providers and runtime diagnostics actually work on real hardware.",
            ),
        )

        val actions = card(this)
        actions.addView(eyebrow(this, "Run something"))
        actions.addView(
            button(this, "Open RukoPay Demo", primary = true) {
                startActivity(Intent(this, PayDemoActivity::class.java))
            },
        )
        actions.addView(
            button(this, "Edge Engine diagnostics", primary = false) {
                startActivity(Intent(this, EngineeringActivity::class.java))
            },
        )

        val session = card(this)
        session.addView(eyebrow(this, "Protected session"))
        session.addView(
            body(
                this,
                "Starts a real foreground microphone session AND attaches the accessibility " +
                    "payment reader. Android shows a green microphone dot and a notification " +
                    "you cannot swipe away, which is exactly the point: Ruko never listens " +
                    "invisibly.",
            ),
        )
        toggle = button(this, protectionLabel(), primary = false) {}
        toggle.setOnClickListener { onToggleProtection() }
        session.addView(toggle)
        val status = body(this, "", muted = true)
        statusLine = status
        session.addView(status)

        // #11: distinct actions for each special permission, not one shared button.
        permissionCard = card(this)
        root.addView(actions)
        root.addView(session)
        root.addView(permissionCard)
        setContentView(ScrollView(this).apply { addView(root) })

        buildPermissionCard()
    }

    override fun onResume() {
        super.onResume()
        // #12: the session's truth lives in the runtime, not a field on this
        // activity. If the notification's Stop ended it, or the activity was
        // recreated, the button reflects reality on return.
        toggle.text = protectionLabel()
        buildPermissionCard()
    }

    private fun protectionLabel(): String =
        if (RukoProtectionRuntime.isRunning) "Stop protection" else "Start protection"

    private fun onToggleProtection() {
        if (RukoProtectionRuntime.isRunning) {
            RukoProtectionRuntime.stop(this)
            toggle.text = protectionLabel()
            statusLine?.text = ""
            return
        }

        // #4: do not start before microphone permission is actually granted.
        // Explain, request, and let onRequestPermissionsResult start the session
        // once the user has said yes — never race the dialog.
        val needed = missingRuntimePermissions()
        if (needed.isNotEmpty()) {
            statusLine?.text =
                "Ruko needs the microphone (and phone state) to listen during a protected " +
                    "session. Grant the permission to continue."
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), REQUEST_CODE)
            return
        }
        beginProtection()
    }

    private fun beginProtection() {
        val refusal = RukoProtectionRuntime.start(this)
        if (refusal == null) {
            toggle.text = protectionLabel()
            statusLine?.text = "Protected session running. See the notification and green dot."
        } else {
            // e.g. Android 14 refusing a background-started microphone service.
            toggle.text = protectionLabel()
            statusLine?.text = "Could not start: $refusal"
        }
    }

    private fun missingRuntimePermissions(): List<String> = buildList {
        add(Manifest.permission.RECORD_AUDIO)
        add(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }.filter {
        ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CODE) return

        val micIndex = permissions.indexOf(Manifest.permission.RECORD_AUDIO)
        val micGranted = micIndex >= 0 &&
            grantResults.getOrNull(micIndex) == PackageManager.PERMISSION_GRANTED

        if (micGranted) {
            // Only now — with a real GRANTED result in hand — do we start.
            beginProtection()
        } else {
            statusLine?.text =
                "Microphone permission was not granted, so protection cannot start."
        }
    }

    /** #11: one row + one settings button per special permission. */
    private fun buildPermissionCard() {
        permissionCard.removeAllViews()
        permissionCard.addView(eyebrow(this, "Permissions"))

        addPermissionControl(
            label = "Accessibility",
            granted = RukoAccessibilityService.isConnected(),
            buttonText = "Open accessibility settings",
        ) {
            startActivitySafely(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        addPermissionControl(
            label = "Notification access",
            granted = RukoNotificationListenerService.isEnabled(this),
            buttonText = "Open notification access",
        ) {
            startActivitySafely(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        addPermissionControl(
            label = "Display over other apps",
            granted = Settings.canDrawOverlays(this),
            buttonText = "Open overlay settings",
        ) {
            // Open straight to this app's overlay toggle, not the app list.
            startActivitySafely(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                ),
            )
        }

        addPermissionControl(
            label = "Battery optimisation",
            granted = null, // Not a simple yes/no; opening the screen is the action.
            buttonText = "Open battery optimisation",
        ) {
            startActivitySafely(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun addPermissionControl(
        label: String,
        granted: Boolean?,
        buttonText: String,
        onClick: () -> Unit,
    ) {
        val value = when (granted) {
            true -> "granted"
            false -> "not granted"
            null -> "—"
        }
        permissionCard.addView(row(this, label, value))
        permissionCard.addView(button(this, buttonText, primary = false, onClick))
    }

    private fun startActivitySafely(intent: Intent) {
        runCatching { startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure {
                Toast.makeText(this, "Could not open that settings screen.", Toast.LENGTH_SHORT).show()
            }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Do not tear down the session here: it is owned by the runtime and the
        // foreground service, and must survive this activity being recreated.
        if (isFinishing) RukoProtectionRuntime.onError = null
    }

    private companion object {
        const val REQUEST_CODE = 4201
    }
}
