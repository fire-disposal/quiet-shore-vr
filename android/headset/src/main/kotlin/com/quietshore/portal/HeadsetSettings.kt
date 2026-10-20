package com.quietshore.portal

import android.content.Context
import com.quietshore.control.protocol.ControlProtocol

/**
 * Persistent launch preferences owned by the headset console. These are
 * translated once into [LaunchOptions]; the Web page stays unaware of
 * SharedPreferences and the Android UI.
 */
internal data class HeadsetSettings(
    val sceneId: String = DEFAULT_SCENE,
    val skipCalibration: Boolean = false,
    val showHud: Boolean = false,
    val eyeHeight: Float = DEFAULT_EYE_HEIGHT
) {
    fun toLaunchOptions(): LaunchOptions = LaunchOptions(
        scene = sceneId,
        skipCalibration = skipCalibration,
        showHud = showHud,
        eyeHeight = eyeHeight
    )

    companion object {
        const val DEFAULT_SCENE = "landscape"

        /** Comfort eye height default, shared with the wire contract. */
        const val DEFAULT_EYE_HEIGHT: Float = ControlProtocol.EYE_HEIGHT_DEFAULT

        private const val PREFS = "quietshore.portal"
        private const val KEY_SCENE = "settings.scene"
        private const val KEY_SKIP = "settings.skipCalibration"
        private const val KEY_HUD = "settings.showHud"
        // v2 resets the old 1.60/1.42 leftovers so the new 1.70 default wins
        // once; the next operator change is persisted under this key.
        private const val KEY_EYE_HEIGHT = "settings.eyeHeight.v2"

        val SCENE_IDS = listOf("landscape", "ward", "bathroom", "lab")

        /** True when [meters] is a usable eye height; the page only ever sees these. */
        fun isValidEyeHeight(meters: Float): Boolean =
            meters.isFinite() &&
                meters >= ControlProtocol.EYE_HEIGHT_MIN &&
                meters <= ControlProtocol.EYE_HEIGHT_MAX

        fun read(context: Context): HeadsetSettings {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val scene = prefs.getString(KEY_SCENE, DEFAULT_SCENE)
                ?.takeIf { it in SCENE_IDS } ?: DEFAULT_SCENE
            val eyeHeight = prefs.getFloat(KEY_EYE_HEIGHT, DEFAULT_EYE_HEIGHT)
                .takeIf { isValidEyeHeight(it) } ?: DEFAULT_EYE_HEIGHT
            return HeadsetSettings(
                sceneId = scene,
                skipCalibration = prefs.getBoolean(KEY_SKIP, false),
                showHud = prefs.getBoolean(KEY_HUD, false),
                eyeHeight = eyeHeight
            )
        }

        fun save(context: Context, settings: HeadsetSettings) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SCENE, settings.sceneId)
                .putBoolean(KEY_SKIP, settings.skipCalibration)
                .putBoolean(KEY_HUD, settings.showHud)
                .putFloat(
                    KEY_EYE_HEIGHT,
                    settings.eyeHeight.takeIf { isValidEyeHeight(it) } ?: DEFAULT_EYE_HEIGHT
                )
                .apply()
        }
    }
}
