package com.quietshore.control.model

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * One 体验 (experience) observation, filed by the operator after a session.
 *
 * This is the sheet the bedside actually fills in: how the float felt, whether
 * the world stayed put, how real the room looked, how the body lined up with
 * it, and whether the patient wants to do it again. It is deliberately *not* a
 * questionnaire instrument: an instrument is answered by the patient by gaze,
 * this is answered by the technician who watched the session, and the two never
 * share a store.
 *
 * The three facts nobody types are captured when the operator opens the form
 * ([at], [scene], [sessionSec]) so the row is self-describing in the CSV: a
 * pile of 0–10 answers with no scene and no date is not a record, it is a quiz.
 *
 * Ratings are 0–10 integers. [participant] and [notes] are the only free text,
 * and both may be empty — an anonymous observation is still an observation.
 */
data class ExperienceRecord(
    /** Stable local identity: the millisecond the form was opened. */
    val id: Long,
    /** Epoch millis the form was opened; the CSV's 记录时间 column. */
    val at: Long,
    /** Operator-supplied subject code, e.g. `P07`. Empty when not recorded. */
    val participant: String = "",
    /** Scene id as the headset reported it, e.g. `shore`. */
    val scene: String = "",
    /** Length of the session the form was opened after, in seconds. */
    val sessionSec: Int = 0,
    /** 失重强度 0–10. */
    val floatStrength: Int = 0,
    /** 方向感错乱 0–10. */
    val disorientation: Int = 0,
    /** 场景真实感 0–10. */
    val sceneRealism: Int = 0,
    /** 身体对齐 0–10. */
    val bodyAlignment: Int = 0,
    /** 舒适度 0–10. */
    val comfort: Int = 0,
    /** 头晕 0–10. */
    val dizziness: Int = 0,
    /** 恶心 0–10. */
    val nausea: Int = 0,
    /** 再次体验意愿 0–10. */
    val repeatWish: Int = 0,
    /** One of [FloatDirection.ids]; empty when the operator skipped it. */
    val direction: String = "",
    /** Free notes; may be empty. Never interpreted, only stored and exported. */
    val notes: String = ""
) {
    /** The scene's Chinese name, from the live catalogue when it is known. */
    fun sceneLabel(scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL): String =
        sceneNameOf(scene, scenes)

    /** The direction's Chinese label, or an em dash when none was picked. */
    val directionLabel: String get() = FloatDirection.label(direction)

    /** Subject code as printed: an anonymous row says so instead of nothing. */
    val participantLabel: String get() = participant.ifBlank { "—" }
}

/**
 * 漂浮方向, the four directions the heave can be felt in.
 *
 * It is a four-way choice, not a 0–10 scale: "the float was 7 up" is not a thing
 * an operator can judge, while "it felt like going up" is exactly what they saw
 * the patient report. Stored as the stable [id] so a wording change never
 * rewrites an archived row.
 */
object FloatDirection {
    const val UP: String = "up"
    const val DOWN: String = "down"
    const val FLOAT: String = "float"
    const val NONE: String = "none"

    /** In form order: the two vertical senses, then the ambiguous ones. */
    val ids: List<String> = listOf(UP, DOWN, FLOAT, NONE)

    fun label(id: String): String = when (id) {
        UP -> "上升"
        DOWN -> "下沉"
        FLOAT -> "漂浮"
        NONE -> "无明显方向"
        else -> "—"
    }

    /** A stored value is only kept when it is one of the four. */
    fun sanitize(id: String?): String = if (id in ids) id!! else ""
}

/**
 * The form as the operator has filled it, before it is filed.
 *
 * Kept separate from [ExperienceRecord] because the form is *not yet* a record:
 * a half-filled sheet must not appear in the list, and the two captured facts
 * ([openedAt], [scene], [sessionSec]) belong to the moment the form opened, not
 * to each keystroke. [toRecord] stamps the id from [openedAt].
 */
data class ExperienceDraft(
    val openedAt: Long,
    val scene: String,
    val sessionSec: Int,
    val participant: String = "",
    val floatStrength: Int = 0,
    val disorientation: Int = 0,
    val sceneRealism: Int = 0,
    val bodyAlignment: Int = 0,
    val comfort: Int = 0,
    val dizziness: Int = 0,
    val nausea: Int = 0,
    val repeatWish: Int = 0,
    val direction: String = "",
    val notes: String = ""
) {
    /** The record this draft files; ratings clamp to the documented 0–10 band. */
    fun toRecord(): ExperienceRecord = ExperienceRecord(
        id = openedAt.coerceAtLeast(1L),
        at = openedAt.coerceAtLeast(1L),
        participant = participant.trim(),
        scene = scene,
        sessionSec = sessionSec.coerceAtLeast(0),
        floatStrength = floatStrength.clampRating(),
        disorientation = disorientation.clampRating(),
        sceneRealism = sceneRealism.clampRating(),
        bodyAlignment = bodyAlignment.clampRating(),
        comfort = comfort.clampRating(),
        dizziness = dizziness.clampRating(),
        nausea = nausea.clampRating(),
        repeatWish = repeatWish.clampRating(),
        direction = FloatDirection.sanitize(direction),
        notes = notes.trim()
    )
}

/** The rating band every 0–10 field is held to. */
const val EXPERIENCE_MAX_RATING: Int = 10

/**
 * A scene id, resolved the one way the whole module resolves it: the live
 * catalogue first, the protocol's built-in table second, and the bare id as the
 * last resort — a lost name is never a reason to drop an observation.
 */
fun sceneNameOf(
    id: String,
    scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL
): String = scenes.firstOrNull { it.id == id }?.name
    ?: SceneCatalog.scene(id)?.name
    ?: id

internal fun Int.clampRating(): Int = coerceIn(0, EXPERIENCE_MAX_RATING)

/** `MM-dd HH:mm` — the list's stamp; the CSV carries the full date. */
fun experienceStamp(epochMs: Long): String {
    if (epochMs <= 0L) return "—"
    return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(epochMs))
}
