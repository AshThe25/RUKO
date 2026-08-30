package com.ruko.nativemodule.accessibility

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.ruko.nativemodule.payment.AccessibilityPaymentProvider

/**
 * Watches the foreground app and, when it looks like a payment screen, reads
 * the visible text so Ruko can warn before confirmation.
 *
 * Three things keep this from becoming a general screen scraper:
 *
 *  - Text is only collected while the foreground package is on
 *    [PAYMENT_PACKAGES]. Everything else returns immediately.
 *  - Nothing is stored. Text goes straight into the parser and the strings are
 *    dropped; only the parsed amount and payee survive the call.
 *  - Events are throttled, because `typeWindowContentChanged` fires constantly
 *    and traversing a node tree on every one of them would visibly heat the
 *    phone.
 *
 * Play policy note: this design is a prototype and an OEM-integration proposal.
 * See docs/android-capabilities.md §3.1.
 */
class RukoAccessibilityService : AccessibilityService() {

    private var lastTraversalAtMs = 0L
    private var lastPackage: String? = null
    private var lastNoProviderLogMs = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "connected")
    }

    override fun onDestroy() {
        instance = null
        provider?.clear()
        super.onDestroy()
    }

    override fun onInterrupt() {
        provider?.clear()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString() ?: return
        val active = provider
        if (active == null) {
            // The single most confusing failure this service has: enabled,
            // bound, receiving events, and doing nothing because JS never
            // attached a provider. Say so out loud.
            if (packageName in PAYMENT_PACKAGES && System.currentTimeMillis() - lastNoProviderLogMs > 5_000L) {
                lastNoProviderLogMs = System.currentTimeMillis()
                Log.w(TAG, "payment app '$packageName' in front but no provider attached")
            }
            return
        }

        if (packageName !in PAYMENT_PACKAGES) {
            // Left the payment app entirely: forget whatever we had.
            if (lastPackage in PAYMENT_PACKAGES) active.clear()
            lastPackage = packageName
            return
        }
        lastPackage = packageName

        val now = System.currentTimeMillis()
        if (now - lastTraversalAtMs < THROTTLE_MS) return
        lastTraversalAtMs = now

        val root = rootInActiveWindow ?: return
        val texts = mutableListOf<String>()
        try {
            collectText(root, texts, depth = 0)
        } finally {
            @Suppress("DEPRECATION")
            root.recycle()
        }

        Log.i(TAG, "read ${texts.size} nodes from $packageName")
        active.onScreenRead(texts, packageName, now)
    }

    /**
     * Depth-first text collection with hard bounds.
     *
     * A malformed or hostile view hierarchy can be enormous or cyclic; the
     * depth and count caps mean the worst case is a missed reading, not a
     * frozen accessibility thread. A missed reading is survivable — the demo
     * provider covers it.
     */
    private fun collectText(node: AccessibilityNodeInfo?, into: MutableList<String>, depth: Int) {
        if (node == null || depth > MAX_DEPTH || into.size >= MAX_NODES) return

        val text = node.text?.toString()?.trim()
        if (!text.isNullOrEmpty() && text.length <= MAX_NODE_TEXT) {
            into.add(text)
        } else {
            val description = node.contentDescription?.toString()?.trim()
            if (!description.isNullOrEmpty() && description.length <= MAX_NODE_TEXT) {
                into.add(description)
            }
        }

        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            try {
                collectText(child, into, depth + 1)
            } finally {
                @Suppress("DEPRECATION")
                child.recycle()
            }
        }
    }

    companion object {
        /**
         * Ruko is not hard-coded to one UPI app (build prompt §11), but it does
         * refuse to read screens outside a known payment surface. Widening this
         * list is a deliberate, reviewable change — not a config flag.
         */
        val PAYMENT_PACKAGES = setOf(
            "com.ruko.paydemo",
            // PayNow, the demo UPI wallet in `android/paynow`. Listed here for
            // the same reason as the others and by the same rule: it is a
            // payment surface Ruko is expected to read. It shares no code with
            // Ruko, so it is read through the accessibility tree exactly as a
            // shipping UPI app would be.
            "com.ruko.paynow",
            "com.google.android.apps.nbu.paisa.user", // Google Pay India
            "com.phonepe.app",
            "net.one97.paytm",
            "in.org.npci.upiapp", // BHIM
            "com.whatsapp", // WhatsApp Pay
        )

        @Volatile
        private var instance: RukoAccessibilityService? = null

        @Volatile
        private var provider: AccessibilityPaymentProvider? = null

        /** True only when the user has actually granted and enabled the service. */
        fun isConnected(): Boolean = instance != null

        fun attach(target: AccessibilityPaymentProvider) {
            provider = target
        }

        fun detach() {
            provider?.clear()
            provider = null
        }

        private const val TAG = "RukoA11y"
        private const val THROTTLE_MS = 400L
        private const val MAX_DEPTH = 40
        private const val MAX_NODES = 200
        private const val MAX_NODE_TEXT = 240
    }
}
