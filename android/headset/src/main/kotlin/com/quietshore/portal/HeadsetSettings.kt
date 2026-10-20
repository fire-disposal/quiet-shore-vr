package com.quietshore.portal

import android.content.Context

/**
 * Persistent launch preferences owned by the headset console. These are
 * translated once into [LaunchOptions]; the Web page stays unaware of
 * SharedPreferences and the Android UI.
 */
internal data class HeadsetSettings(
    val sceneId: String = DEFAULT_SCENE,
    val skipCalibration: Boolean = false,
    val showHud: Boolean = false
) {
    fun toLaunchOptions(): LaunchOptions = LaunchOptions(
        scene = sceneId,
        skipCalibration = skipCalibration,
        showHud = showHud
    )

    companion object {
        const val DEFAULT_SCENE = "landscape"
        private const val PREFS = "quietshore.portal"
        private const val KEY_SCENE = "settings.scene"
        private const val KEY_SKIP = "settings.skipCalibration"
        private const val KEY_HUD = "settings.showHud"

        val SCENE_IDS = listOf("landscape", "ward", "bathroom", "lab")

        fun read(context: Context): HeadsetSettings {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val scene = prefs.getString(KEY_SCENE, DEFAULT_SCENE)
                ?.takeIf { it in SCENE_IDS } ?: DEFAULT_SCENE
            return HeadsetSettings(
                sceneId = scene,
                skipCalibration = prefs.getBoolean(KEY_SKIP, false),
                showHud = prefs.getBoolean(KEY_HUD, false)
            )
        }

        fun save(context: Context, settings: HeadsetSettings) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SCENE, settings.sceneId)
                .putBoolean(KEY_SKIP, settings.skipCalibration)
                .putBoolean(KEY_HUD, settings.showHud)
                .apply()
        }
    }
}
