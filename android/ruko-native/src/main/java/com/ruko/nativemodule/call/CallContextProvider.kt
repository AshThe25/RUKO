package com.ruko.nativemodule.call

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.ruko.core.CallEvidence

/**
 * Reports whether a call is in progress, and for how long.
 *
 * That is all Ruko asks for, and it is a deliberate limit. The caller's number
 * needs `READ_CALL_LOG`, which Play policy restricts and which would buy us the
 * "unknown caller" signal — worth 5 of 100 points in the risk engine. Trading a
 * heavyweight permission for 5 points is a bad deal, so `callerKnown` is
 * honestly reported as false and the risk engine treats it as weak evidence.
 *
 * See docs/android-capabilities.md §4.
 */
class CallContextProvider(private val context: Context) {

    @Volatile
    private var callActive = false

    @Volatile
    private var callStartedAtMs = 0L

    var onCallStateChanged: ((active: Boolean) -> Unit)? = null

    private var modernCallback: Any? = null

    @Suppress("DEPRECATION")
    private var legacyListener: PhoneStateListener? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) ==
            PackageManager.PERMISSION_GRANTED

    fun start(): Boolean {
        if (!hasPermission()) return false
        val telephony = context.getSystemService(TelephonyManager::class.java) ?: return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) = handleState(state)
            }
            modernCallback = callback
            telephony.registerTelephonyCallback(context.mainExecutor, callback)
        } else {
            @Suppress("DEPRECATION")
            val listener = object : PhoneStateListener() {
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    // phoneNumber is empty without READ_CALL_LOG. Ignored either way.
                    handleState(state)
                }
            }
            legacyListener = listener
            @Suppress("DEPRECATION")
            telephony.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
        }
        return true
    }

    fun stop() {
        val telephony = context.getSystemService(TelephonyManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (modernCallback as? TelephonyCallback)?.let { telephony?.unregisterTelephonyCallback(it) }
            modernCallback = null
        } else {
            @Suppress("DEPRECATION")
            legacyListener?.let { telephony?.listen(it, PhoneStateListener.LISTEN_NONE) }
            legacyListener = null
        }
        callActive = false
    }

    fun current(): CallEvidence = CallEvidence(
        active = callActive,
        // Honest default. Ruko does not request READ_CALL_LOG, so it genuinely
        // does not know whether this caller is in the user's contacts.
        callerKnown = false,
        durationSeconds = if (callActive && callStartedAtMs > 0) {
            (System.currentTimeMillis() - callStartedAtMs) / 1000
        } else {
            0
        },
        audioFromMicrophone = true,
    )

    private fun handleState(state: Int) {
        val nowActive = state == TelephonyManager.CALL_STATE_OFFHOOK
        if (nowActive == callActive) return

        callActive = nowActive
        callStartedAtMs = if (nowActive) System.currentTimeMillis() else 0L
        onCallStateChanged?.invoke(nowActive)
    }
}
