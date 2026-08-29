package com.ruko.devapp

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.ruko.devapp.Ui.body
import com.ruko.devapp.Ui.button
import com.ruko.devapp.Ui.card
import com.ruko.devapp.Ui.column
import com.ruko.devapp.Ui.eyebrow
import com.ruko.devapp.Ui.title
import com.ruko.nativemodule.monitoring.RukoForegroundService

/**
 * Entry point of the native harness.
 *
 * Three things it can do, all of which need a real device:
 *   - open RukoPayDemo, so the accessibility layer has a payment screen to read
 *   - open the Edge Engine screen, which reports what the device really supports
 *   - start and stop a real foreground microphone session
 *
 * It is not the Ruko product. It exists so the Android layer can be verified
 * on the iQOO 15 without waiting for the React Native app.
 */
class MainActivity : AppCompatActivity() {

    private var sessionRunning = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
                "Starts a real foreground microphone session. Android shows a green " +
                    "microphone dot and a notification you cannot swipe away, which is " +
                    "exactly the point: Ruko never listens invisibly.",
            ),
        )
        val toggle = button(this, "Start protection", primary = false) {}
        session.addView(toggle)
        toggle.setOnClickListener {
            if (sessionRunning) {
                RukoForegroundService.stop(this)
                sessionRunning = false
                toggle.text = "Start protection"
            } else {
                requestRuntimePermissions()
                val refusal = RukoForegroundService.start(this)
                if (refusal == null) {
                    sessionRunning = true
                    toggle.text = "Stop protection"
                } else {
                    // Android 14 refuses a microphone service started from the
                    // background. Say what happened rather than failing silently.
                    toggle.text = "Could not start: $refusal"
                }
            }
        }

        root.addView(actions)
        root.addView(session)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun requestRuntimePermissions() {
        val wanted = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            add(Manifest.permission.READ_PHONE_STATE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (wanted.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, wanted.toTypedArray(), REQUEST_CODE)
        }
    }

    private companion object {
        const val REQUEST_CODE = 4201
    }
}
