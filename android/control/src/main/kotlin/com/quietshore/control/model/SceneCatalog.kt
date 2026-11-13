package com.quietshore.control.model

import com.quietshore.control.protocol.ControlProtocol

/**
 * The scene ids the state frame can name, before the page has said anything.
 *
 * This is a *fallback*, not a catalogue: it resolves the 4-bit index of an
 * incoming state frame into a name so the console can print something. Copy,
 * taglines and the list itself belong to the page; once its `catalog` document
 * lands, this table is not read again.
 */
object SceneCatalog {
    data class Scene(
        val id: String,
        val name: String,
        val blurb: String,
        /** Built-in infrastructure; the picker leaves it out. */
        val special: Boolean = false
    )

    val ALL: List<Scene> = ControlProtocol.SCENE_IDS.mapNotNull { id ->
        val name = ControlProtocol.SCENE_LABELS[id] ?: return@mapNotNull null
        Scene(
            id = id,
            name = name,
            // The page fills this in; a name is all the tablet knows alone.
            blurb = "",
            special = id in ControlProtocol.SPECIAL_SCENES
        )
    }

    fun scene(id: String): Scene? = ALL.firstOrNull { it.id == id }
}
