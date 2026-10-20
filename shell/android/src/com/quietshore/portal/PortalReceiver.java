package com.quietshore.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 通知按钮的落点。仅由本应用的 PendingIntent 触发，未导出。
 */
public class PortalReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (PortalActions.ACTION_ENTER.equals(action)) {
            PortalActions.enter(context);
        } else if (PortalActions.ACTION_ALLAPPS.equals(action)) {
            PortalActions.allApps(context);
        } else if (PortalActions.ACTION_HOME.equals(action)) {
            PortalActions.home(context);
        }
    }
}
