package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.tappableElement
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.components.SceneCardView
import com.quietshore.control.ui.components.ActionColumnWidth
import com.quietshore.control.ui.components.ActionKey
import com.quietshore.control.ui.components.ActionTone
import com.quietshore.control.ui.components.AngleGauge
import com.quietshore.control.ui.components.Band
import com.quietshore.control.ui.components.BarWordKey
import com.quietshore.control.ui.components.CommandBar
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.components.KeyRow
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.MonitorPanel
import com.quietshore.control.ui.components.NoticeRow
import com.quietshore.control.ui.components.Panel
import com.quietshore.control.ui.components.PitchSideGauge
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SceneChooser
import com.quietshore.control.ui.components.SectionHead
import com.quietshore.control.ui.components.Stepper
import com.quietshore.control.ui.components.SwitchRow
import com.quietshore.control.ui.components.TouchTarget
import com.quietshore.control.ui.components.clock
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console — four states, one screen, arranged the way a session is run.
 *
 * The layout has two variants, because the operator is doing two different
 * jobs in them. That is the whole design: a single "one page, four panels" grid
 * made the standby screen look like a monitor and the monitor look like
 * settings, and the technician had to look for the thing they wanted.
 *
 * **Standby (idle / entry / calibrating) — the preparation bench.** Read it as
 * a chain, left to right, in clinical order: *who is connected → which scene →
 * how long the rise takes → start.* The scene cards are the visual anchor; the
 * one action the page is about (启动训练) is the only ice block besides the stop.
 *
 * ```text
 *   顶栏：静岸控制台 │ 已连接 3F-0927 │ 说明 ⋯              [ 急停 ]
 *        待机 │ 仰望湖面 │ 未开始
 *   ┌────────────────────────────────────────────┐ ┌──────────────────┐
 *   │ 准备本次训练                                 │ │ 准备               │
 *   │ 链路 / 场景 / 上限 / 时长      (facts)       │ │ [ 02 场景 ]    ← 1 │
 *   ├────────────────────────────────────────────┤ │ [ 03 起身时长 ] ← 2 │
 *   │ 01 场景   [洁净立便间][仰望湖面][光井][病房]  │ │                    │
 *   ├────────────────────────────────────────────┤ │ [ 04 启动训练 ] ← 主│
 *   │ 02 起身时长   6  8  10  12 秒                │ │                    │
 *   └────────────────────────────────────────────┘ └──────────────────┘
 * ```
 *
 * **Session (running / stopping) — the monitor.** The one place on the screen
 * that is read rather than pressed is the figure block, and it takes the width
 * the mirror would otherwise take:
 *
 * ```text
 *   ┌──────────────────────────────┐ ┌──────────────────────────────────┐
 *   │ 仍在运行 12:00 时长          │ │ 会话中                            │
 *   │ 12 % 体位   ±18 mm 强度      │ │ 场景  [洁净立便间][仰望湖面]…     │
 *   │ 体位 ▓▓▓▓░░░░                │ │ 强度  − 2 +                      │
 *   └──────────────────────────────┘ │ 语音  下一句 · 放松               │
 *   ┌──────────────────────────────┐ │ 体位  起身 / 躺下 / 停止          │
 *   │ 患者视野镜像                  │ │                                  │
 *   │ (WebView)                    │ │ [ 结束 ]                         │
 *   └──────────────────────────────┘ └──────────────────────────────────┘
 * ```
 *
 * The mirror is the biggest object during a session — it answers "what is the
 * patient looking at right now" at a glance, which is the one thing the
 * technician cannot otherwise see — and the controls are a 460 dp column of
 * keys that all act on the running session.
 */
