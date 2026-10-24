package com.quietshore.control.voice

/**
 * The shipped cue list, generated from `voice/lines.json` by
 * `scripts/voice/build.py --catalog`. The tablet never reads files: it needs
 * the ids to send commands and a short label to show.
 */
object VoiceCatalog {
    data class Line(val id: String, val group: String, val text: String)

    val SEQUENCES: List<String> = listOf("start", "imagine", "relax", "close")

    val LINES: List<Line> = listOf(
        Line("v-about-1", "说明", "这是一次技术测试。目的是让您躺着的时候，也能看到站立时的视野与高度。您需要做三件事：戴好头显，看向画面中间的圆并按下头显右侧的按钮，然后保持现在的姿势。感到不适时告诉我，或按同一个按钮停止。感谢您参与测试。"),
        Line("v-wear-1", "引导", "戴上头显，保持现在的姿势。画面中间有一个圆，看向它，按下头显右侧的按钮就能进入。"),
        Line("v-safe-1", "引导", "如果头晕、恶心或不舒服，按头显右侧的按钮，画面会立刻停下。"),
        Line("v-cal-1", "引导", "现在记录起始方向。保持现在的姿势，看向前方；场景会以这个方向为基准。"),
        Line("v-cal-2", "引导", "已记录，场景即将出现。"),
        Line("v-float-1", "引导", "当前是漂浮模式。您看到的视野与站立时相近，世界会缓慢升降。"),
        Line("v-imagine-1", "引导", "想象水面在身体下面，很平；水是温的，从脚慢慢到肩。"),
        Line("v-imagine-2", "引导", "想象身体比水重一点，往下沉；呼气比吸气长一点。"),
        Line("v-relax-1", "引导", "现在可以放松了。有便意时直接排出，不需要忍。"),
        Line("v-relax-2", "引导", "床上有防护垫，弄湿也没关系，结束后会更换。没有时间要求，排不出来也没关系。"),
        Line("v-close-1", "引导", "这次体验即将结束，画面会慢慢淡出。"),
        Line("v-close-2", "引导", "已结束。保持姿势，暂时不要起身。"),
        Line("v-after-1", "引导", "可以摘下头显，需要时工作人员会帮您。"),
        Line("v-rise-1", "引导", "现在慢慢升到站立视角，世界会缓慢旋转；觉得快就说停。"),
        Line("v-safe-2", "引导", "已停止。保持现在的姿势，正常呼吸。"),
        Line("v-thanks-1", "说明", "测试结束，感谢您的参与。您的反馈会用于改进这套系统。"),
        Line("v-sus-intro", "SUS", "接下来有十个问题，每题选一个最接近的答案。"),
        Line("v-sus-1", "SUS", "我愿意经常使用这个系统。"),
        Line("v-sus-10", "SUS", "我需要先学习很多内容才能开始使用这个系统。"),
        Line("v-sus-2", "SUS", "这个系统没有必要这么复杂。"),
        Line("v-sus-3", "SUS", "我觉得这个系统容易使用。"),
        Line("v-sus-4", "SUS", "我需要技术人员的帮助才能用这个系统。"),
        Line("v-sus-5", "SUS", "这个系统的各项功能整合得很好。"),
        Line("v-sus-6", "SUS", "这个系统有太多不一致的地方。"),
        Line("v-sus-7", "SUS", "我认为大多数人能很快学会使用这个系统。"),
        Line("v-sus-8", "SUS", "这个系统用起来很麻烦。"),
        Line("v-sus-9", "SUS", "使用这个系统时我很有信心。"),
    )

    private val byId: Map<String, Line> = LINES.associateBy { it.id }

    fun line(id: String): Line? = byId[id]

    /** Wire voiceId is an index into this list; 255 means "nothing playing". */
    fun lineAt(index: Int): Line? = if (index < 0) null else LINES.getOrNull(index)

    fun indexOf(id: String): Int = LINES.indexOfFirst { it.id == id }
}
