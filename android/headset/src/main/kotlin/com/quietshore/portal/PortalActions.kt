package com.quietshore.portal

import android.content.Context
import android.content.pm.PackageManager
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/** Immutable launch inputs; keeps Activity/Receiver from passing positional flags. */
internal data class LaunchOptions(
    val scene: String? = null,
    val skipCalibration: Boolean = false,
    val quality: String? = null,
    val showHud: Boolean = false,
    /** Comfort eye height in meters (1.2–1.9); the page applies it, never the headset. */
    val eyeHeight: Float = HeadsetSettings.DEFAULT_EYE_HEIGHT
)

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
    const val ACTION_SUS = "com.quietshore.portal.SUS"
    const val EXTRA_SUS_DELTA = "susDelta"
    const val EXTRA_SUS_ANSWER = "susAnswer"

    /** Launch parameters accepted by the activity, receiver and deep link. */
    const val EXTRA_SCENE = "scene"
    const val EXTRA_SKIP_CALIBRATION = "skipCalibration"
    const val EXTRA_QUALITY = "quality"
    const val EXTRA_PAGE = "page"

    /** 唯一已验证的 WebXR 入口：预装 Firefox Reality 10（Gecko 78）。 */
    private const val FIREFOX_PACKAGE = "org.mozilla.vrbrowser"
    private const val FIREFOX_ACTIVITY = "org.mozilla.vrbrowser.VRBrowserActivity"

    /** 厂商的全部应用页；不替换，只打开。 */
    private const val ALL_APPS_PACKAGE = "com.pvr.home"
    private const val ALL_APPS_ACTIVITY = "com.pvr.home.AllAppActivity"

    /** 现场保留的旧训练系统；不卸载、不替换。 */
    private const val LEGACY_PACKAGE = "vr.xinjing.com.vrmc"
    private const val LEGACY_ACTIVITY = "vr.xinjing.com.vrmc.ui.SplashActivity"

    /** 厂商默认桌面/启动器。 */
    private const val SYSTEM_LAUNCHER_PACKAGE = "com.pvr.launcher"
    private const val SYSTEM_LAUNCHER_ACTIVITY = "com.pvr.launcher.MainActivity"

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
     * `scene` 选择初始场景，`skipCalibration`
     * 映射为 `nocal=1`，`quality` 为 `low`/`high`。空值不下发。
     */
    /** True only when the one WebXR-capable browser on this device exists. */
    fun isFirefoxAvailable(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(FIREFOX_PACKAGE, 0)
        true
    } catch (ignored: PackageManager.NameNotFoundException) {
        false
    }

    fun enter(context: Context, options: LaunchOptions = LaunchOptions()): Boolean {
        val app = applicationContext(context)
        if (!isFirefoxAvailable(app)) {
            toast(app, "未检测到 Firefox Reality，训练无法工作")
            return false
        }
        val now = System.currentTimeMillis()
        if (now - lastEnterAt < ENTER_COOLDOWN_MS) {
            return false
        }
        lastEnterAt = now
        PortalSession.set(options)
        startServer(context)
        val url = buildUrl(options)

        // Firefox may be warm from the previous demo. Wait until the loopback
        // server actually accepts connections before handing it the URL;
        // otherwise the first navigation can fail and Firefox shows its
        // "network connection lost" dialog over the page.
        Thread({
            waitForServer(3000)
            Handler(Looper.getMainLooper()).postDelayed({
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.setClassName(FIREFOX_PACKAGE, FIREFOX_ACTIVITY)
                // Do not CLEAR_TASK: Firefox Reality crashes in
                // TelemetryWrapper when its activity is recreated while a
                // telemetry session is already active. NEW_TASK + a fresh URL
                // key reuses the warm task and navigates it.
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                launch(app, intent, "未找到 Firefox Reality，训练无法工作")
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

    private fun buildUrl(options: LaunchOptions): String {
        // Business configuration travels through PortalSession and is injected
        // by PortalService. The URL only carries a cache-busting key.
        val builder = Uri.parse(URL).buildUpon()
        builder.appendQueryParameter("t", System.currentTimeMillis().toString())
        return builder.build().toString()
    }

    /** Name of the retained legacy system, or null when it is absent. */
    fun legacySystemLabel(context: Context): String? = try {
        val app = applicationContext(context)
        val info = app.packageManager.getApplicationInfo(LEGACY_PACKAGE, 0)
        app.packageManager.getApplicationLabel(info).toString()
    } catch (ignored: RuntimeException) {
        null
    }

    fun openLegacySystem(context: Context) {
        val app = applicationContext(context)
        val intent = Intent().apply {
            setClassName(LEGACY_PACKAGE, LEGACY_ACTIVITY)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(app, intent, "未找到原训练系统")
    }

    fun openDefaultDesktop(context: Context) {
        val app = applicationContext(context)
        val intent = Intent().apply {
            setClassName(SYSTEM_LAUNCHER_PACKAGE, SYSTEM_LAUNCHER_ACTIVITY)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(app, intent, "未找到默认桌面")
    }

    fun openSus(context: Context) {
        showPortalPage(context, "sus")
    }

    fun closeSus(context: Context) {
        showPortalPage(context, "settings")
    }

    fun susPage(context: Context, delta: Int) {
        val app = applicationContext(context)
        try {
            app.sendBroadcast(
                Intent(ACTION_SUS).setPackage(app.packageName).putExtra(EXTRA_SUS_DELTA, delta)
            )
        } catch (ignored: RuntimeException) {
            // No visible console; the next open will start at the first question.
        }
    }

    /**
     * Operator answers the current SUS item. Uses an explicit activity intent
     * instead of the SUS broadcast so it also works while the console is
     * paused behind Firefox.
     */
    fun susAnswer(context: Context, value: Int) {
        if (value !in 1..5) {
            return
        }
        val intent = Intent(context, PortalActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            putExtra(EXTRA_PAGE, "sus")
            putExtra(EXTRA_SUS_ANSWER, value)
        }
        launch(applicationContext(context), intent, "无法打开 SUS 页面")
    }

    private fun showPortalPage(context: Context, page: String) {
        val intent = Intent(context, PortalActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_PAGE, page)
        }
        launch(applicationContext(context), intent, "无法打开头显页面")
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

    /** 系统设置首页；不修改任何设置，只打开入口。 */
    fun systemSettings(context: Context) {
        val intent = Intent(Settings.ACTION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        launch(applicationContext(context), intent, "未找到系统设置")
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

    @Volatile
    private var controllerMac: String? = null

    fun update(state: String, control: Boolean, mac: String? = null) {
        bluetoothState = state
        controlActive = control
        controllerMac = mac
    }

    fun isControlActive(): Boolean = controlActive

    /** BLE address of the controlling pad; null while nobody owns the console. */
    fun controllerAddress(): String? = controllerMac

}

