package com.quietshore.control.protocol

/**
 * The scene the next page launch must use — one value, one writer.
 *
 * The scene used to live in five places at once (the page's runtime scene, the
 * launch session, SharedPreferences, the tablet's mirror and the tablet's
 * pending pick) with three writers, two of which saved whole snapshots and
 * therefore put an older value back. That is why "pick a scene, press start"
 * kept landing on the previous scene: nothing owned the value, so the last
 * writer won.
 *
 * This class is the single mutable copy. It validates the id against the wire
 * table, reports whether a call changed anything (so persistence is a reaction,
 * not a second decision), and bumps [revision] so a reader can tell one
 * accepted decision from the next.
 */
class LaunchState(
    scene: String = ControlProtocol.DEFAULT_SCENE,
    /** Live catalogue ids; the built-in table is the pre-catalogue fallback. */
    private val knownScenes: Set<String> = ControlProtocol.SCENE_IDS.toSet()
) {

    /** Current choice; always one of [knownScenes]. */
    var scene: String = known(scene, knownScenes) ?: ControlProtocol.DEFAULT_SCENE
        private set

    /** Increases with every accepted change; equal revisions mean equal state. */
    var revision: Long = 0
        private set

    /**
     * Applies the operator's pick.
     *
     * @return true only when [id] is a known scene *and* differs from the
     * current one, so callers can skip a redundant disk write.
     */
    fun choose(id: String, knownIds: Set<String> = knownScenes): Boolean {
        val next = known(id, knownIds) ?: return false
        if (next == scene) {
            return false
        }
        scene = next
        revision += 1
        return true
    }

    companion object {
        /** Known scene id, or null. The only place the scene table is consulted. */
        fun known(
            id: String?,
            knownIds: Set<String> = ControlProtocol.SCENE_IDS.toSet()
        ): String? = id?.trim()?.takeIf { it in knownIds }
    }
}
