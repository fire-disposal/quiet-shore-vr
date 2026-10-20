package com.quietshore.control.web

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebViewClient
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ViewMode
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import java.util.Locale

/**
 * Owns the controller page and the JavaScript bridge.
 *
 * The page talks back through `QuietShoreBridge.send(command)` and receives
 * state through exactly five calls on `window.qsControl`. Every call is
 * deferred until the page reports that it finished loading, then replayed
 * from the last known snapshot so a reload never leaves a stale viewport.
 */
@SuppressLint("SetJavaScriptEnabled")
class ControllerWebViewHost(
    context: Context,
    private val onCommand: (String) -> Unit
) {

    var onPageReady: (() -> Unit)? = null
    var onLoadError: ((String) -> Unit)? = null

    private val assetLoader: WebViewAssetLoader = WebViewAssetLoader.Builder()
        .addPathHandler(ASSETS_PATH, WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    private var ready = false
    private var failed = false
    private var destroyed = false

    private var lastTelemetry: TelemetryPose? = null
    private var lastState: ControlState? = null
    private var lastBleState: BlePhase? = null
    private var lastAuth: Boolean? = null
    private var lastViewMode: ViewMode? = null

    val webView: WebView = WebView(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        setLayerType(View.LAYER_TYPE_HARDWARE, null)
        overScrollMode = View.OVER_SCROLL_NEVER
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        addJavascriptInterface(Bridge(), BRIDGE_NAME)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (destroyed) {
                    return
                }
                ready = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (destroyed || failed) {
                    return
                }
                ready = true
                replaySnapshot()
                onPageReady?.invoke()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (!request.isForMainFrame || destroyed) {
                    return
                }
                failed = true
                ready = false
                onLoadError?.invoke(error.description?.toString() ?: "页面加载失败")
            }
        }
    }

    init {
        webView.loadUrl(CONTROLLER_URL)
    }

    fun onTelemetry(pose: TelemetryPose) {
        lastTelemetry = pose
        evaluate(
            "window.qsControl.onTelemetry(" +
                "${number(pose.x)},${number(pose.y)},${number(pose.z)}," +
                "${number(pose.yaw)},${number(pose.pitch)})"
        )
    }

    fun onState(state: ControlState) {
        lastState = state
        evaluate(
            "window.qsControl.onState(" +
                "${string(state.scene)},${state.session},${state.calibrating},${state.audioMuted})"
        )
    }

    fun onBleState(phase: BlePhase) {
        lastBleState = phase
        val wire = phase.wire ?: return
        evaluate("window.qsControl.onBleState(${string(wire)})")
    }

    fun onAuth(ok: Boolean) {
        lastAuth = ok
        evaluate("window.qsControl.onAuth($ok)")
    }

    fun onViewMode(mode: ViewMode) {
        lastViewMode = mode
        evaluate("window.qsControl.setViewMode(${string(mode.wire)})")
    }

    fun reload() {
        if (destroyed) {
            return
        }
        failed = false
        ready = false
        webView.loadUrl(CONTROLLER_URL)
    }

    fun destroy() {
        if (destroyed) {
            return
        }
        destroyed = true
        ready = false
        webView.stopLoading()
        webView.webViewClient = WebViewClient()
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.loadUrl("about:blank")
        webView.destroy()
    }

    private fun replaySnapshot() {
        lastBleState?.let { onBleState(it) }
        lastAuth?.let { onAuth(it) }
        lastState?.let { onState(it) }
        lastTelemetry?.let { onTelemetry(it) }
        lastViewMode?.let { onViewMode(it) }
    }

    private fun evaluate(script: String) {
        if (!ready || destroyed) {
            return
        }
        webView.evaluateJavascript(script, null)
    }

    private fun number(value: Float): String =
        String.format(Locale.US, "%.3f", value.toDouble())

    private fun string(value: String): String {
        val builder = StringBuilder(value.length + 2)
        builder.append('"')
        for (character in value) {
            when (character) {
                '\\' -> builder.append("\\\\")
                '"' -> builder.append("\\\"")
                '\n' -> builder.append("\\n")
                '\r' -> builder.append("\\r")
                '\t' -> builder.append("\\t")
                else -> builder.append(character)
            }
        }
        builder.append('"')
        return builder.toString()
    }

    private inner class Bridge {
        @JavascriptInterface
        fun send(command: String) {
            onCommand(command)
        }
    }

    private companion object {
        const val CONTROLLER_URL = "https://appassets.androidplatform.net/assets/controller.html"
        const val ASSETS_PATH = "/assets/"
        const val BRIDGE_NAME = "QuietShoreBridge"
    }
}
