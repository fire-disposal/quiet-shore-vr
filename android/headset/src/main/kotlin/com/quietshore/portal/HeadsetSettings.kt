package com.quietshore.portal

import android.content.Context
import com.quietshore.control.protocol.ControlProtocol

/**
 * Persistent launch preferences owned by the headset console. These are
 * translated once into [LaunchOptions]; the Web page stays unaware of
 * SharedPreferences and the Android UI.
 */
internal data class HeadsetSettings(
    val sceneId: String = ControlProtocol.DEFAULT_SCENE,
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
        /** Comfort eye height default, shared with the wire contract. */
        const val DEFAULT_EYE_HEIGHT: Float = ControlProtocol.EYE_HEIGHT_DEFAULT

        private const val PREFS = "quietshore.portal"
        private const val KEY_SCENE = "settings.scene"
        private const val KEY_SKIP = "settings.skipCalibration"
        private const val KEY_HUD = "settings.showHud"
        // v2 resets the old 1.60/1.42 leftovers so the new 1.70 default wins
        // once; the next operator change is persisted under this key.
        private const val KEY_EYE_HEIGHT = "settings.eyeHeight.v2"

        /** Comfort range for the standing eye height, metres. */
        const val EYE_HEIGHT_MIN = 1.2f
        const val EYE_HEIGHT_MAX = 1.9f

        /** True when [meters] is a usable eye height; the page only ever sees these. */
        fun isValidEyeHeight(meters: Float): Boolean =
            meters.isFinite() &&
                meters >= EYE_HEIGHT_MIN &&
                meters <= EYE_HEIGHT_MAX

        fun read(context: Context): HeadsetSettings {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val eyeHeight = prefs.getFloat(KEY_EYE_HEIGHT, DEFAULT_EYE_HEIGHT)
                .takeIf { isValidEyeHeight(it) } ?: DEFAULT_EYE_HEIGHT
            // The catalogue, not the built-in table, decides what is a scene.
            val scene = prefs.getString(KEY_SCENE, null)
                ?.takeIf { it in PageCatalog.idSet(context) }
                ?: ControlProtocol.DEFAULT_SCENE
            return HeadsetSettings(
                sceneId = scene,
                skipCalibration = prefs.getBoolean(KEY_SKIP, false),
                showHud = prefs.getBoolean(KEY_HUD, false),
                eyeHeight = eyeHeight
            )
        }

        /**
         * Console toggles. Deliberately does **not** write the scene key: the
         * tablet owns the scene, and a console screen that saved its load-time
         * snapshot here used to put the old scene back.
         */
        fun saveConsolePrefs(context: Context, settings: HeadsetSettings) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_SKIP, settings.skipCalibration)
                .putBoolean(KEY_HUD, settings.showHud)
                .putFloat(
                    KEY_EYE_HEIGHT,
                    settings.eyeHeight.takeIf { isValidEyeHeight(it) } ?: DEFAULT_EYE_HEIGHT
                )
                .apply()
        }

        /**
         * The operator's scene pick. Only the scene-command path writes this
         * key; unknown ids are refused rather than stored.
         */
        fun saveScene(context: Context, sceneId: String) {
            val valid = sceneId.takeIf { it in PageCatalog.idSet(context) } ?: return
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SCENE, valid)
                .apply()
        }
    }
}
