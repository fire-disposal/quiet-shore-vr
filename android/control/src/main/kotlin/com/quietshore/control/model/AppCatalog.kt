package com.quietshore.control.model

/**
 * The product faces the top bar can switch between.
 *
 * The label is the face's full name: the operator reads the system and the
 * current job in one line, and the box opens the other face.
 */
object AppCatalog {
    data class Entry(val id: String, val label: String)

    val ALL: List<Entry> = listOf(
        Entry("training", "场景化排尿引导器"),
        Entry("questionnaire", "场景化问卷作答器")
    )

    val IDS: Set<String> = ALL.mapTo(HashSet()) { it.id }

    fun entry(id: String): Entry? = ALL.firstOrNull { it.id == id }

    fun label(id: String): String = entry(id)?.label ?: id

    fun next(id: String): String {
        val index = ALL.indexOfFirst { it.id == id }
        return ALL[(index + 1).mod(ALL.size)].id
    }
}
