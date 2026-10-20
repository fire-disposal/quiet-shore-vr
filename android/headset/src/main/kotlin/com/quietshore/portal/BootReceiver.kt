package com.quietshore.portal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 重启/更新后恢复本地服务与常驻通知。
 *
 * 刻意不自动拉起 Firefox Reality：启动后前台保持厂商 HOME，
 * 用户从下拉通知栏或快捷磁贴自行进入训练。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED ->
                PortalActions.startServer(context)
        }
    }
}
