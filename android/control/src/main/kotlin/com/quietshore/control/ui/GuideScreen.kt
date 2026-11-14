package com.quietshore.control.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.tappableElement
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.components.ActionTone
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.components.NumberText
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The operator's guide: five steps that make a session, and what to do when
 * it breaks. Plain sentences, no state table, no protocol jargon.
 *
 * Read on first shift, then used as a quick lookup. The wide layout puts the
 * flow on the left and troubleshooting + records on the right, so neither half
 * of a ten-inch tablet is paper.
 */

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * Keyword markup: `«…»` is a pressable name (ice), `‹…›` is a number or
 * threshold (ink, medium). One colour, one meaning, page-wide — ice is the only
 * accent and it never colours a sentence, only the name of a control.
 */
private class Keyword(val text: String, val numeric: Boolean, val name: Boolean)

private fun mark(source: String): List<Keyword> {
    val out = mutableListOf<Keyword>()
    var i = 0
    while (i < source.length) {
        val cold = source.indexOf('«', i)
        val warm = source.indexOf('‹', i)
        val next = listOf(cold, warm).filter { it >= 0 }.minOrNull()
        if (next == null) {
            out += Keyword(source.substring(i), numeric = false, name = false)
            break
        }
        if (next > i) out += Keyword(source.substring(i, next), numeric = false, name = false)
        val closing = if (source[next] == '«') '»' else '›'
        val end = source.indexOf(closing, next + 1)
        if (end < 0) {
            out += Keyword(source.substring(next + 1), numeric = false, name = false)
            break
        }
        out += Keyword(
            source.substring(next + 1, end),
            numeric = source[next] == '‹',
            name = source[next] == '«'
        )
        i = end + 1
    }
    return out
}

/**
 * The five steps. Each is a verb, one line of action, and at most one note:
 * a guide read mid-shift is a lookup, and two lines is what fits in one
 * glance without moving the eyes off the patient.
 */
private class Step(val number: Int, val title: String, val hint: String, val action: String, val note: String?)

private val STEPS: List<Step> = listOf(
    Step(1, "连接头显", "先让平板找到它",
        "点«搜索头显»，选中这台头显，再点«连接»。",
        "若显示被占用，先在另一台平板点«断开连接»。"),
    Step(2, "让患者进入", "平板发起，患者按一下",
        "点«进入场景»，请患者按一次头显右侧按钮。",
        "‹20 秒›没进入，页面会自动重开。"),
    Step(3, "确认校准", "进入后自动开始",
        "患者保持不动，等校准卡片走完。",
        "没有出卡片或没有成功，点«重新校准»。"),
    Step(4, "选场景并调整", "校准完成后才能选",
        "点场景卡，再点«进入场景»；用漂浮、语音和体位滑条微调。",
        "训练中换场：重新选卡，再点«切换场景»。"),
    Step(5, "结束", "先停会话，再摘头显",
        "点«退出场景»，等画面淡出。",
        "本次时长和问卷结果都留在平板里。")
)

/** Five failures that stop a shift. Symptom → action, one line each. */
private class FaultRow(
    val symptom: String,
    val next: String,
    val tone: ActionTone = ActionTone.Secondary
)

/** Every action under 24 characters: what to do, not why it happened. */
private val FAULTS: List<FaultRow> = listOf(
    FaultRow("头显没连上", "打开头显里的静岸应用，点«搜索头显»。"),
    FaultRow("一直等进入", "请患者再按一次右侧按钮；20 秒后页面会自动重开。"),
    FaultRow("患者不舒服", "先点«退出场景»，再摘头显。", ActionTone.Primary),
    FaultRow("蓝牙断了", "‹5 秒›内点«重新连接»；超时回首页重进。"),
    FaultRow("电量低于 20%", "先充电，再做训练。")
)

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * The questionnaire app's own page. It is deliberately short: the instrument
 * is answered in the headset, the tablet records, and the operator only needs
 * the order and where the records go.
 */
@Composable
private fun QuestionnaireGuide() {
    Text(
        text = "问卷怎么做",
        style = MaterialTheme.typography.headlineLarge,
        color = QuietPalette.TextPrimary,
        modifier = Modifier.semantics { heading() }
    )
    Spacer(Modifier.height(12.dp))
    Text(
        text = "先让患者进入画面，再显示问卷；答完自动保存。",
        style = MaterialTheme.typography.bodyLarge,
        color = QuietPalette.TextSecondary
    )
    Spacer(Modifier.height(28.dp))
    Rule()
    Spacer(Modifier.height(20.dp))
    for ((index, line) in listOf(
        "右上角切到«02 场景化问卷作答器»。",
        "点«启动问卷»，请患者按一次头显右侧按钮。患者没进入前不会出题。",
        "患者进入后，点«显示问卷»；需要哪题就点那一题的«显示»。患者注视选项停住即作答。",
        "答完最后一题自动保存；提前关闭只保存已完成部分。"
    ).withIndex()) {
        Row(Modifier.padding(vertical = 8.dp)) {
            NumberText(
                text = (index + 1).toString().padStart(2, '0'),
                style = MaterialTheme.typography.titleMedium.tabularFigures(),
                color = QuietPalette.TextSecondary,
                modifier = Modifier.width(48.dp)
            )
            KeyLine(
                line,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f)
            )
        }
        if (index != 3) Rule(Modifier.padding(start = 48.dp))
    }
}

