package com.quietshore.control.data

import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.model.sceneNameOf
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * One CSV: Chinese header, UTF-8 BOM, one line per record.
 *
 * The file is opened in Excel on a ward laptop by someone who is not going to
 * run an import wizard. That decides three things, and all three are decided
 * here rather than at the call site so they cannot drift:
 *
 *  - **A BOM.** UTF-8 without one reads as GBK in a Chinese-locale Excel and the
 *    header becomes 乱码. The BOM is written as the first three bytes, not as
 *    a character in the string, so a reader using `readText()` sees a clean
 *    header and a reader using a spreadsheet sees the right encoding.
 *  - **Chinese column names**, because the operator reads the sheet, not a
 *    schema. The order is [COLUMNS] and it is stable: a column appended later
 *    never reorders the ones a report already quotes.
 *  - **Quoting by [escape]**, not by string juggling: a comma, a quote or a
 *    newline in a note is the normal case in a hand-typed comment.
 *
 * Nothing here touches Android, so the transform is testable as a pure function.
 */
object ExperienceCsv {

    /** The BOM, as the three bytes it is. */
    val BOM: ByteArray = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

    /** Column order of the exported sheet; the header is these same strings. */
    val COLUMNS: List<String> = listOf(
        "记录时间",
        "受试者编号",
        "场景",
        "会话时长(秒)",
        "失重强度",
        "方向感错乱",
        "场景真实感",
        "身体对齐",
        "舒适度",
        "头晕",
        "恶心",
        "再次体验意愿",
        "漂浮方向",
        "备注"
    )

    /**
     * The sheet's bytes: BOM, header, one line per record.
     *
     * An empty list still produces a header-only file — the caller decides
     * whether that is worth sharing, and a file with a header is a file the
     * operator can fill in by hand.
     */
    fun bytes(
        records: List<ExperienceRecord>,
        scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL
    ): ByteArray = BOM + text(records, scenes).toByteArray(Charsets.UTF_8)

    /** The sheet without the BOM: header plus rows, `\r\n` line endings. */
    fun text(
        records: List<ExperienceRecord>,
        scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL
    ): String {
        val body = buildString {
            append(headerLine())
            for (record in records) {
                append(LINE_END)
                append(row(record, scenes))
            }
        }
        return body + LINE_END
    }

    /** The header row, unquoted: no column name needs quoting. */
    fun headerLine(): String = COLUMNS.joinToString(SEPARATOR)

    /** One record as one CSV line (no trailing line ending). */
    fun row(
        record: ExperienceRecord,
        scenes: List<SceneCatalog.Scene> = SceneCatalog.ALL
    ): String = listOf(
        escape(stamp(record.at)),
        escape(record.participant),
        escape(sceneNameOf(record.scene, scenes)),
        escape(record.sessionSec.toString()),
        escape(record.floatStrength.toString()),
        escape(record.disorientation.toString()),
        escape(record.sceneRealism.toString()),
        escape(record.bodyAlignment.toString()),
        escape(record.comfort.toString()),
        escape(record.dizziness.toString()),
        escape(record.nausea.toString()),
        escape(record.repeatWish.toString()),
        escape(record.directionLabel.takeUnless { it == "—" }.orEmpty()),
        escape(record.notes)
    ).joinToString(SEPARATOR)

    /**
     * RFC 4180 quoting: quote a field that holds the separator, a quote, or a
     * line break, and double every inner quote.
     *
     * A leading `=`/`+`/`-`/`@` is also quoted: Excel would otherwise read a
     * hand-typed note starting with `-` as a formula. The value is preserved
     * as text, which is what a note is.
     */
    fun escape(value: String): String {
        val risky = value.any { it == ',' || it == '"' || it == '\n' || it == '\r' } ||
            value.startsWith("=") || value.startsWith("+") ||
            value.startsWith("-") || value.startsWith("@")
        if (!risky) {
            return value
        }
        return '"' + value.replace("\"", "\"\"") + '"'
    }

    /**
     * `静岸体验记录_2026-11-14.csv`.
     *
     * The date is in the name because the operator picks from a share sheet
     * two weeks later and "which export is this" is answered by the file name
     * or not at all.
     */
    fun fileName(at: Long = System.currentTimeMillis()): String {
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(at))
        return "静岸体验记录_$day.csv"
    }

    /** Deliberately not locale-dependent: a CSV is read by machines, then people. */
    private fun stamp(epochMs: Long): String {
        if (epochMs <= 0L) return ""
        return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(epochMs))
    }

    /** RFC 4180 says CRLF; Excel accepts it and so does every reader here. */
    private const val LINE_END = "\r\n"
    private const val SEPARATOR = ","
}
