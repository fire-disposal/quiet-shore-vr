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
            PortalActions.ACTION_ENTER -> PortalActions.enter(
                context,
                LaunchOptions(
                    scene = intent.getStringExtra(PortalActions.EXTRA_SCENE),
                    skipCalibration = intent.getBooleanExtra(
                        PortalActions.EXTRA_SKIP_CALIBRATION,
                        false
                    ),
                    quality = intent.getStringExtra(PortalActions.EXTRA_QUALITY),
                    eyeHeight = HeadsetSettings.read(context).eyeHeight
                )
            )

            PortalActions.ACTION_ALLAPPS -> PortalActions.allApps(context)
            PortalActions.ACTION_HOME -> PortalActions.home(context)
        }
    }
}
