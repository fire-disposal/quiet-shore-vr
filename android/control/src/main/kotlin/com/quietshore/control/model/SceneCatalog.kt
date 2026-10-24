package com.quietshore.control.model

/**
 * One line per shipped scene, for the operator's choice card.
 *
 * The wire contract only needs ids; this text exists so an operator can tell
 * the three rooms apart without remembering what "lightwell" looks like.
 */
object SceneCatalog {
    data class Scene(val id: String, val name: String, val blurb: String)

    val ALL: List<Scene> = listOf(
        Scene("washroom", "洁净立便间", "站立体位：马桶正前方，扶手与呼叫绳在伸手可及处。"),
        Scene("shore", "仰望湖面", "仰卧视角：云与水面缓慢移动，地平线固定。"),
        Scene("lightwell", "光井", "仰卧视角：光环绕着身体上升，视点不动。")
    )

    fun scene(id: String): Scene? = ALL.firstOrNull { it.id == id }
}
