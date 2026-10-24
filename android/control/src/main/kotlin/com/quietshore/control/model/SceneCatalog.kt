package com.quietshore.control.model

import com.quietshore.control.protocol.ControlProtocol

/**
 * One card per shipped scene, for the operator's choice.
 *
 * Names and blurbs come from the wire module, which is where the ids live: a
 * second copy here is exactly how the washroom once described rails the room
 * does not have. This catalog only adds ordering and lookup.
 */
object SceneCatalog {
    data class Scene(val id: String, val name: String, val blurb: String)

    val ALL: List<Scene> = ControlProtocol.SCENE_IDS.mapNotNull { id ->
        val name = ControlProtocol.SCENE_LABELS[id] ?: return@mapNotNull null
        Scene(id, name, ControlProtocol.SCENE_BLURBS[id].orEmpty())
    }

    fun scene(id: String): Scene? = ALL.firstOrNull { it.id == id }
}
