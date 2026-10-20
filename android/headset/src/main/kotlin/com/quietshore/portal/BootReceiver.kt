package com.quietshore.portal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * 重启/更新后恢复本地服务与常驻通知，并按现场授权自动打开头显控制台。
 *
 * 不替换、不卸载、也不修改默认 HOME：厂商系统与其他应用仍保留，
 * 只是开机后把静岸控制台拉到前台。若厂商限制后台启动 Activity，
 * 常驻通知/快捷磁贴仍是兜底入口。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                PortalActions.startServer(context)
                val pending = goAsync()
                // Give the vendor HOME/boot services a moment to settle, then
                // take the foreground. goAsync keeps the process alive.
                Handler(Looper.getMainLooper()).postDelayed({
                    try {
                        val launch = Intent(context, PortalActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        }
                        context.startActivity(launch)
                    } catch (error: RuntimeException) {
                        Log.w("QuietShoreBoot", "auto-open blocked: ${error.message}")
                    } finally {
                        pending.finish()
                    }
                }, AUTO_OPEN_DELAY_MS)
            }
        }
    }

    private companion object {
        const val AUTO_OPEN_DELAY_MS = 1_500L
    }
}
