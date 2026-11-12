package com.quietshore.portal

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager

/**
 * One synthetic tap at the middle of the display, for the entry gesture.
 *
 * WebXR will not open an immersive session without a trusted press inside the
 * browser's own window, and a supine patient on their first session often
 * cannot find that press: the window sits wherever the head happened to face
 * at launch, and the tablet can only say "waiting". This service is the one
 * mechanism an unrooted app has for turning "waiting" into "pressed" without
 * asking the patient to aim at anything.
 *
 * Nothing depends on it: the page accepts a real press exactly as before, and
 * the shell keeps relaunching when no tap is available ([EntryRetry]). The
 * gesture is injected at the *display* level, so it lands on whatever is on
 * top — Firefox Reality's window — as a real touch, which is what the WebXR
 * user-activation gate checks.
 */
class TapService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "tap service connected")
    }

    override fun onDestroy() {
        if (instance === this) {
            instance = null
        }
        super.onDestroy()
    }

    /**
     * The only thing this service reads: which package owns the window that just
     * came up. A tap is never sent unless the browser is in front, so a stray
     * tap cannot land on the console.
     */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            lastPackage = event.packageName?.toString()
        }
    }

    override fun onInterrupt() = Unit

    companion object {
        private const val TAG = "QuietShoreTap"

        /** The only browser that can host the session on this device. */
        private const val BROWSER_PACKAGE = "org.mozilla.vrbrowser"

        @Volatile
        private var instance: TapService? = null

        /** Package of the last window that came to the front. */
        @Volatile
        private var lastPackage: String? = null

        /**
         * Whether the operator enabled this service (Settings → 无障碍, or the
         * one-time `enabled_accessibility_services` write). Read from the
         * settings table because the service object only exists once enabled.
         */
        fun isEnabled(context: Context): Boolean {
            if (instance != null) {
                return true
            }
            val expected = "${context.packageName}/${TapService::class.java.name}"
            val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
                ?: return false
            @Suppress("DEPRECATION")
            val enabled = manager.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfoFeedbackAll
            )
            if (enabled.any { it.resolveInfo.serviceInfo.name == TapService::class.java.name }) {
                return true
            }
            return try {
                Settings.Secure.getInt(context.contentResolver, "accessibility_enabled") == 1 &&
                    (Settings.Secure.getString(
                        context.contentResolver,
                        "enabled_accessibility_services"
                    ) ?: "").split(':').any { it.equals(expected, ignoreCase = true) }
            } catch (error: RuntimeException) {
                false
            }
        }

        /**
         * Tap the middle of the display once.
         *
         * @return false when the service is not running (nothing is injected).
         */
        fun tapCenter(): Boolean {
            val service = instance ?: return false
            if (lastPackage != BROWSER_PACKAGE) {
                Log.i(TAG, "tap skipped: front window is $lastPackage")
                return false
            }
            val metrics = service.resources.displayMetrics
            val x = metrics.widthPixels / 2f
            val y = metrics.heightPixels * 0.55f
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0L, 90L)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            val accepted = service.dispatchGesture(gesture, null, null)
            Log.i(TAG, "tap (${x.toInt()}, ${y.toInt()}) accepted=$accepted")
            return accepted
        }

        /**
         * Feedback types the manager expects; kept here so `isEnabled` does not
         * depend on a framework constant name.
         */
        private const val AccessibilityServiceInfoFeedbackAll = 0x10F
    }
}
