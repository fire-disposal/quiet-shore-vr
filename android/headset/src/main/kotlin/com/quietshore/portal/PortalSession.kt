package com.quietshore.portal

import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.LaunchState
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * The one record of what the next page launch uses.
 *
 * The page is rebuilt from scratch on every launch (a fresh URL key forces a
 * new document), so anything the operator picked at runtime only survives if it
 * is captured here. There is deliberately **one** mutable copy of the scene —
 * [sceneState] — and callers may only change it through [chooseScene]; nobody
 * hands `enter` a scene of their own, because that was how three different
 * snapshots took turns overwriting each other.
 */
internal object PortalSession {

    /** Single owner of the scene choice; also carries its revision counter. */
    private val sceneState = LaunchState()

    @Volatile
    private var options: LaunchOptions = LaunchOptions()

    /** Scene the next launch boots with. Always a valid id. */
    val scene: String get() = sceneState.scene

    /** Revision of the current choice; bumps only on an accepted change. */
    val revision: Long get() = sceneState.revision

    /**
     * Applies the operator's pick.
     *
     * @return true when the call changed the choice, so the caller persists to
     * disk exactly once and can log a single line per real decision.
     */
    fun chooseScene(id: String, knownIds: Set<String>): Boolean = synchronized(this) {
        if (!sceneState.choose(id, knownIds)) {
            return false
        }
        options = options.copy(scene = sceneState.scene)
        true
    }

    /**
     * Replaces the launch inputs. The scene inside [next] is routed through the
     * same single owner, so a caller cannot install a second copy of it.
     */
    fun set(next: LaunchOptions, knownIds: Set<String>) = synchronized(this) {
        options = next
        sceneState.choose(next.scene, knownIds)
    }

    fun snapshot(): LaunchOptions = synchronized(this) { options.copy(scene = sceneState.scene) }

    fun toJson(): JSONObject = synchronized(this) {
        val current = options
        JSONObject().apply {
            // The scene is read from the owner, never from a caller's copy.
            put("scene", sceneState.scene)
            put("skipCalibration", current.skipCalibration)
            put("showHud", current.showHud)
            // Sanitize here too: the page must never receive an unusable eye
            // height from a stale prefs file or a launch intent built elsewhere.
            val eyeHeight = current.eyeHeight
                .takeIf {
                    it.isFinite() &&
                        it >= HeadsetSettings.EYE_HEIGHT_MIN &&
                        it <= HeadsetSettings.EYE_HEIGHT_MAX
                }
                ?: ControlProtocol.EYE_HEIGHT_DEFAULT
            // Two decimals keep the JSON readable (1.35, not 1.350000023841858).
            put("eyeHeight", (eyeHeight * 100f).roundToInt() / 100.0)
            put("revision", sceneState.revision)
        }
    }
}
