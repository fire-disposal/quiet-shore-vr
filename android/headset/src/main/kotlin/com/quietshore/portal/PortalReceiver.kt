package com.quietshore.portal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 通知按钮的落点。仅由本应用的 PendingIntent 触发，未导出。
 */
class PortalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        when (action) {
            PortalActions.ACTION_ENTER -> {
                // Only the calibration flag is a per-launch intent; the scene
                // comes from the session record, never from this receiver.
                PortalActions.enter(
                    context,
                    skipCalibrationOverride = if (intent.hasExtra(PortalActions.EXTRA_SKIP_CALIBRATION)) {
                        intent.getBooleanExtra(PortalActions.EXTRA_SKIP_CALIBRATION, false)
                    } else {
                        null
                    }
                )
            }

            PortalActions.ACTION_ALLAPPS -> PortalActions.allApps(context)
        }
    }
}