@Composable
fun GuideScreen(
    onBack: () -> Unit,
    /** Which app's guide: the 说明 tab follows the current app, never a global one. */
    app: String = "training",
    withChrome: Boolean = true,
    /** Share the local record set; both guides offer it, the file is shared. */
    onExport: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .then(
                if (withChrome) {
                    Modifier
                        .safeDrawingPadding()
                        // The emulator's 3-button taskbar arrives as a
                        // tappable-element inset, which safeDrawing does not
                        // include; without it the last fault row sits under it.
                        .padding(
                            bottom = WindowInsets.tappableElement
                                .asPaddingValues()
                                .calculateBottomPadding()
                        )
                } else {
                    Modifier
                }
            )
    ) {
        if (withChrome) {
            GuideBar(onBack, if (app == "questionnaire") "场景化问卷作答器" else "场景化排尿引导器")
        }
        FadingScrollColumn(
            modifier = Modifier.weight(1f),
            startPadding = 32.dp,
            endPadding = 32.dp
        ) {
            // One reading path, top to bottom: the reader is either learning
            // the flow or looking something up, never both on one glance, so
            // the page is a single scroll with three titled landmarks rather
            // than two columns racing each other.
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                Column(Modifier.widthIn(max = 1360.dp).padding(horizontal = 16.dp)) {
                    Spacer(Modifier.height(24.dp))
                    if (app == "questionnaire") {
                        QuestionnaireGuide()
                        Spacer(Modifier.height(44.dp))
                        RecordsBand(onExport = onExport)
                    } else {
                        BoxWithConstraints(Modifier.fillMaxWidth()) {
                            val wide = maxWidth >= 820.dp
                            if (wide) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(48.dp)
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        StepsBand()
                                    }
                                    Column(Modifier.weight(1f)) {
                                        FaultsBand()
                                        Spacer(Modifier.height(36.dp))
                                        RecordsBand(onExport = onExport)
                                    }
                                }
                            } else {
                                Column {
                                    StepsBand()
                                    Spacer(Modifier.height(36.dp))
                                    FaultsBand()
                                    Spacer(Modifier.height(36.dp))
                                    RecordsBand(onExport = onExport)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(40.dp))
                }
            }
        }
    }
}

/**
 * The record band: one document, both applications.
 *
 * Training sessions, questionnaire sheets and the behaviour events that led to
 * them live in the same local store. The export is deliberately the only thing
 * here that reaches outside the device, and it reaches a destination the
 * operator picks — nothing is uploaded, nothing leaves on a timer.
 */
@Composable
private fun RecordsBand(onExport: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = "记录",
            style = MaterialTheme.typography.titleLarge,
            color = QuietPalette.TextPrimary,
            modifier = Modifier.semantics { heading() }
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = "会话、问卷与本机行为事件同库；只在取下头显后导出",
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.TextSecondary,
            modifier = Modifier.weight(1f)
        )
        Key(
            label = "导出本机记录",
            onClick = onExport,
            kind = KeyKind.Outline
        )
    }
    Spacer(Modifier.height(12.dp))
    Rule()
}

/**
 * A scrolling column that says so: a paper-to-transparent fade sits on the edge
 * while there is more content past it, in the direction that content lies. It
 * is the only affordance the page has — no scrollbar, no shadow — so the fade
 * is drawn flat and short, and it disappears the moment the column bottoms out.
 */
@Composable
private fun FadingScrollColumn(
    modifier: Modifier = Modifier,
    state: ScrollState = rememberScrollState(),
    startPadding: Dp = 20.dp,
    endPadding: Dp = 20.dp,
    content: @Composable ColumnScope.() -> Unit
) {
    val moreBelow by remember(state) {
        derivedStateOf {
            state.value < state.maxValue
        }
    }
    val moreAbove by remember(state) {
        derivedStateOf {
            state.value > 0
        }
    }
    val paper = QuietPalette.Background
    Box(
        modifier = modifier
            .fillMaxHeight()
            .drawWithContent {
                drawContent()
                val fade = 44.dp.toPx()
                if (moreAbove) {
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to paper,
                            1f to paper.copy(alpha = 0f),
                            startY = 0f,
                            endY = fade
                        ),
                        topLeft = Offset.Zero,
                        size = Size(size.width, fade)
                    )
                }
                if (moreBelow) {
                    drawRect(
                        brush = Brush.verticalGradient(
                            0f to paper.copy(alpha = 0f),
                            1f to paper,
                            startY = size.height - fade,
                            endY = size.height
                        ),
                        topLeft = Offset(0f, size.height - fade),
                        size = Size(size.width, fade)
                    )
                }
            }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(state)
                .padding(start = startPadding, end = endPadding, top = 20.dp, bottom = 32.dp),
            content = content
        )
    }
}

