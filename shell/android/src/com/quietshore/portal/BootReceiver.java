package com.quietshore.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 重启/更新后恢复本地服务与常驻通知。
 *
 * 刻意不自动拉起 Firefox Reality：启动后前台保持厂商 HOME，
 * 用户从下拉通知栏或快捷磁贴自行进入训练。
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            PortalActions.startServer(context);
        }
    }
}
