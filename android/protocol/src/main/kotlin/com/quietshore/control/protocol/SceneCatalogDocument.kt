package com.quietshore.control.protocol

import org.json.JSONObject

/**
 * The scene catalogue, as the page publishes it on the JSON channel and as the
 * headset APK ships it in `assets/catalog.json`.
 *
 * The registry in the page is the only place a scene is declared. This type is
 * the one reader both Android apps use, so the tablet's cards, the headset's
 * home card and the scene-command allowlist can never drift apart.
 *
 * Order is the wire contract for the state frame's 4-bit scene index: entries
 * are append-only. [MAX_SCENES] is that nibble's capacity.
 */
object SceneCatalogDocument {
    const val MAX_SCENES = 16

    /** One entry. [comfortLevel] is null when the scene allows the global max. */
    data class Scene(
        val id: String,
        val nameZh: String,
        val taglineZh: String,
        val comfortLevel: Int? = null,
        /** Built-in preparation space: rendered, but never offered as a choice. */
        val special: Boolean = false
    )

    private val ID = Regex("^[a-z][a-z0-9-]{0,15}$")

    /**
     * Parses `{"scenes":[{id,name:{zh,en},tagline:{zh,en},comfortLevel}]}`.
     *
     * Returns null for anything malformed, empty, duplicated or over
     * [MAX_SCENES]: a half-read catalogue would silently reorder the indices
     * the state frame rides on, which is worse than keeping the last good one.
     */
    fun parse(json: String): List<Scene>? {
        val array = try {
            JSONObject(json).optJSONArray("scenes") ?: return null
        } catch (error: Exception) {
            return null
        }
        if (array.length() !in 1..MAX_SCENES) {
            return null
        }
        val scenes = ArrayList<Scene>(array.length())
        val seen = HashSet<String>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: return null
            val id = item.optString("id").trim()
            if (!ID.matches(id) || !seen.add(id)) {
                return null
            }
            val name = item.optJSONObject("name")?.optString("zh").orEmpty().trim()
            val tagline = item.optJSONObject("tagline")?.optString("zh").orEmpty().trim()
            val comfort = item.optInt("comfortLevel", 0).takeIf { it in 1..3 }
            val special = item.optBoolean("special", false)
            scenes.add(Scene(id, name.ifEmpty { id }, tagline, comfort, special))
        }
        return scenes
    }
}
