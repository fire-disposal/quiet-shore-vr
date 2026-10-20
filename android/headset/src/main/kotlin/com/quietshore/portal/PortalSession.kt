package com.quietshore.portal

import org.json.JSONObject

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
        put("revision", revision)
    }
}
