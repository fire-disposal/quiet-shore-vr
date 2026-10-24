package com.quietshore.control.model

/**
 * One-shot operator message.
 *
 * Messages used to live inside [ControlUiState] as two strings. That made them
 * "state": a second identical message never re-rendered, and every clear-site
 * had to null them out by hand. An event is emitted once, shown once, and never
 * becomes part of the session's persistent snapshot.
 */
sealed interface UiEvent {
    val text: String

    /** Neutral or progress information. */
    data class Notice(override val text: String) : UiEvent

    /** Something the operator must look at. */
    data class Error(override val text: String) : UiEvent
}
