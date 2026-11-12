package com.quietshore.control.ui.components

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.quietshore.control.model.ControlUiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import org.json.JSONObject

/**
 * The patient's view, mirrored for the operator (`MirrorView` in the ux tree).
 *
 * It exists so the technician can see what the patient sees. Everything about
 * it is deliberately bounded: it loads only when the operator opens it, runs at
 * pixel ratio 1 with a low-quality scene build, receives a throttled state
 * snapshot instead of a command channel, and is torn down (renderer destroyed)
 * the moment it is closed.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MirrorView(
    state: ControlUiState,
    modifier: Modifier = Modifier
) {
    val webView = remember { mutableStateOf<WebView?>(null) }
    val latest by rememberUpdatedState(state)

    // Feed the page at 5 Hz while the link is live; with no link there is
    // nothing to show, and a continuously rendering WebGL canvas is the most
    // expensive thing on this tablet.
    val live = state.phase == com.quietshore.control.ble.BlePhase.READY
    // The camera mode is local to this WebView: no link traffic, so it is
    // pushed straight to the page whenever the operator flips the top-bar tab.
    // Keyed on the WebView as well: the first composition runs this effect
    // before the factory has handed the view over, so a mode-only key left the
    // page stopped and the mirror area black.
    LaunchedEffect(state.mirrorMode, webView.value) {
        // Kotlin binds `+` tighter than the else-branch: a inline if inside a
        // concatenation dropped the closing quote on the OVERVIEW arm and the
        // whole script was a syntax error. Build the argument first.
        val mode = if (state.mirrorMode == com.quietshore.control.model.MirrorMode.OVERVIEW)
            "overview" else "patient"
        webView.value?.evaluateJavascript(
            "window.QuietShoreMirror && window.QuietShoreMirror.setMode('$mode')",
            null
        )
    }

    LaunchedEffect(live, webView.value) {
        val view = webView.value ?: return@LaunchedEffect
        view.evaluateJavascript(
            "window.QuietShoreMirror && window.QuietShoreMirror.${if (live) "start" else "stop"}()",
            null
        )
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            webView.value?.let { view ->
                val quoted = JSONObject.quote(mirrorPayload(latest))
                view.evaluateJavascript(
                    "window.QuietShoreMirror && window.QuietShoreMirror.onState($quoted)",
                    null
                )
            }
            delay(MIRROR_FEED_MS)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webView.value?.apply {
                evaluateJavascript("window.QuietShoreMirror && window.QuietShoreMirror.stop()", null)
                loadUrl("about:blank")
                destroy()
            }
            webView.value = null
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = false
                    settings.mediaPlaybackRequiresUserGesture = true
                    setBackgroundColor(0xFF0F1210.toInt())
                    loadUrl("file:///android_asset/mirror.html")
                    webView.value = this
                }
            }
        )
    }
}

private const val MIRROR_FEED_MS = 200L

/** The exact fields the mirror page reads; nothing else crosses the bridge. */
private fun mirrorPayload(state: ControlUiState): String {
    val control = state.control
    val pose = state.pose
    return JSONObject().apply {
        put("scene", control.scene)
        put("session", control.session)
        put("eyeHeight", control.eyeHeight.toDouble())
        // The applied world transform as a quaternion + translation: the mirror
        // inverts it to reproduce the patient's view, so nothing is re-derived.
        put(
            "worldQ",
            JSONObject().apply {
                put("x", control.worldQX.toDouble())
                put("y", control.worldQY.toDouble())
                put("z", control.worldQZ.toDouble())
            }
        )
        put(
            "worldT",
            JSONObject().apply {
                put("x", control.worldX.toDouble())
                put("y", control.worldY.toDouble())
                put("z", control.worldZ.toDouble())
            }
        )
        // Applied motion the page already computed; the mirror only adds it.
        put("floatMm", control.floatMm.toDouble())
        if (pose == null) {
            put("pose", JSONObject.NULL)
        } else {
            put(
                "pose",
                JSONObject().apply {
                    put("x", pose.x.toDouble())
                    put("y", pose.y.toDouble())
                    put("z", pose.z.toDouble())
                    put("yaw", pose.yaw.toDouble())
                    put("pitch", pose.pitch.toDouble())
                    put("roll", pose.roll.toDouble())
                }
            )
        }
        // Telemetry carries six floats now, so the mirror shows a tilted head.
    }.toString()
}
