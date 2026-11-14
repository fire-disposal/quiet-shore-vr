package com.quietshore.control.data

import com.quietshore.control.model.ExperienceRecord
import com.quietshore.control.model.FloatDirection
import com.quietshore.control.model.SceneCatalog
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The CSV: BOM, Chinese header, column order, and quoting that a spreadsheet
 * reads back exactly as the operator typed it.
 *
 * The BOM is checked as bytes because that is what Excel looks at; the header
 * and the rows are checked as text because that is what the report quotes.
 */
class ExperienceCsvTest {

    private fun record(
        at: Long = 1_700_000_000_000L,
        participant: String = "P07",
        scene: String = "shore",
        notes: String = "",
        direction: String = FloatDirection.UP,
        comfort: Int = 7
    ) = ExperienceRecord(
        id = at,
        at = at,
        participant = participant,
        scene = scene,
        sessionSec = 600,
        floatStrength = 6,
        disorientation = 2,
        sceneRealism = 8,
        bodyAlignment = 7,
        comfort = comfort,
        dizziness = 3,
        nausea = 1,
        repeatWish = 9,
        direction = direction,
        notes = notes
    )

    @Test
    fun `the file starts with a UTF-8 BOM`() {
        val bytes = ExperienceCsv.bytes(listOf(record()))

        assertEquals(0xEF, bytes[0].toInt() and 0xFF)
        assertEquals(0xBB, bytes[1].toInt() and 0xFF)
        assertEquals(0xBF, bytes[2].toInt() and 0xFF)
        // The BOM is bytes, not a character inside the text: a reader doing
        // readText() gets a clean header, which is what the tests below assert.
        assertTrue(ExperienceCsv.text(listOf(record())).startsWith("记录时间"))
    }

    @Test
    fun `the header is Chinese and in the documented order`() {
        assertEquals(
            listOf(
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
            ),
            ExperienceCsv.COLUMNS
        )
        assertEquals(ExperienceCsv.COLUMNS.joinToString(","), ExperienceCsv.headerLine())
    }

    @Test
    fun `every record is one line and the header comes first`() {
        val text = ExperienceCsv.text(listOf(record(at = 1L), record(at = 2L)))

        val lines = text.trimEnd().split("\r\n")
        assertEquals(3, lines.size)
        assertEquals(ExperienceCsv.headerLine(), lines[0])
        // 14 columns fill 13 separators; a row is one record, never two.
        assertEquals(13, lines[1].count { it == ',' })
        assertEquals(13, lines[2].count { it == ',' })
    }

    @Test
    fun `a record's row carries the values in column order`() {
        val at = 1_700_000_000_000L
        val catalogue = listOf(SceneCatalog.Scene("shore", "海岸", ""))
        val row = ExperienceCsv.row(record(at = at, comfort = 7), catalogue)
        val cells = row.split(",")

        assertEquals(14, cells.size)
        // The stamp is the tablet's local date, not UTC: a ward reads its own
        // morning, so the expected value is derived the same way rather than
        // hard-coded (which would only hold in one time zone).
        assertEquals(expectedStamp(at, "yyyy-MM-dd HH:mm"), cells[0])
        assertEquals("P07", cells[1])
        assertEquals("海岸", cells[2])
        assertEquals("600", cells[3])
        assertEquals("6", cells[4])
        assertEquals("2", cells[5])
        assertEquals("8", cells[6])
        assertEquals("7", cells[7])
        assertEquals("7", cells[8])
        assertEquals("3", cells[9])
        assertEquals("1", cells[10])
        assertEquals("9", cells[11])
        assertEquals("上升", cells[12])
        assertEquals("", cells[13])
    }

    @Test
    fun `commas quotes and newlines are escaped, not dropped`() {
        val note = "患者说\"像在海里\",\n但觉得有点晕"
        val row = ExperienceCsv.row(record(notes = note))

        // The note is the last column and is fully quoted, inner quotes doubled.
        assertTrue(
            row.endsWith("\"患者说\"\"像在海里\"\",\n但觉得有点晕\""),
            row
        )
        // The record still occupies one CSV field even though it contains a
        // newline and three commas.
        assertEquals(14, splitCsvRow(row).size)
        assertEquals(note, splitCsvRow(row).last())
    }

    @Test
    fun `an empty or unknown direction prints as an empty cell`() {
        assertEquals(
            "",
            ExperienceCsv.row(record(direction = "")).split(",")[12]
        )
        assertEquals(
            "无明显方向",
            ExperienceCsv.row(record(direction = FloatDirection.NONE)).split(",")[12]
        )
    }

    @Test
    fun `a note that starts with a formula marker is quoted so Excel keeps it text`() {
        assertEquals("\"-5 分钟\"", ExperienceCsv.escape("-5 分钟"))
        assertEquals("\"=SUM(A1)\"", ExperienceCsv.escape("=SUM(A1)"))
        assertEquals("\"+86\"", ExperienceCsv.escape("+86"))
        assertEquals("普通备注", ExperienceCsv.escape("普通备注"))
    }

    @Test
    fun `the scene name comes from the live catalogue`() {
        val catalogue = listOf(SceneCatalog.Scene("ward", "病房", ""))

        val row = ExperienceCsv.row(record(scene = "ward"), catalogue)

        assertEquals("病房", splitCsvRow(row)[2])
    }

    @Test
    fun `the file name carries the date`() {
        val at = 1_700_000_000_000L
        val name = ExperienceCsv.fileName(at)

        assertTrue(name.startsWith("静岸体验记录_"), name)
        assertTrue(name.endsWith(".csv"), name)
        // Local date of the export, the same clock the operator's phone shows.
        assertTrue(name.contains(expectedStamp(at, "yyyy-MM-dd")), name)
        // And the shape is always yyyy-MM-dd: ten characters between prefix and
        // suffix, so two exports a week apart never collide by accident.
        assertEquals("静岸体验记录_".length + 10 + ".csv".length, name.length)
    }

    /** The same stamp the sheet prints, computed in the tablet's own zone. */
    private fun expectedStamp(at: Long, pattern: String): String =
        java.text.SimpleDateFormat(pattern, java.util.Locale.US)
            .format(java.util.Date(at))

    @Test
    fun `an empty list still produces a readable header-only sheet`() {
        val bytes = ExperienceCsv.bytes(emptyList())
        val text = String(bytes, Charsets.UTF_8).removePrefix("\uFEFF")

        assertEquals(ExperienceCsv.headerLine() + "\r\n", text)
        assertFalse(text.contains("\n\n"))
    }

    /** A minimal RFC 4180 reader: enough to prove the escaping round-trips. */
    private fun splitCsvRow(row: String): List<String> {
        val cells = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var index = 0
        while (index < row.length) {
            val char = row[index]
            when {
                quoted && char == '"' && index + 1 < row.length && row[index + 1] == '"' -> {
                    cell.append('"')
                    index++
                }
                char == '"' -> quoted = !quoted
                char == ',' && !quoted -> {
                    cells.add(cell.toString())
                    cell.clear()
                }
                else -> cell.append(char)
            }
            index++
        }
        cells.add(cell.toString())
        return cells
    }
}
