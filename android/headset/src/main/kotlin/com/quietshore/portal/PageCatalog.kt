package com.quietshore.portal

import android.content.Context
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.SceneCatalogDocument

/**
 * The scene catalogue on the headset, in one place.
 *
 * The page's registry is the source. This object only holds the copy of it the
 * headset needs before the page has connected (the home card, and the allowlist
 * for `scene:<id>`): the APK ships `assets/catalog.json`, generated from the
 * registry at build time, and every live announcement replaces it. There is no
 * second table of scene ids in Kotlin.
 *
 * The parsed snapshot is cached because the state frame asks for the id order
 * at 10 Hz; re-parsing or rebuilding a set per frame would be waste.
 */
internal object PageCatalog {
    private const val PREFS = "quietshore.portal"
    private const val KEY_CATALOG = "catalog.json"
    private const val ASSET = "catalog.json"

    private class Snapshot(
        val scenes: List<SceneCatalogDocument.Scene>
    ) {
        val ids: List<String> = scenes.map { it.id }
        val idSet: Set<String> = ids.toHashSet()
    }

    @Volatile
    private var cached: Snapshot? = null

    /** Fallback for a development APK built without the generated asset. */
    private val builtIn: List<SceneCatalogDocument.Scene> =
        ControlProtocol.SCENE_IDS.map { id ->
            SceneCatalogDocument.Scene(
                id = id,
                nameZh = ControlProtocol.SCENE_LABELS[id] ?: id,
                taglineZh = "",
                comfortLevel = null
            )
        }

    private fun snapshot(context: Context): Snapshot {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            return Snapshot(read(context)).also { cached = it }
        }
    }

    fun entries(context: Context): List<SceneCatalogDocument.Scene> =
        snapshot(context).scenes

    fun ids(context: Context): List<String> = snapshot(context).ids

    fun idSet(context: Context): Set<String> = snapshot(context).idSet

    fun scene(context: Context, id: String): SceneCatalogDocument.Scene? =
        snapshot(context).scenes.firstOrNull { it.id == id }

    /**
     * Replaces the catalogue from a live announcement. Returns false for a
     * damaged document and keeps the last good one; the raw text is stored so
     * the home card is right on the next launch without the page.
     */
    fun update(context: Context, json: String): Boolean {
        val scenes = SceneCatalogDocument.parse(json) ?: return false
        synchronized(this) { cached = Snapshot(scenes) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CATALOG, json)
            .apply()
        return true
    }

    private fun read(context: Context): List<SceneCatalogDocument.Scene> {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CATALOG, null)
            ?.let(SceneCatalogDocument::parse)
            ?.let { return it }
        val bundled = try {
            context.assets.open(ASSET).bufferedReader().use { it.readText() }
        } catch (error: Exception) {
            null
        }
        return bundled?.let(SceneCatalogDocument::parse) ?: builtIn
    }
}