@Composable
fun ControlScreen(
    state: ControlUiState,
    actions: ControlActions,
    /** Latest one-shot operator message; shown briefly under the bar. */
    event: UiEvent? = null,
    onOpenInfo: () -> Unit = {},
    /** Design review only: open the mirror cover on first composition. */
    startWithMirrorOpen: Boolean = false
) {
    val phase = sessionPhaseOf(
        state.control,
        state.phase,
        state.startPending,
        state.stopRequested
    )
    val sessionLayout = phase.inSession
    // The mirror is on demand: it answers "what is the patient looking at",
    // which is a question asked, not a panel that sits on screen all session.

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Paper)
            .safeDrawingPadding()
            // Same fix the guide page needed: `tappableElement` (the system
            // taskbar's tappable band) is not in safeDrawing, so the last rows
            // could render underneath it.
            .padding(bottom = WindowInsets.tappableElement.asPaddingValues().calculateBottomPadding())
    ) {
        // 1000 dp is where the mirror and the action column both fit at a size
        // worth reading; below it the page becomes one column in the same order.
        val wide = maxWidth >= 1000.dp
        Column(Modifier.fillMaxSize()) {
            CommandBar(
                state = state,
                onOpenInfo = onOpenInfo,
                onDisconnect = actions.onDisconnect,
                onExitScene = actions.onExitScene,
                onExitSystem = actions.onExitSystem,
                onEmergencyStop = actions.onEmergencyStop
            )
            LinkBanners(
                state = state,
                event = event,
                actions = actions
            )
            // Everything below the bar, so the cover can dim it. The bar stays
            // outside this box: the stop must not move when the mirror opens.
            Box(Modifier.weight(1f).fillMaxWidth()) {
            if (wide) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(
                            start = QuietSpace.Page,
                            end = QuietSpace.Page,
                            top = QuietSpace.Page,
                            bottom = QuietSpace.Page
                        ),
                    horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section)
                ) {
                    if (sessionLayout) {
                        SessionMain(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier.weight(1f).fillMaxHeight()
                        )
                        SessionActions(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier
                                .width(ActionColumnWidth)
                                .fillMaxHeight(),
                        )
                    } else {
                        StandbyMain(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier.weight(1f).fillMaxHeight()
                        )
                        StandbySteps(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier
                                .width(ActionColumnWidth)
                                .fillMaxHeight()
                        )
                    }
                }
            } else {
                val scroll = rememberScrollState()
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(scroll)
                        .padding(
                            start = 20.dp,
                            end = 20.dp,
                            top = 20.dp,
                            bottom = 24.dp
                        ),
                    verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
                ) {
                    if (sessionLayout) {
                        SessionMain(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier,
                            scrollable = false
                        )
                        SessionActions(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier,
                            fill = false,
                        )
                    } else {
                        StandbyMain(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier,
                            scrollable = false
                        )
                        StandbySteps(
                            state = state,
                            actions = actions,
                            phase = phase,
                            modifier = Modifier
                        )
                    }
                }
            }
        }
    }
}
}

// ---------------------------------------------------------------------------
// Standby
// ---------------------------------------------------------------------------

/** Left: what is true right now, then the scene choice — the page's anchor. */
@Composable
private fun StandbyMain(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier,
    /** False when the parent column already scrolls; nesting two is a crash. */
    scrollable: Boolean = true
) {
    val ready = state.phase == BlePhase.READY
    Column(if (scrollable) modifier.verticalScroll(rememberScrollState()) else modifier) {
        SectionHead(
            title = "01 场景",
            note = when (phase) {
                SessionPhase.Entry -> "切换会重开页面"
                SessionPhase.Calibrating -> "校准中，暂不可切换"
                else -> "会话前选择，会话中不可切换"
            }
        )
        SceneChooser(
            current = state.sceneIntent.ifEmpty { state.control.scene },
            enabled = ready && phase.acceptsChanges,
            onSelect = actions.onSceneSelect,
            playing = state.control.scene
        )
        Spacer(Modifier.height(QuietSpace.Section))
        SectionHead(title = "02 起身时长", note = "患者从躺到坐的时长，越长越平缓")
        DurationRow(
            selected = state.animDurationMs,
            enabled = ready,
            onSelect = actions.onAnimDuration
        )
        Spacer(Modifier.height(QuietSpace.Section))
        SectionHead(title = "体位与起伏", note = "会话中也可调整")
        Panel(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(QuietSpace.Panel)) {
                SwitchRow(
                    title = "竖直起伏",
                    checked = state.control.floatLevel > 0,
                    onCheckedChange = { on ->
                        actions.onFloatLevel(if (on) state.caps.floatMax.coerceAtLeast(1) else 0)
                    },
                    enabled = ready && state.caps.float,
                    note = "画面缓慢升降，视野随之移动。"
                )
                Rule()
                KeyRow(Modifier.padding(top = 16.dp)) {
                    ActionKey(
                        label = "起身",
                        onClick = actions.onPostureRise,
                        modifier = Modifier.weight(1f),
                        tone = ActionTone.Primary,
                        enabled = ready && state.caps.rise
                    )
                    ActionKey(
                        label = "躺下",
                        onClick = actions.onPostureLower,
                        modifier = Modifier.weight(1f),
                        enabled = ready && state.caps.lie
                    )
                    ActionKey(
                        label = "停止",
                        onClick = actions.onPostureStop,
                        modifier = Modifier.weight(1f),
                        enabled = ready && state.caps.stop
                    )
                }
            }
        }
        Spacer(Modifier.height(QuietSpace.Section))
        VoiceSummary(state = state, actions = actions)
    }
}

