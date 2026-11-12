package com.quietshore.control.model

/**
 * The tablet's plan for one session, and the page's progress through it.
 *
 * An empty [ProgramState.segments] means the v1 behaviour: one open-ended
 * segment in whatever scene the operator entered. That is also what the band
 * shows, so a single-segment session does not need a synthetic plan.
 */
data class ProgramSegment(
    val scene: String,
    /** 0 = until the operator ends it. */
    val seconds: Int = 0,
    /** none | start | imagine | relax | close */
    val voice: String = "none",
    /** 1..3; 0 means the scene's own ceiling. */
    val cap: Int = 0
)

data class ProgramState(
    val segments: List<ProgramSegment> = emptyList(),
    val auto: Boolean = true
) {
    /** The plan the page would execute; empty means one implicit segment. */
    fun effective(currentScene: String, sceneCap: Int): List<ProgramSegment> =
        if (segments.isEmpty()) {
            listOf(ProgramSegment(scene = currentScene, seconds = 0, voice = "none", cap = sceneCap))
        } else {
            segments
        }
}

/** What the page reports on the JSON channel while a session runs. */
data class SegmentProgress(
    val index: Int,
    val total: Int,
    val scene: String,
    /** null when the segment is open-ended. */
    val remainingSec: Int?,
    val durationSec: Int,
    val auto: Boolean
)
