package com.quietshore.control.model

/** The product faces the shell can switch between. */
object AppCatalog {
    data class Entry(val id: String, val label: String)

    val ALL: List<Entry> = listOf(
        Entry("training", "训练"),
        Entry("questionnaire", "问卷")
    )

    val IDS: Set<String> = ALL.mapTo(HashSet()) { it.id }

    fun entry(id: String): Entry? = ALL.firstOrNull { it.id == id }

    fun label(id: String): String = entry(id)?.label ?: id

    fun next(id: String): String {
        val index = ALL.indexOfFirst { it.id == id }
        return ALL[(index + 1).mod(ALL.size)].id
    }
}