/**
 * Right: the four steps as a numbered chain, with the start key as its foot.
 * Numbers are real (they are the order of the procedure, the same 01–04 in the
 * guide), and the step that is done keeps its number greyed rather than moving
 * the row: the page must not re-shuffle under a hand that is already moving.
 */
@Composable
private fun StandbySteps(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier
) {
    val ready = state.phase == BlePhase.READY
    val connected = ready
    Panel(modifier) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            Text(
                text = "准备",
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "启动后，患者按右侧按钮。",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            Spacer(Modifier.height(24.dp))
            // The numbers here are the steps of a procedure, so the left column
            // carries no numbers of its own: one chain, counted once.
            StepLine("连接头显", if (connected) "已连接" else "未连接", connected)
            Spacer(Modifier.height(16.dp))
            StepLine(
                "选场景",
                if (state.control.scene.isEmpty()) "未选" else "已选",
                state.control.scene.isNotEmpty()
            )
            Spacer(Modifier.height(16.dp))
            StepLine("设起身时长", "越长越平缓", true)
            Spacer(Modifier.height(16.dp))
            StepLine("启动训练", "按后进入校准", phase == SessionPhase.Entry)
            Spacer(Modifier.height(24.dp))
            ActionKey(
                label = when (phase) {
                    SessionPhase.Entry -> "等待确认"
                    SessionPhase.Calibrating -> "校准中"
                    else -> "启动训练"
                },
                onClick = actions.onEnterTraining,
                modifier = Modifier.fillMaxWidth(),
                tone = ActionTone.Primary,
                height = 72.dp,
                enabled = ready && phase == SessionPhase.Idle,
                textStyle = MaterialTheme.typography.titleMedium
            )
            if (phase == SessionPhase.Entry) {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LoadingDots(color = QuietPalette.Ink)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = "已过 ${clock(state.sessionElapsedMs)}。20 秒未按将重开页面。",
                        style = MaterialTheme.typography.bodySmall.tabularFigures(),
                        color = QuietPalette.InkSecondary
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = if (!connected) {
                    "头显未连接。返回配对页重连。"
                } else if (phase == SessionPhase.Calibrating) {
                    "校准中，仅急停可用。"
                } else {
                    "患者确认后开始训练。"
                },
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            if (phase == SessionPhase.Idle && state.sessionElapsedMs > 0L) {
                // A finished session's last step: the scale is answered while
                // the patient is still on the bed, not after they leave.
                Spacer(Modifier.height(16.dp))
                Rule()
                Row(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "上一轮已完成，补答 SUS",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary,
                        modifier = Modifier.weight(1f)
                    )
                    BarWordKey(label = "打开量表", onClick = actions.onSusOpen, enabled = ready)
                }
            }
        }
    }
}

/**
 * One row of the chain: the step, its current value, and a 4 dp ice bar on the
 * leading edge once it is done. The bar is the selection mark used elsewhere
 * for "this is the current one", so a done step reads as state without a fill.
 */
@Composable
private fun StepLine(name: String, value: String, done: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .width(4.dp)
                .height(40.dp)
                .background(if (done) QuietPalette.Ice else QuietPalette.Hairline)
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = name,
                style = MaterialTheme.typography.titleSmall,
                color = QuietPalette.Ink
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
        }
    }
}

/** Four ramp lengths; the page accepts any 4–14 s, these are the useful ones. */
private val DURATIONS_S = listOf(6, 8, 10, 12)

@Composable
private fun DurationRow(selected: Int, enabled: Boolean, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for (seconds in DURATIONS_S) {
            val active = selected == seconds * 1000
            Key(
                label = "$seconds 秒",
                onClick = { onSelect(seconds * 1000) },
                kind = if (active) KeyKind.Fill else KeyKind.Outline,
                enabled = enabled,
                minWidth = 96.dp,
                height = 64.dp,
                textStyle = MaterialTheme.typography.titleSmall
            )
        }
    }
}

