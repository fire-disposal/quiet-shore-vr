package com.quietshore.portal;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

/**
 * 壳的全部动作：起服务、进入训练、全部应用、返回桌面。
 *
 * 所有跳转都是显式 Intent，不声明/不劫持任何默认浏览器或 HOME，
 * 卸载本应用后系统行为与安装前完全一致。
 */
final class PortalActions {
    /** 本地静态服务入口；loopback origin 是 secure context，WebXR 不依赖 HTTPS。 */
    static final String URL = "http://127.0.0.1:8130/";

    static final String ACTION_ENTER = "com.quietshore.portal.ENTER";
    static final String ACTION_ALLAPPS = "com.quietshore.portal.ALLAPPS";
    static final String ACTION_HOME = "com.quietshore.portal.HOME";

    /** Launch parameters accepted by the activity, receiver and deep link. */
    static final String EXTRA_SCENE = "scene";
    static final String EXTRA_MINIMAL = "minimal";
    static final String EXTRA_SKIP_CALIBRATION = "skipCalibration";
    static final String EXTRA_QUALITY = "quality";

    /** 唯一已验证的 WebXR 入口：预装 Firefox Reality 10（Gecko 78）。 */
    static final String FIREFOX_PACKAGE = "org.mozilla.vrbrowser";
    static final String FIREFOX_ACTIVITY = "org.mozilla.vrbrowser.VRBrowserActivity";

    /** 厂商“全部应用”页；不替换，只打开。 */
    static final String ALL_APPS_PACKAGE = "com.pvr.home";
    static final String ALL_APPS_ACTIVITY = "com.pvr.home.AllAppActivity";

    /**
     * 拉起浏览器前留出的前台化窗口。Firefox Reality 冷启动时会把刚收到的
     * ACTION_VIEW 丢掉，先让本应用退出前台再投递能稳定落到 8130 页面。
     */
    private static final long LAUNCH_DELAY_MS = 350;

    private PortalActions() {
    }

    /** 幂等：服务已在跑时系统只会再走一次 onStartCommand。 */
    static void startServer(Context context) {
        Intent service = new Intent(context, PortalService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(service);
        } else {
            context.startService(service);
        }
    }

    /** 进入训练：确保服务在跑，然后用显式 Intent 拉起 Firefox Reality。 */
    static void enter(Context context) {
        enter(context, null, true, false, null);
    }

    /**
     * Parameterized entry. `scene` selects the initial scene, `minimal` hides
     * the web picker/extra controls, `skipCalibration` maps to `nocal=1`, and
     * `quality` is `low`/`high`. Null/empty values are omitted.
     */
    static void enter(
            Context context,
            String scene,
            boolean minimal,
            boolean skipCalibration,
            String quality) {
        startServer(context);
        final Context app = applicationContext(context);
        final String url = buildUrl(scene, minimal, skipCalibration, quality);
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.setClassName(FIREFOX_PACKAGE, FIREFOX_ACTIVITY);
                // 复用 Firefox 的 task 但清空回退栈，冷/热启动都会重新加载 URL。
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                launch(app, intent, "未找到 Firefox Reality，可用“全部应用”手动打开");
            }
        }, LAUNCH_DELAY_MS);
    }

    static String buildUrl(String scene, boolean minimal, boolean skipCalibration, String quality) {
        Uri.Builder builder = Uri.parse(URL).buildUpon();
        if (scene != null && scene.length() > 0) {
            builder.appendQueryParameter(EXTRA_SCENE, scene);
        }
        if (minimal) {
            builder.appendQueryParameter(EXTRA_MINIMAL, "1");
        }
        if (skipCalibration) {
            builder.appendQueryParameter("nocal", "1");
        }
        if (quality != null && quality.length() > 0) {
            builder.appendQueryParameter(EXTRA_QUALITY, quality);
        }
        builder.appendQueryParameter("from", "portal");
        return builder.build().toString();
    }

    static void allApps(Context context) {
        Intent intent = new Intent();
        intent.setClassName(ALL_APPS_PACKAGE, ALL_APPS_ACTIVITY);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        launch(context, intent, "未找到系统的“全部应用”页");
    }

    static void home(Context context) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_HOME);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        launch(context, intent, "未找到可用的桌面");
    }

    /**
     * Opens the system HOME chooser. Android does not allow an ordinary app
     * to change the default home silently; the user confirms the target once.
     */
    static void chooseHome(Context context) {
        Intent settings = new Intent(Settings.ACTION_HOME_SETTINGS);
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(settings);
            return;
        } catch (RuntimeException ignored) {
            // Some vendor builds omit the Home settings screen; fall back to
            // the system selector. Neither path can change HOME silently.
        }
        Intent selector = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_HOME);
        selector.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        launch(context, selector, "未找到桌面选择器");
    }

    private static Context applicationContext(Context context) {
        Context app = context.getApplicationContext();
        return app != null ? app : context;
    }

    private static void launch(Context context, Intent intent, String failureMessage) {
        try {
            context.startActivity(intent);
        } catch (RuntimeException error) {
            // 目标不存在或被系统拒绝：只提示，不崩溃，不动系统设置。
            toast(context, failureMessage);
        }
    }

    private static void toast(Context context, final String message) {
        final Context app = applicationContext(context);
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(app, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
