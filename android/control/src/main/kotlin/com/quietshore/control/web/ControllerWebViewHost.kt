package com.quietshore.control.web

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebViewClient
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ViewMode
import com.quietshore.control.protocol.ControlState
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.recording.ControllerRecorder
import com.quietshore.control.recording.RecordingEvent
import com.quietshore.control.recording.ViewportRecorder
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
    private val onCommand: (String) -> Unit,
    private val onFullscreen: (() -> Unit)? = null,
    private val onRecordingEvent: (RecordingEvent) -> Unit = {}
) : ControllerRecorder {

    var onPageReady: (() -> Unit)? = null
    var onPageLoading: (() -> Unit)? = null
    var onLoadError: ((String) -> Unit)? = null

    private val recorder = ViewportRecorder(context, onRecordingEvent)

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
        if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        addJavascriptInterface(Bridge(), BRIDGE_NAME)
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, "controller console: ${message.message()} @${message.lineNumber()}")
                return true
            }
        }
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
                onPageLoading?.invoke()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (destroyed || failed) {
                    return
                }
                ready = true
                view?.evaluateJavascript(HEALTH_SCRIPT) { result ->
                    if (destroyed) {
                        return@evaluateJavascript
                    }
                    if (result != "\"ok\"") {
                        failed = true
                        ready = false
                        onLoadError?.invoke("三维视图不可用：$result")
                    } else {
                        replaySnapshot()
                        onPageReady?.invoke()
                    }
                }
            }

            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?
            ): Boolean {
                if (!destroyed) {
                    failed = true
                    ready = false
                    if (recorder.cancel()) {
                        onRecordingEvent(RecordingEvent.Failed("三维视图进程已退出，录像未保存"))
                    }
                    onLoadError?.invoke("三维视图进程已退出")
                }
                return true
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

    private val pageUrl = "$CONTROLLER_URL?v=${System.currentTimeMillis()}"

    init {
        webView.loadUrl(pageUrl)
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
                "${string(state.scene)},${state.session},${state.calibrating}," +
                "${state.audioMuted},${number(state.eyeHeight)},${state.sitUpActive}," +
                "${number(state.worldYaw)},${number(state.worldPitch)}," +
                "${number(state.worldRoll)});" +
                "window.qsControl.onPosture(" +
                "${number(state.posturePitch)},${number(state.postureRoll)}," +
                "${number(state.postureRise)},${number(state.postureProgress)})"
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

    /** Starts the page's canvas recorder; the page runs the encoder itself. */
    override fun startRecording() {
        if (destroyed) {
            return
        }
        if (!ready) {
            onRecordingEvent(RecordingEvent.Failed("三维视图尚未加载完成"))
            return
        }
        evaluate("if (window.qsRecorder) window.qsRecorder.start();")
    }

    override fun stopRecording() {
        if (destroyed) {
            return
        }
        evaluate("if (window.qsRecorder) window.qsRecorder.stop();")
    }

    fun reload() {
        if (destroyed) {
            return
        }
        // The old page's encoder dies with the navigation; drop the partial
        // file instead of leaving a truncated clip in Movies.
        if (recorder.cancel()) {
            onRecordingEvent(RecordingEvent.Failed("三维视图已重载，录像未保存"))
        }
        failed = false
        ready = false
        webView.loadUrl(pageUrl)
    }

    fun destroy() {
        if (destroyed) {
            return
        }
        destroyed = true
        ready = false
        recorder.cancel()
        webView.stopLoading()
        webView.webViewClient = WebViewClient()
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.loadUrl("about:blank")
        webView.destroy()
        recorder.shutdown()
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

        @JavascriptInterface
        fun openFullscreen() {
            onFullscreen?.invoke()
        }

        @JavascriptInterface
        fun recordingStarted(mimeType: String) {
            recorder.begin(mimeType)
        }

        @JavascriptInterface
        fun recordingChunk(base64: String) {
            recorder.append(base64)
        }

        @JavascriptInterface
        fun recordingFinished() {
            recorder.finish()
        }

        @JavascriptInterface
        fun recordingFailed(message: String) {
            recorder.cancel()
            onRecordingEvent(RecordingEvent.Failed(message))
        }
    }

    private companion object {
        const val CONTROLLER_URL = "https://appassets.androidplatform.net/assets/controller.html"
        const val ASSETS_PATH = "/assets/"
        const val BRIDGE_NAME = "QuietShoreBridge"
        const val TAG = "QuietShoreControl"
        val HEALTH_SCRIPT = """
            (function () {
              try {
                var canvas = document.createElement('canvas');
                var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (!gl) return 'webgl-unavailable';
                if (!window.qsControl) return 'controller-missing';
                return 'ok';
              } catch (error) {
                return 'error:' + (error && error.message ? error.message : 'unknown');
              }
            })()
        """.trimIndent()
    }
}