/** The voice line and its door: one band, not a second panel of transport keys. */
@Composable
private fun VoiceSummary(state: ControlUiState, actions: ControlActions) {
    val line = state.voiceLine
    SectionHead(title = "语音", note = "患者听到的提示语")
    // One row, not a card: preparation has one primary action (启动训练) and
    // this section's only job is to open the cue list. Playing one line early
    // lives in that panel, and in the session's voice row.
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = line?.text ?: "未播放",
            style = MaterialTheme.typography.bodyMedium,
            color = if (line != null) QuietPalette.Ink else QuietPalette.InkSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(16.dp))
        BarWordKey(
            label = "全部语音",
            onClick = actions.onVoiceOpen,
            enabled = state.phase == BlePhase.READY
        )
    }
}

/** The cue after the one speaking, from the catalogue's own order. */
private fun nextVoiceId(state: ControlUiState): String {
    val lines = com.quietshore.control.voice.VoiceCatalog.LINES
    val index = lines.indexOfFirst { it.id == state.voiceLine?.id }
    return lines.getOrNull(index + 1)?.id ?: lines.first().id
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Left: the figures, then what the patient sees. Both read-only, one glance. */
@Composable
private fun SessionMain(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier,
    /** False when the parent column already scrolls; nesting two is a crash. */
    scrollable: Boolean = true
) {
    Column(if (scrollable) modifier.verticalScroll(rememberScrollState()) else modifier) {
        Spacer(Modifier.height(28.dp))
        // The patient sees something: show it. A live mirror outranks a dial,
        // because it is the only thing on this screen that can disagree with
        // the scene you think you loaded.
        SectionHead(title = "患者视野", note = "镜像来自状态帧")
        Rule()
        MirrorSlot(state = state, phase = phase)
        MonitorPanel(
            state = state,
            running = phase == SessionPhase.Running,
            // The headline is the one thing a glance has to answer: is the
            // session under way, being recorded, or being torn down.
            // One status word only: `仍在运行 / 训练中` said the same thing
            // twice, and "记录体位中" also broke the 校准 terminology.
            headline = when (phase) {
                SessionPhase.Calibrating -> "校准中"
                SessionPhase.Stopping -> "正在结束"
                else -> "训练中"
            },
            sessionWord = "",
            // The clock's own caption follows the same phase: during the fade
            // the session is over, and "未开始" under a 04:12 would be a lie.
            clockWord = when (phase) {
                SessionPhase.Calibrating -> "已过"
                SessionPhase.Stopping -> "已结束"
                else -> "已运行"
            }
        )

        Spacer(Modifier.height(28.dp))
        // Same shape as every other block on the page: title, hairline, content
        // on the paper. No second white card inside the white panel.
        SectionHead(title = "患者当前姿态", note = "只读")
        Rule()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(40.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PitchSideGauge(pose = state.pose, stale = state.poseStale)
            AngleGauge(pose = state.pose, stale = state.poseStale)
        }
    }
}

/**
 * The mirror's height. Fixed rather than weighted: the column above it (the
 * monitor) sizes itself to its content, and a mirror that shrank with the
 * window would leave the gauges floating in a gap.
 */
private val MirrorHeight = 340.dp

/**
 * The renderer: the patient's picture when there is one, a placeholder that
 * says why when there is not.
 *
 * A session screen with an empty box is the old failure this replaces. The
 * placeholder is paper, not an illustration and not an accent: "no picture" is
 * information, not an alert.
 */
@Composable
private fun MirrorSlot(state: ControlUiState, phase: SessionPhase) {
    val hasFrame = state.phase == BlePhase.READY && state.pose != null && !state.poseStale
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(MirrorHeight)
            .clip(CutCornerShape(0.dp, 0.dp, 0.dp, 18.dp))
            .background(if (hasFrame) QuietPalette.Ink else QuietPalette.Board)
    ) {
        if (hasFrame) {
            com.quietshore.control.ui.components.MirrorView(
                state = state,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val title = if (phase == SessionPhase.Entry) "患者尚未进入场景" else "镜像未连接"
                val note = if (phase == SessionPhase.Entry) {
                    "头显在入口页，等待患者按压。"
                } else {
                    "头显未连接，或未收到状态帧。"
                }
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.InkSecondary
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Link state
// ---------------------------------------------------------------------------

/**
 * The link, when it needs saying: a banner above the content, never a dialog.
 * Ice while it is a wait the operator can sit out; red never appears here —
 * red belongs to a deletion.
 */
@Composable
private fun SessionActions(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier,
    /** In the stacked layout the column takes its content height, not the screen's. */
    fill: Boolean = true,
) {
    val ready = state.phase == BlePhase.READY
    // During a session the scene is fixed: the page only accepts `scene:<id>`
    // before the launch, so a scene key that looked live would be a key that
    // does nothing. Strength and posture stay live; the scene is read-only.
    val scenesEnabled = false
    val level = state.control.floatLevel.coerceIn(0, 3)
    Column(modifier) {
        // Keys that can grow live in a scroller so a taller type scale or a
        // longer label can never push the stop out of reach; 结束 stays below
        // it, pinned to the foot of the column.
        Box(
            Modifier.then(if (fill) Modifier.weight(1f) else Modifier)
        ) {
        Column(
            Modifier.then(
                if (fill) Modifier.fillMaxSize().verticalScroll(rememberScrollState()) else Modifier
            )
        ) {
        Panel(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    text = "场景",
                    style = MaterialTheme.typography.labelMedium,
                    color = QuietPalette.InkSecondary
                )
                Spacer(Modifier.height(10.dp))
                // Four cards do not fit one 460 dp column: two rows of two,
                // name only — the blurb belongs to the preparation bench.
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (scene in com.quietshore.control.model.SceneCatalog.ALL.take(2)) {
                            SceneCardView(
                                scene = scene,
                                current = scene.id == state.control.scene,
                                enabled = scenesEnabled,
                                onSelect = actions.onSceneSelect,
                                modifier = Modifier.weight(1f),
                                showBlurb = false
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (scene in com.quietshore.control.model.SceneCatalog.ALL.drop(2)) {
                            SceneCardView(
                                scene = scene,
                                current = scene.id == state.control.scene,
                                enabled = scenesEnabled,
                                onSelect = actions.onSceneSelect,
                                modifier = Modifier.weight(1f),
                                showBlurb = false
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    text = if (phase == SessionPhase.Calibrating) {
                        "校准中，仅急停可用。"
                    } else {
                        "会话中不可切换"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary
                )
            }
            Rule()
            Row(
                modifier = Modifier.padding(20.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "强度",
                        style = MaterialTheme.typography.labelMedium,
                        color = QuietPalette.InkSecondary
                    )
                    Text(
                        text = "上限 ${state.caps.floatMax} 级",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
                }
                Stepper(
                    value = "$level",
                    description = "强度 $level 级",
                    canDecrement = ready && phase.acceptsChanges && level > 0,
                    canIncrement = ready && phase.acceptsChanges && level < state.caps.floatMax,
                    onDecrement = { actions.onFloatLevel(level - 1) },
                    onIncrement = { actions.onFloatLevel(level + 1) }
                )
            }
            Rule()
            Row(
                modifier = Modifier.padding(20.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "语音",
                        style = MaterialTheme.typography.labelMedium,
                        color = QuietPalette.InkSecondary
                    )
                    Text(
                        text = state.voiceLine?.let {
                            if (it.text.length > 16) it.text.take(15) + "…" else it.text
                        } ?: "未播放",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary,
                        maxLines = 1
                    )
                }
                Spacer(Modifier.width(12.dp))
                // Calibration measures where the body is: the caption says only
                // the stop works, so every voice key refuses for the same span.
                Key(
                    label = "停止",
                    onClick = actions.onVoiceStop,
                    enabled = ready && phase.acceptsChanges,
                    height = TouchTarget
                )
                Spacer(Modifier.width(8.dp))
                Key(
                    label = "下一句",
                    onClick = { actions.onVoicePlay(nextVoiceId(state)) },
                    enabled = ready && phase.acceptsChanges,
                    height = TouchTarget
                )
                Spacer(Modifier.width(8.dp))
                // The full cue list has to be reachable without a tab rail.
                Key(
                    label = "全部语音",
                    onClick = actions.onVoiceOpen,
                    enabled = ready && phase.acceptsChanges,
                    height = TouchTarget
                )
            }
            Rule()
            Column(Modifier.padding(20.dp)) {
                Text(
                    text = "体位",
                    style = MaterialTheme.typography.titleSmall,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.height(12.dp))
                // Recording the posture freezes every motion channel: the page
                // is measuring where the body is, so moving it would record the
                // movement instead. Only the stop stays live.
                KeyRow {
                    ActionKey(
                        label = "起身",
                        onClick = actions.onPostureRise,
                        modifier = Modifier.weight(1f),
                        tone = ActionTone.Primary,
                        enabled = ready && state.caps.rise && phase.acceptsChanges
                    )
                    ActionKey(
                        label = "躺下",
                        onClick = actions.onPostureLower,
                        modifier = Modifier.weight(1f),
                        enabled = ready && state.caps.lie && phase.acceptsChanges
                    )
                    ActionKey(
                        label = "停止",
                        onClick = actions.onPostureStop,
                        modifier = Modifier.weight(1f),
                        enabled = ready && state.caps.stop && phase.acceptsChanges
                    )
                }
            }
        }
        }
        // The panels scroll under a fade: a row cut at the edge would read as a
        // broken layout, the fade reads as "there is more".
        if (fill) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(40.dp)
                    .background(
                        Brush.verticalGradient(
                            listOf(QuietPalette.Board.copy(alpha = 0f), QuietPalette.Board)
                        )
                    )
            )
        }
        }
        // Corrections stay reachable without hunting: one row, outside the
        // scroller, directly above the stop.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp, start = 20.dp, end = 20.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            BarWordKey(
                label = "校准",
                onClick = actions.onRecalibrate,
                enabled = ready && phase == SessionPhase.Running
            )
        }
        Spacer(Modifier.height(16.dp))
        EndKey(
            enabled = ready && phase == SessionPhase.Running,
            label = when (phase) {
                SessionPhase.Calibrating -> "校准中，不能结束"
                SessionPhase.Stopping -> "正在结束"
                else -> "结束"
            },
            onClick = actions.onEnd
        )
        // The key sits inside the page margin, not on its edge: 24 dp of paper
        // under it so it reads as part of the column and never rides the bar.
        Spacer(Modifier.height(QuietSpace.Page))
    }
}

/**
 * The end: red ink in a hairline box, never a fill. The ice block on this
 * screen belongs to the selected scene; the red block in the bar is the stop.
 */
@Composable
private fun EndKey(enabled: Boolean, label: String, onClick: () -> Unit) {
    ActionKey(
        label = label,
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        tone = ActionTone.Danger,
        enabled = enabled,
        height = 64.dp,
        textStyle = MaterialTheme.typography.titleSmall
    )
}

// ---------------------------------------------------------------------------
// Link state
// ---------------------------------------------------------------------------

/**
 * The link, when it needs saying: a banner above the content, never a dialog.
 * Ice while it is a wait the operator can sit out; red never appears here —
 * red belongs to a deletion.
 */
@Composable
private fun LinkBanners(
    state: ControlUiState,
    event: UiEvent?,
    actions: ControlActions
) {
    val offline = state.phase == BlePhase.DISCONNECTED ||
        state.phase == BlePhase.ERROR ||
        state.phase == BlePhase.IDLE
    val reconnecting = state.reconnectAttempt > 0 &&
        (state.phase == BlePhase.RECONNECTING ||
            state.phase == BlePhase.SCANNING ||
            state.phase == BlePhase.CONNECTING)
    if (!offline && !reconnecting && event == null) {
        return
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = QuietSpace.Page, vertical = 12.dp)
    ) {
        if (reconnecting) {
            BannerRow(
                title = "连接中断",
                body = "第 ${state.reconnectAttempt.coerceAtLeast(1)}/" +
                    "${state.reconnectMax.coerceAtLeast(1)} 次重连。保持头显开机。",
                loading = true,
                actionLabel = "返回配对",
                onAction = actions.onLeave
            )
        } else if (offline) {
            BannerRow(
                title = "头显已断开",
                body = "打开头显应用，再点“重新连接”。",
                actionLabel = "重新连接",
                onAction = actions.onReconnect,
                secondaryLabel = "返回配对",
                onSecondary = actions.onLeave
            )
        }
        if (event != null) {
            Spacer(Modifier.height(8.dp))
            NoticeRow(
                text = OperatorCopy.operatorText(event),
                danger = event is UiEvent.Error
            )
        }
    }
}

@Composable
private fun BannerRow(
    title: String,
    body: String,
    actionLabel: String,
    onAction: () -> Unit,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    loading: Boolean = false
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(QuietPalette.Board)
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .width(8.dp)
                .height(56.dp)
                .background(QuietPalette.Ice)
        )
        Spacer(Modifier.width(16.dp))
        if (loading) {
            LoadingDots(color = QuietPalette.Ink)
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = QuietPalette.Ink)
            Text(
                text = body,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
        }
        Spacer(Modifier.width(16.dp))
        ActionKey(label = actionLabel, onClick = onAction, tone = ActionTone.Secondary)
        if (secondaryLabel != null && onSecondary != null) {
            Spacer(Modifier.width(8.dp))
            ActionKey(label = secondaryLabel, onClick = onSecondary, tone = ActionTone.Quiet)
        }
    }
}
