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
 * The operator's guide: what this app is, the six steps that make a session,
 * the eight states the screen can be in, and what to try when it breaks.
 *
 * Read once on first shift, then used as a lookup: the reader arrives with a
 * problem ("the stop did not take", "it is stuck on 等待按压") and wants the
 * line for that row, not the whole page. So the page is four bands, each a
 * table-like list divided by hairlines, and the 状态 band's left column uses the
 * same words the command bar and the session band already print. No card stack,
 * no illustration, no second colour: a 4 dp ice bar marks the positioning
 * sentence and nothing else is filled.
 *
 * The layout splits in two columns on a 10" landscape tablet: steps on the
 * left, states and faults on the right, each scrolling on its own so a reader
 * looking up a fault never loses the step they were on.
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
 * The six steps. Each is a verb, one line of action, and at most one note:
 * a guide read mid-shift is a lookup, and two lines is what fits in one
 * glance without moving the eyes off the patient.
 */
private class Step(val number: Int, val title: String, val hint: String, val action: String, val note: String?)

private val STEPS: List<Step> = listOf(
    Step(1, "连接头显", "搜索 → 连接 → 接管",
        "点«搜索头显»，等«已连接»", "被占用：对方点«断开»"),
    Step(2, "选场景", "会话前选择",
        "在«01 场景»选一项", "会话中不可切换"),
    Step(3, "设起身时长", "越长越平缓",
        "«02 起身时长»选 ‹6/8/10/12 秒›", null),
    Step(4, "启动", "点«启动训练»",
        "患者按一次右侧按钮", "‹20 秒›未按将重开页面"),
    Step(5, "调整", "强度、语音、体位",
        "用右侧操作区逐项调整", "体位偏了点«校准»"),
    Step(6, "结束", "可补答 SUS",
        "点«结束»，等淡出", "结束后补答 SUS")
)

/** One row of the state table: the left column is the word the screen prints. */
private class StateRow(
    val state: String,
    val sees: String,
    val does: String,
    val stopping: Boolean = false
)

/** Cells stay under 14 characters: three columns, one glance, no re-reading. */
private val STATES: List<StateRow> = listOf(
    StateRow("待机", "«未开始»", "选场景，点«启动训练»"),
    StateRow("等待按压", "«等待确认»", "患者按右侧按钮"),
    StateRow("校准", "«校准中»", "请患者保持不动"),
    StateRow("训练中", "«训练中»", "按需调强度与语音"),
    StateRow("正在结束", "«正在结束»", "等淡出"),
    StateRow("已结束", "计时停止", "补答 SUS 或再启动"),
    StateRow("连接受限", "«连接受限»", "让头显回到前台"),
    StateRow("已断开", "«头显已断开»", "点«重新连接»")
)

/** Five failures that stop a shift. Symptom → action, one line each. */
private class FaultRow(
    val symptom: String,
    val next: String,
    val tone: ActionTone = ActionTone.Secondary
)

/** Every action under 24 characters: what to do, not why it happened. */
private val FAULTS: List<FaultRow> = listOf(
    FaultRow("头显未连接", "打开头显应用，点«搜索头显»"),
    FaultRow("页面未打开", "点«启动训练»重开"),
    FaultRow("等待确认超时", "患者再按右侧按钮"),
    // Two different failures: one is the patient, one is the link. Merging
    // them into one row used to send the operator to the wrong one.
    FaultRow("患者不适", "按«急停»，再摘头显", ActionTone.Primary),
    FaultRow("连接中断", "摘头显，再重新连接"),
    FaultRow("电量偏低", "‹20%› 以下，先充电")
)

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

@Composable
fun GuideScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
            // The emulator's 3-button taskbar arrives as a tappable-element
            // inset, which safeDrawing does not include; without it the last
            // fault row sits under the buttons.
            .padding(bottom = WindowInsets.tappableElement.asPaddingValues().calculateBottomPadding())
    ) {
        GuideBar(onBack)
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
                Column(Modifier.widthIn(max = 1152.dp).padding(horizontal = 16.dp)) {
                    Spacer(Modifier.height(40.dp))
                    Positioning()
                    Spacer(Modifier.height(44.dp))
                    StepsBand()
                    Spacer(Modifier.height(44.dp))
                    StatesBand()
                    Spacer(Modifier.height(44.dp))
                    FaultsBand()
                    Spacer(Modifier.height(48.dp))
                }
            }
        }
    }
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
private fun GuideBar(onBack: () -> Unit) {
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
                text = "操作说明",
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

/** One sentence of positioning: what this page is, ≤ 20 characters. */
private const val POSITIONING = "床边操作与故障处置"

@Composable
private fun Positioning() {
    Column(Modifier.fillMaxWidth()) {
        Text(
            text = POSITIONING,
            style = MaterialTheme.typography.headlineLarge,
            color = QuietPalette.Ink,
            modifier = Modifier.semantics { heading() }
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "六步流程、八种状态、六类故障",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
    }
}

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
private fun StateHeader() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 10.dp)
    ) {
        Text(
            text = "状态",
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary,
            modifier = Modifier.width(STATE_COLUMN)
        )
        Text(
            text = "屏幕显示",
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(16.dp))
        Text(
            text = "下一步",
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary,
            modifier = Modifier.weight(1f)
        )
    }
}

/** Left column width: the longest word the bar prints (「等待患者确认」 excluded). */
private val STATE_COLUMN: Dp = 128.dp

@Composable
private fun StateRowView(row: StateRow) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 14.dp),
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = row.state,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (row.stopping) FontWeight.Normal else FontWeight.Medium,
            color = if (row.stopping) QuietPalette.Danger else QuietPalette.Ink,
            modifier = Modifier.width(STATE_COLUMN)
        )
        KeyLine(
            row.sees,
            style = MaterialTheme.typography.bodyMedium,
            base = QuietPalette.InkSecondary,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(16.dp))
        KeyLine(
            row.does,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * The lookup table. Its own landmark, its own air above it: a reader who is
 * mid-session arrives here directly and must not have to walk past the six
 * steps to find it.
 */
@Composable
private fun StatesBand() {
    Section("状态与处置") {
        StateHeader()
        Rule()
        for (row in STATES) {
            StateRowView(row)
            Rule()
        }
    }
}

@Composable
private fun FaultsBand() {
    Section("故障处置") {
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