/** The app bar on paper: the way back, then what this page is. */
@Composable
private fun GuideBar(onBack: () -> Unit, title: String) {
    Column(Modifier.fillMaxWidth().background(QuietPalette.Board)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(88.dp)
                .padding(horizontal = QuietSpace.Page),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Key(
                label = "返回",
                onClick = onBack,
                kind = KeyKind.Outline
            )
            Spacer(Modifier.width(24.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink
            )
        }
        Rule()
    }
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

@Composable
private fun StepsBand() {
    Section("主流程") {
        for ((index, step) in STEPS.withIndex()) {
            StepRow(step)
            if (index != STEPS.lastIndex) {
                Rule(Modifier.padding(start = 60.dp, end = 4.dp))
            }
        }
    }
}

/**
 * One step: number, verb, its one distinguishing phrase, then one line of
 * action and at most one note. Names inside the copy are ice, figures are ink
 * at medium weight — see [mark].
 */
@Composable
private fun StepRow(step: Step) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp)
    ) {
        NumberText(
            text = step.number.toString().padStart(2, '0'),
            style = MaterialTheme.typography.titleMedium.tabularFigures(),
            color = QuietPalette.InkSecondary,
            modifier = Modifier.width(60.dp)
        )
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = step.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    text = step.hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary
                )
            }
            Spacer(Modifier.height(6.dp))
            KeyLine(step.action, style = MaterialTheme.typography.bodyMedium)
            if (step.note != null) {
                Spacer(Modifier.height(4.dp))
                KeyLine(
                    step.note,
                    style = MaterialTheme.typography.bodySmall,
                    base = QuietPalette.InkSecondary
                )
            }
        }
    }
}

/**
 * One sentence with its keyword markup resolved.
 *
 * Two marks, two meanings, page-wide:
 *  - `«name»` — a control or field the operator will look for on screen. Ice is
 *    a fill with ink on top, never text on paper, so the name is drawn as a
 *    filled chip inline: it reads as the thing, not as emphasis.
 *  - `‹figure›` — a number or threshold. Medium ink, no colour: figures are the
 *    one thing the reader is comparing, and they are already tabular.
 */
@Composable
private fun KeyLine(
    source: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    base: Color = QuietPalette.Ink
) {
    val parts = remember(source) { mark(source) }
    Text(
        text = buildAnnotatedString {
            for (part in parts) {
                when {
                    part.numeric -> withStyle(SpanStyle(fontWeight = FontWeight.Medium)) {
                        append(part.text)
                    }
                    part.name -> withStyle(
                        SpanStyle(
                            background = QuietPalette.Ice,
                            color = QuietPalette.OnIce,
                            fontWeight = FontWeight.Medium
                        )
                    ) {
                        append(part.text)
                    }
                    else -> withStyle(SpanStyle(color = base)) { append(part.text) }
                }
            }
        },
        style = style,
        modifier = modifier
    )
}

/**
 * One titled section, flat: 24 sp title, a hairline, the content, a hairline.
 * Drawn here rather than through `Band` because this page is a document, not a
 * console panel — a filled card per section turns a reading page into a stack
 * of boxes, and the guide's own divisions are what carry its structure.
 */
@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink,
                modifier = Modifier.semantics { heading() }
            )
        }
        Rule()
        Column(content = content)
        Rule()
    }
}

@Composable
private fun FaultsBand() {
    Section("遇到问题") {
        for ((index, fault) in FAULTS.withIndex()) {
            FaultRowView(fault)
            if (index != FAULTS.lastIndex) {
                Rule(Modifier.padding(start = 4.dp, end = 4.dp))
            }
        }
    }
}

@Composable
private fun FaultRowView(row: FaultRow) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalAlignment = Alignment.Top
    ) {
        // The symptom is the lookup key: same tier as a row title, so the eye
        // lands on it before the sentence.
        Column(Modifier.width(180.dp)) {
            Text(
                text = row.symptom,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Medium,
                color = if (row.tone == ActionTone.Primary) {
                    QuietPalette.Danger
                } else {
                    QuietPalette.Ink
                }
            )
        }
        KeyLine(
            row.next,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f)
        )
    }
}
