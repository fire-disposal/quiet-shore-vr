package com.quietshore.control.voice

/**
 * The shipped cue list, generated from `voice/lines.json` by
 * `scripts/voice/build.py --catalog`. The tablet never reads files: it needs
 * the ids to send commands and a short label to show.
 */
object VoiceCatalog {
    data class Line(val id: String, val group: String, val label: String)

    val SEQUENCES: List<String> = listOf("start", "imagine", "relax", "close")

    val LINES: List<Line> = listOf(
        Line("v-about-1", "说明", "戴好头显后"),
        Line("v-wear-1", "进入", "戴上头显"),
        Line("v-safe-1", "安全", "如果头晕、恶心或不舒服"),
        Line("v-cal-1", "校准", "现在记录起始方向"),
        Line("v-cal-2", "校准", "已记录"),
        Line("v-float-1", "漂浮", "当前是漂浮模式"),
        Line("v-imagine-1", "想象", "想象水面在身体下面"),
        Line("v-imagine-2", "想象", "想象身体比水重一点"),
        Line("v-relax-1", "放松", "现在可以放松了"),
        Line("v-relax-2", "放松", "床上有防护垫"),
        Line("v-close-1", "收束", "训练即将结束"),
        Line("v-close-2", "收束", "已结束"),
        Line("v-after-1", "结束", "可以摘下头显"),
        Line("v-rise-1", "起身", "现在切换到起身视角"),
        Line("v-safe-2", "安全", "已停止"),
        Line("v-thanks-1", "说明", "这次体验结束"),
        Line("v-sus-intro", "SUS 量表", "接下来有十个问题"),
        Line("v-sus-1", "SUS 量表", "我愿意经常使用这个系统"),
        Line("v-sus-10", "SUS 量表", "我需要先学习很多内容才…"),
        Line("v-sus-2", "SUS 量表", "这个系统没有必要这么复杂"),
        Line("v-sus-3", "SUS 量表", "我觉得这个系统容易使用"),
        Line("v-sus-4", "SUS 量表", "我需要技术人员的帮助才…"),
        Line("v-sus-5", "SUS 量表", "这个系统的各项功能整合…"),
        Line("v-sus-6", "SUS 量表", "这个系统有太多不一致的…"),
        Line("v-sus-7", "SUS 量表", "我认为大多数人能很快学…"),
        Line("v-sus-8", "SUS 量表", "这个系统用起来很麻烦"),
        Line("v-sus-9", "SUS 量表", "使用这个系统时我很有信心"),
    )

    private val byId: Map<String, Line> = LINES.associateBy { it.id }

    fun line(id: String): Line? = byId[id]

    /** Wire voiceId is an index into this list; 255 means "nothing playing". */
    fun lineAt(index: Int): Line? = if (index < 0) null else LINES.getOrNull(index)

    fun indexOf(id: String): Int = LINES.indexOfFirst { it.id == id }
}
