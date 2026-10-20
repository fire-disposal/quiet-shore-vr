package com.quietshore.portal

import com.quietshore.control.protocol.ControlProtocol
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * One-shot launch intent handed from the console/notification to the loopback
 * server. The Web page receives it as an injected bootstrap object, not as
 * business parameters in the URL.
 */
internal object PortalSession {
    @Volatile
    private var options: LaunchOptions = LaunchOptions()

    @Volatile
    var revision: Long = 0
        private set

    fun set(next: LaunchOptions) {
        options = next
        revision += 1
    }

    fun snapshot(): LaunchOptions = options

    fun toJson(): JSONObject = JSONObject().apply {
        val current = options
        if (current.scene.isNullOrEmpty()) put("scene", JSONObject.NULL) else put("scene", current.scene)
        put("skipCalibration", current.skipCalibration)
        if (current.quality.isNullOrEmpty()) put("quality", JSONObject.NULL) else put("quality", current.quality)
        put("showHud", current.showHud)
        // Sanitize here too: the page must never receive an unusable eye height
        // from a stale prefs file or a launch intent built elsewhere.
        val eyeHeight = current.eyeHeight
            .takeIf {
                it.isFinite() &&
                    it >= ControlProtocol.EYE_HEIGHT_MIN &&
                    it <= ControlProtocol.EYE_HEIGHT_MAX
            }
            ?: ControlProtocol.EYE_HEIGHT_DEFAULT
        // Two decimals keep the JSON readable (1.35, not 1.350000023841858).
        put("eyeHeight", (eyeHeight * 100f).roundToInt() / 100.0)
        put("revision", revision)
    }
}
