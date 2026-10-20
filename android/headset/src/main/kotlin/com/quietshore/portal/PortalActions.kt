package com.quietshore.portal

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/**
 * 壳的全部动作：起服务、进入训练、全部应用、返回桌面。
 *
 * 所有跳转都是显式 Intent，不声明/不劫持任何默认浏览器或 HOME，
 * 卸载本应用后系统行为与安装前完全一致。
 */
internal object PortalActions {
    /** 本地静态服务入口；loopback origin 是 secure context，WebXR 不依赖 HTTPS。 */
    const val URL = "http://127.0.0.1:8130/"

    const val ACTION_ENTER = "com.quietshore.portal.ENTER"
    const val ACTION_ALLAPPS = "com.quietshore.portal.ALLAPPS"
    const val ACTION_HOME = "com.quietshore.portal.HOME"

    /** Launch parameters accepted by the activity, receiver and deep link. */
    const val EXTRA_SCENE = "scene"
    const val EXTRA_MINIMAL = "minimal"
    const val EXTRA_SKIP_CALIBRATION = "skipCalibration"
    const val EXTRA_QUALITY = "quality"

    /** 唯一已验证的 WebXR 入口：预装 Firefox Reality 10（Gecko 78）。 */
    private const val FIREFOX_PACKAGE = "org.mozilla.vrbrowser"
    private const val FIREFOX_ACTIVITY = "org.mozilla.vrbrowser.VRBrowserActivity"

    /** 厂商的全部应用页；不替换，只打开。 */
    private const val ALL_APPS_PACKAGE = "com.pvr.home"
    private const val ALL_APPS_ACTIVITY = "com.pvr.home.AllAppActivity"

    /**
     * 拉起浏览器前留出的前台化窗口。Firefox Reality 冷启动时会把刚收到的
     * ACTION_VIEW 丢掉，先让本应用退出前台再投递能稳定落到 8130 页面。
     */
    private const val LAUNCH_DELAY_MS = 350L

    private const val WAIT_RETRY_MS = 80L
    private const val ENTER_COOLDOWN_MS = 3_000L

    @Volatile
    private var lastEnterAt = 0L

    /** 幂等：服务已在跑时系统只会再走一次 onStartCommand。 */
    fun startServer(context: Context) {
        context.startForegroundService(Intent(context, PortalService::class.java))
    }

    /**
     * 进入训练：确保服务在跑，然后用显式 Intent 拉起 Firefox Reality。
     * `scene` 选择初始场景，`minimal` 隐藏 Web 端选择器，`skipCalibration`
     * 映射为 `nocal=1`，`quality` 为 `low`/`high`。空值不下发。
     */
    fun enter(
        context: Context,
        scene: String? = null,
        minimal: Boolean = true,
        skipCalibration: Boolean = false,
        quality: String? = null
    ): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastEnterAt < ENTER_COOLDOWN_MS) {
            return false
        }
        lastEnterAt = now
        startServer(context)
        val app = applicationContext(context)
        val url = buildUrl(scene, minimal, skipCalibration, quality)

        // Firefox may be warm from the previous demo. Wait until the loopback
        // server actually accepts connections before handing it the URL;
        // otherwise the first navigation can fail and Firefox shows its
        // "network connection lost" dialog over the page.
        Thread({
            waitForServer(3000)
            Handler(Looper.getMainLooper()).postDelayed({
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.setClassName(FIREFOX_PACKAGE, FIREFOX_ACTIVITY)
                // 复用 Firefox 的 task 但清空回退栈，冷/热启动都会重新加载 URL。
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                launch(app, intent, "未找到 Firefox Reality，可用全部应用手动打开")
            }, LAUNCH_DELAY_MS)
        }, "quietshore-launch").start()
        return true
    }

    private fun waitForServer(timeoutMs: Int): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val socket = Socket()
            try {
                socket.connect(InetSocketAddress("127.0.0.1", PortalService.PORT), 120)
                return true
            } catch (ignored: IOException) {
                // not listening yet
            } finally {
                try {
                    socket.close()
                } catch (ignored: IOException) {
                    // already closed
                }
            }
            try {
                Thread.sleep(WAIT_RETRY_MS)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    private fun buildUrl(
        scene: String?,
        minimal: Boolean,
        skipCalibration: Boolean,
        quality: String?
    ): String {
        val builder = Uri.parse(URL).buildUpon()
        if (!scene.isNullOrEmpty()) {
            builder.appendQueryParameter(EXTRA_SCENE, scene)
        }
        if (minimal) {
            builder.appendQueryParameter(EXTRA_MINIMAL, "1")
        }
        if (skipCalibration) {
            builder.appendQueryParameter("nocal", "1")
        }
        if (!quality.isNullOrEmpty()) {
            builder.appendQueryParameter(EXTRA_QUALITY, quality)
        }
        builder.appendQueryParameter("from", "portal")
        // Firefox Reality can reuse the previous document for an identical URL,
        // even with no-store. A fresh key forces a new navigation and lets the
        // loopback server serve the current APK asset.
        builder.appendQueryParameter("t", System.currentTimeMillis().toString())
        return builder.build().toString()
    }

    fun allApps(context: Context) {
        val intent = Intent().apply {
            setClassName(ALL_APPS_PACKAGE, ALL_APPS_ACTIVITY)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(context, intent, "未找到系统全部应用页")
    }

    fun home(context: Context) {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(context, intent, "未找到可用的桌面")
    }

    /**
     * Opens the system HOME chooser. Android does not allow an ordinary app
     * to change the default home silently; the user confirms the target once.
     */
    fun chooseHome(context: Context) {
        val settings = Intent(Settings.ACTION_HOME_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(settings)
            return
        } catch (ignored: RuntimeException) {
            // Some vendor builds omit the Home settings screen; fall back to
            // the system selector. Neither path can change HOME silently.
        }
        val selector = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_HOME).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(context, selector, "未找到桌面选择器")
    }

    private fun applicationContext(context: Context): Context = context.applicationContext ?: context

    private fun launch(context: Context, intent: Intent, failureMessage: String) {
        try {
            context.startActivity(intent)
        } catch (ignored: RuntimeException) {
            // 目标不存在或被系统拒绝：只提示，不崩溃，不动系统设置。
            toast(context, failureMessage)
        }
    }

    private fun toast(context: Context, message: String) {
        val app = applicationContext(context)
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(app, message, Toast.LENGTH_SHORT).show()
        }
    }
}

/**
 * Bluetooth state shared by the service (writer) and the entry activity
 * (reader). The service also broadcasts [ACTION_STATUS] after every change so
 * a visible activity can refresh without polling.
 */
internal object PortalStatus {
    const val ACTION_STATUS = "com.quietshore.portal.STATUS"

    @Volatile
    private var bluetoothState: String = "starting"

    @Volatile
    private var controlActive: Boolean = false

    fun update(state: String, control: Boolean) {
        bluetoothState = state
        controlActive = control
    }

    fun isControlActive(): Boolean = controlActive

    /** One-line state for any UI surface that shows peripheral status. */
    fun description(): String {
        val state = bluetoothState
        return when {
            state == "advertising" && controlActive -> "平板控制中，患者无需操作"
            state == "advertising" -> "等待平板连接"
            state == "bluetooth-off" -> "蓝牙未开启"
            state == "starting" -> "蓝牙正在启动"
            state == "stopped" || state == "unavailable" -> "服务未运行"
            else -> "蓝牙不可用"
        }
    }
}

