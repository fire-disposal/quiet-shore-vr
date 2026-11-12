package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.ProgramSegment
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.components.ActionTone
import com.quietshore.control.ui.components.ActionKey
import com.quietshore.control.ui.components.ActionColumnWidth
import com.quietshore.control.ui.components.BarWordKey
import com.quietshore.control.ui.components.CommandBar
import com.quietshore.control.ui.components.ConsoleRail
import com.quietshore.control.ui.components.ConsoleSection
import com.quietshore.control.ui.components.RailRule
import com.quietshore.control.ui.components.DurationRow
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyRow
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.MirrorSlot
import com.quietshore.control.ui.components.NoticeRow
import com.quietshore.control.ui.components.Panel
import com.quietshore.control.ui.components.PostureGauges
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SceneCardView
import com.quietshore.control.ui.components.SceneChooser
import com.quietshore.control.ui.components.SectionHead
import com.quietshore.control.ui.components.Stepper
import com.quietshore.control.ui.components.StepLine
import com.quietshore.control.ui.components.SusSheet
import com.quietshore.control.ui.components.SwitchRow
import com.quietshore.control.ui.components.TouchTarget
import com.quietshore.control.ui.components.VoicePanel
import com.quietshore.control.ui.components.VoiceSummaryRow
import com.quietshore.control.ui.components.clock
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.components.nextVoiceId
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console, as four destinations under one app bar.
 *
 * The bar is the only thing that never moves: state, the two charges, the
 * menu and the stop. Everything else is one of four pages, chosen by what the
 * operator is doing rather than by what fits on a screen:
 *
 * ```text
 *   会话  the patient's picture, the figures, the dials — plus the live
 *         controls (scene, strength, voice, posture) and the end.
 *   场景  the preparation bench: scene, rise length, posture, start.
 *   语音  the full cue panel: sequences, single cues, volume, water, tone.
 *   量表  the scale: answer, archive, export.
 * ```
 *
 * The page the app opens on follows the phase — the bench before a session,
 * the monitor during one — and a hand-picked page wins over that default so a
 * technician reading the scale is not thrown out of it by a session starting.
 */
@Composable
fun ControlScreen(
    state: ControlUiState,
    actions: ControlActions,
    /** Latest one-shot operator message; shown briefly under the bar. */
    event: UiEvent? = null,
    onOpenInfo: () -> Unit = {},
    /** The main area while no headset is claimed: the initial page. */
    initialContent: @Composable () -> Unit = {},
    /** Design review only: open the mirror cover on first composition. */
    startWithMirrorOpen: Boolean = false
) {
    val phase = sessionPhaseOf(
        state.control,
        state.phase,
        state.startPending,
        state.stopRequested
    )
    var chosen by rememberSaveable { mutableStateOf<ConsoleSection?>(null) }
    // Default by phase, but never yank the operator off a page they picked.
    val section = chosen ?: if (phase.inSession) ConsoleSection.Session else ConsoleSection.Scene

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
        // 1000 dp is where a picture and a column of keys both fit at a size
        // worth reading; below it the page becomes one column in the same order.
        val wide = maxWidth >= 1000.dp
        Column(Modifier.fillMaxSize()) {
            CommandBar(
                state = state,
                onOpenInfo = onOpenInfo,
                onAppSelect = actions.onAppSelect,
                onDisconnect = actions.onDisconnect,
                onExitScene = actions.onExitScene,
                onExitSystem = actions.onExitSystem
            )
            // No link banners on the initial page: the device list is the
            // action, and a banner offering "重新连接" beside it is a second
            // way to do the same thing.
            if (state.showControls) {
                LinkBanners(state = state, event = event, actions = actions)
            }

            // 16 dp under the bar: the bar is chrome, close to the page; 32 dp
            // is for block-to-block gaps.
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(top = 16.dp)
            ) {
                val pagePadding = if (wide) {
                    Modifier.padding(horizontal = QuietSpace.Page, vertical = 0.dp)
                } else {
                    Modifier.padding(horizontal = 20.dp)
                }
                if (!state.showControls) {
                    // One frame, one main area: the initial page lives here,
                    // not as a separate screen with its own bar.
                    initialContent()
                    return@Box
                }
                if (state.app == "questionnaire") {
                    QuestionnaireApp(
                        state = state,
                        actions = actions,
                        modifier = Modifier
                            .fillMaxSize()
                            .then(pagePadding)
                            .padding(bottom = 12.dp)
                    )
                    return@Box
                }
                // Navigation on the left, as a rail: a landscape tablet is
                // short on height, and the rail scrolls instead of clipping.
                Row(Modifier.fillMaxSize()) {
                    ConsoleRail(
                        current = section,
                        onSelect = { chosen = it },
                        scaleBadge = susBadge(state)
                    )
                    RailRule()
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .then(pagePadding)
                            .padding(bottom = 12.dp)
                    ) {
                        val back = if (phase.inSession) {
                            ConsoleSection.Session
                        } else {
                            ConsoleSection.Scene
                        }
                        when (section) {
                            ConsoleSection.Session -> SessionPage(
                                state = state,
                                actions = actions,
                                phase = phase,
                                wide = wide,
                                onOpenScene = { chosen = ConsoleSection.Scene },
                                onOpenVoice = { chosen = ConsoleSection.Voice }
                            )
                            ConsoleSection.Scene -> ScenePage(
                                state = state,
                                actions = actions,
                                phase = phase,
                                wide = wide
                            )
                            ConsoleSection.Voice -> PanelPage(
                                title = "语音",
                                note = "患者听到的提示语",
                                onBack = { chosen = back }
                            ) {
                                VoicePanel(state = state, actions = actions)
                            }
                            ConsoleSection.Scale -> PanelPage(
                                title = "量表",
                                note = "训练结束后作答与归档",
                                onBack = { chosen = back }
                            ) {
                                SusSheet(state = state, actions = actions)
                            }
                        }
                    }
                }
            }

        }
    }
}

/**
 * The questionnaire app's main area. The training rail is not shown: its four
 * destinations are training's, and a rail that does nothing is worse than no
 * rail. The shell (top bar) still says which app is running.
 */
@Composable
private fun QuestionnaireApp(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    Column(modifier.verticalScroll(rememberScrollState())) {
        SectionHead(title = "问卷", note = "作答、按次归档与导出")
        Rule()
        Spacer(Modifier.height(12.dp))
        SusSheet(state = state, actions = actions)
        Spacer(Modifier.height(QuietSpace.Page))
    }
}

/** How many scale answers are still missing, when a session has finished. */
private fun susBadge(state: ControlUiState): String? {
    if (state.sessionElapsedMs <= 0L) return null
    val missing = state.susAnswers.count { it == 0 }
    return if (missing in 1..9) "$missing 待答" else null
}

/**
 * The bedside question, asked once after a session that actually ran.
 *
 * Two facts, separately answerable, because "tried and failed" and "did not
 * try" are different clinical results — collapsing them loses the only signal
 * that the therapy is being attempted at all. The answer travels to the page,
 * which owns the ledger.
 */
@Composable
private fun OutcomePrompt(state: ControlUiState, actions: ControlActions) {
    if (state.sessionElapsedMs <= 0L || state.control.session) {
        return
    }
    var answered by remember(state.sessionElapsedMs) { mutableStateOf(false) }
    var attempted by remember(state.sessionElapsedMs) { mutableStateOf<Boolean?>(null) }
    var succeeded by remember(state.sessionElapsedMs) { mutableStateOf<Boolean?>(null) }
    SectionHead(title = "本次结果", note = "取下头显后记录")
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "在床上排尿",
                        style = MaterialTheme.typography.titleSmall,
                        color = QuietPalette.Ink
                    )
                    Text(
                        text = when {
                            succeeded == true -> "已记录：成功"
                            attempted == false -> "已记录：没有尝试"
                            attempted == true -> "已记录：尝试了"
                            else -> "患者取下头显后，按实际回答"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.InkSecondary
                    )
                }
                BarWordKey(
                    label = "试了",
                    onClick = {
                        attempted = true
                        answered = true
                        actions.onOutcome("attempt", true)
                    },
                    enabled = !answered
                )
                Spacer(Modifier.width(12.dp))
                BarWordKey(
                    label = "没试",
                    onClick = {
                        attempted = false
                        answered = true
                        actions.onOutcome("attempt", false)
                    },
                    enabled = !answered
                )
            }
            if (attempted == true) {
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "是否成功",
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.InkSecondary,
                        modifier = Modifier.weight(1f)
                    )
                    BarWordKey(
                        label = "成功",
                        onClick = {
                            succeeded = true
                            actions.onOutcome("success", true)
                        },
                        enabled = succeeded != true
                    )
                    Spacer(Modifier.width(12.dp))
                    BarWordKey(
                        label = "未成功",
                        onClick = {
                            succeeded = false
                            actions.onOutcome("success", false)
                        },
                        enabled = succeeded == null
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

@Composable
private fun SessionPage(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    wide: Boolean,
    onOpenScene: () -> Unit,
    onOpenVoice: () -> Unit
) {
    if (!wide) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
        ) {
            SessionMain(state = state, actions = actions, phase = phase)
            SessionColumn(
                state = state,
                actions = actions,
                phase = phase,
                fill = false,
                onOpenScene = onOpenScene,
                onOpenVoice = onOpenVoice
            )
            Spacer(Modifier.height(QuietSpace.Page))
        }
        return
    }
    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section)
    ) {
        Box(Modifier.weight(1f).fillMaxHeight()) {
            SessionMain(state = state, actions = actions, phase = phase)
        }
        SessionColumn(
            state = state,
            actions = actions,
            phase = phase,
            fill = true,
            modifier = Modifier.width(ActionColumnWidth).fillMaxHeight(),
            onOpenScene = onOpenScene,
            onOpenVoice = onOpenVoice
        )
    }
}

/** Left half: picture, figures, dials. Everything here is read, not pressed. */
@Composable
private fun SessionMain(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier
) {
    // The picture is the app surface; the gauges are a footnote. The mirror
    // takes whatever height is left after them, instead of a fixed block with
    // empty paper under it.
    Column(modifier) {
        MirrorSlot(
            state = state,
            phase = phase,
            onModeChange = actions.onMirrorModeChange,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.height(24.dp))
        SectionHead(title = "患者当前姿态", note = "只读")
        Rule()
        PostureGauges(state = state)
        Spacer(Modifier.height(QuietSpace.Page))
    }
}

/**
 * Right column: the four things that are live during a session, in the order
 * the hand reaches for them, then the two corrections and the end.
 */
@Composable
private fun SessionColumn(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    fill: Boolean,
    modifier: Modifier = Modifier,
    onOpenScene: () -> Unit,
    onOpenVoice: () -> Unit
) {
    val ready = state.phase == BlePhase.READY
    // The real scene list unlocks only once the patient is inside XR and the
    // posture has been recorded: the preparation room is the first surface,
    // and entering a real scene is the deliberate second step. After that a
    // switch is live during training — the page swaps content under the kept
    // calibration frame — so it needs no confirmation, only the apply key.
    val scenesEnabled = ready && phase == SessionPhase.Running
    val level = state.control.floatLevel.coerceIn(0, 3)
    val selectedScene = state.sceneIntent.ifEmpty { state.control.scene }
    val selectedName = state.selectableScenes
        .firstOrNull { it.id == state.sceneIntent }
        ?.name

    Column(modifier) {
        // The band is status, not a control page: it stays outside the scroller
        // so the remaining time never leaves the screen mid-session.
        if (phase == SessionPhase.Running || state.segmentProgress != null) {
            SegmentBand(
                state = state,
                actions = actions,
                enabled = scenesEnabled
            )
        }
        Column(
            Modifier.then(
                if (fill) {
                    Modifier.weight(1f).verticalScroll(rememberScrollState())
                } else {
                    Modifier
                }
            )
        ) {
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "场景",
                        style = MaterialTheme.typography.labelMedium,
                        color = QuietPalette.InkSecondary
                    )
                    Spacer(Modifier.height(8.dp))
                    // One row of four names: the descriptions and the rise
                    // length live on the scene page, and the tab bar reaches
                    // it. A second entry point here costs height the four
                    // live blocks below need.
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (scene in state.selectableScenes) {
                            SceneCardView(
                                scene = scene,
                                current = scene.id == selectedScene,
                                enabled = scenesEnabled,
                                onSelect = actions.onSceneSelect,
                                modifier = Modifier.weight(1f),
                                showBlurb = false
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    // Status and the one deliberate action share a line: more
                    // controls must cost width here, not height in the app.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = when {
                                phase == SessionPhase.Calibrating -> "标定中，完成后解锁场景。"
                                phase == SessionPhase.Stopping -> "正在结束，结束后再切换。"
                                phase != SessionPhase.Running -> "进入 VR 并完成标定后可选场景。"
                                selectedName != null -> "已选「$selectedName」"
                                state.inSpecialScene -> "准备间中：选择一个正式场景。"
                                else -> "选中后点右侧切换。"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(Modifier.width(8.dp))
                        Key(
                            label = when {
                                state.program.segments.isNotEmpty() ->
                                    if (state.inSpecialScene) "开始流程" else "重启流程"
                                state.inSpecialScene -> "进入正式场景"
                                else -> "切换场景"
                            },
                            onClick = actions.onSceneApply,
                            enabled = scenesEnabled && (
                                state.program.segments.isNotEmpty() || state.sceneIntentDiverges
                                ),
                            height = TouchTarget
                        )
                    }
                }
                Rule()
                Row(
                    modifier = Modifier.padding(16.dp),
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
                        canIncrement = ready && phase.acceptsChanges &&
                            level < state.caps.floatMax,
                        onDecrement = { actions.onFloatLevel(level - 1) },
                        onIncrement = { actions.onFloatLevel(level + 1) }
                    )
                }
                Rule()
                Row(
                    modifier = Modifier.padding(16.dp),
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
                    // Calibration measures where the body is: the caption says
                    // only the stop works, so every voice key refuses there.
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
                }
                Rule()
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "体位",
                        style = MaterialTheme.typography.titleSmall,
                        color = QuietPalette.Ink
                    )
                    Spacer(Modifier.height(8.dp))
                    // The duration is part of the manual rise, not a setup
                    // screen: it is chosen where the operator's hand is when
                    // they decide to raise the patient.
                    RiseDurationRow(
                        selectedMs = state.animDurationMs,
                        enabled = ready && state.caps.rise,
                        onSelect = actions.onAnimDuration
                    )
                    Spacer(Modifier.height(12.dp))
                    // Recording the posture freezes every motion channel: the
                    // page is measuring where the body is, so moving it would
                    // record the movement instead. Only the stop stays live.
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
        // Corrections stay reachable without hunting: outside the scroller,
        // directly above the end.
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
        Spacer(Modifier.height(QuietSpace.Page))
    }
}

/**
 * The rise length, next to the key that starts the rise. Both the bench and
 * the live posture block use it, so the choice always sits where the manual
 * action is, never on a separate setup screen.
 */
@Composable
private fun RiseDurationRow(
    selectedMs: Int,
    enabled: Boolean,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier.fillMaxWidth()) {
        Text(
            text = "起身时长",
            style = MaterialTheme.typography.labelMedium,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.height(8.dp))
        DurationRow(selected = selectedMs, enabled = enabled, onSelect = onSelect)
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
// 流程（段编排）
// ---------------------------------------------------------------------------

/** Scene name from the live catalogue, falling back to the built-in table. */
private fun sceneName(state: ControlUiState, id: String): String =
    state.scenes.firstOrNull { it.id == id }?.name
        ?: com.quietshore.control.model.SceneCatalog.scene(id)?.name
        ?: id

private fun durationLabel(seconds: Int): String =
    if (seconds <= 0) "不限时" else "${seconds / 60} 分"

private fun voiceLabel(voice: String): String = when (voice) {
    "start" -> "开场"
    "imagine" -> "想象"
    "relax" -> "放松"
    "close" -> "结束"
    else -> "无语音"
}

private fun capLabel(cap: Int): String =
    if (cap <= 0) "默认" else "$cap 级"

/**
 * The always-on band: which segment of how many, where, and how long is left.
 * The page is the clock; the tablet is a mirror of it.
 */
@Composable
private fun SegmentBand(
    state: ControlUiState,
    actions: ControlActions,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    val progress = state.segmentProgress ?: return
    val name = sceneName(state, progress.scene)
    val remaining = progress.remainingSec
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = buildString {
                append("第 ${progress.index}/${progress.total} 段 · ")
                append(name)
                append(" · ")
                append(if (remaining == null) "不限时" else "还剩 ${clock(remaining * 1000L)}")
                if (progress.total > 1) {
                    append(if (progress.auto) " · 自动" else " · 手动")
                }
            },
            style = MaterialTheme.typography.bodySmall.tabularFigures(),
            color = QuietPalette.InkSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(8.dp))
        Key(
            label = "下一段",
            onClick = actions.onNextSegment,
            enabled = enabled && progress.index < progress.total,
            height = TouchTarget
        )
    }
    Spacer(Modifier.height(8.dp))
    Rule()
}

/** One editable segment: scene, length, cue and strength ceiling, all cycled. */
@Composable
private fun ProgramRow(
    index: Int,
    segment: ProgramSegment,
    state: ControlUiState,
    actions: ControlActions,
    enabled: Boolean
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "${index + 1}",
            style = MaterialTheme.typography.bodySmall.tabularFigures(),
            color = QuietPalette.InkSecondary
        )
        Key(
            label = sceneName(state, segment.scene),
            onClick = { actions.onProgramScene(index) },
            enabled = enabled,
            height = 44.dp,
            modifier = Modifier.weight(1.5f)
        )
        Key(
            label = durationLabel(segment.seconds),
            onClick = { actions.onProgramDuration(index) },
            enabled = enabled,
            height = 44.dp,
            modifier = Modifier.weight(0.8f)
        )
        Key(
            label = voiceLabel(segment.voice),
            onClick = { actions.onProgramVoice(index) },
            enabled = enabled,
            height = 44.dp,
            modifier = Modifier.weight(0.8f)
        )
        Key(
            label = capLabel(segment.cap),
            onClick = { actions.onProgramCap(index) },
            enabled = enabled,
            height = 44.dp,
            modifier = Modifier.weight(0.7f)
        )
        Key(
            label = "删",
            onClick = { actions.onProgramRemove(index) },
            enabled = enabled,
            height = 44.dp,
            modifier = Modifier.weight(0.5f)
        )
    }
}

/**
 * The plan editor. An empty plan is the one open-ended segment the page already
 * runs; pressing 增加 materialises both that segment and a second one, so the
 * default single-segment session never pays for an editor it did not use.
 */
@Composable
private fun ProgramEditor(
    state: ControlUiState,
    actions: ControlActions,
    enabled: Boolean
) {
    val segments = state.program.segments
    SectionHead(
        title = "02 流程",
        note = if (segments.isEmpty()) "默认单段：按当前场景，手动结束" else "${segments.size} 段，按顺序执行"
    )
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            if (segments.isEmpty()) {
                val sceneId = state.sceneIntent.ifEmpty { state.control.scene }
                Text(
                    text = "第 1 段 · ${sceneName(state, sceneId)} · 不限时",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.Ink
                )
            } else {
                segments.forEachIndexed { index, segment ->
                    ProgramRow(index, segment, state, actions, enabled)
                    if (index != segments.lastIndex) {
                        Rule()
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Key(
                    label = "＋ 增加一段",
                    onClick = actions.onProgramAdd,
                    enabled = enabled && (segments.isEmpty() || segments.size < 8),
                    height = TouchTarget
                )
                Key(
                    label = "自动推进 ${if (state.program.auto) "开" else "关"}",
                    onClick = { actions.onProgramAuto(!state.program.auto) },
                    enabled = enabled,
                    height = TouchTarget
                )
                Spacer(Modifier.weight(1f))
                if (segments.isNotEmpty()) {
                    Text(
                        text = "点任一段的参数可循环",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

@Composable
private fun ScenePage(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    wide: Boolean
) {
    val ready = state.phase == BlePhase.READY
    // The list unlocks only inside XR after the posture is recorded; before
    // that the preparation room is the whole app surface.
    val scenesEnabled = ready && phase == SessionPhase.Running
    val selectedName = state.selectableScenes
        .firstOrNull { it.id == state.sceneIntent }
        ?.name
    val left = @Composable { modifier: Modifier ->
        Box(modifier) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            StartBlock(
                state = state,
                actions = actions,
                phase = phase
            )
            Spacer(Modifier.height(QuietSpace.Section))
            // The question comes first: it is about the session that just
            // ended, and the bench below is about the next one.
            OutcomePrompt(state = state, actions = actions)
            Spacer(Modifier.height(QuietSpace.Section))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom
            ) {
                SectionHead(
                    title = "01 场景",
                    note = when {
                        phase == SessionPhase.Calibrating -> "标定完成后解锁"
                        phase == SessionPhase.Stopping -> "正在结束"
                        !scenesEnabled -> "进入 VR 后解锁"
                        selectedName != null -> "已选「$selectedName」"
                        state.inSpecialScene -> "准备间中"
                        else -> "选中后切换"
                    },
                    modifier = Modifier.weight(1f)
                )
                // One key next to the header: the extra control costs width,
                // not a new row in the app's main area.
                Key(
                    label = when {
                        state.program.segments.isNotEmpty() ->
                            if (state.inSpecialScene) "开始流程" else "重启流程"
                        state.inSpecialScene -> "进入正式场景"
                        else -> "切换场景"
                    },
                    onClick = actions.onSceneApply,
                    enabled = scenesEnabled && (
                        state.program.segments.isNotEmpty() || state.sceneIntentDiverges
                        ),
                    height = TouchTarget,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
            }
            SceneChooser(
                current = state.sceneIntent.ifEmpty { state.control.scene },
                enabled = scenesEnabled,
                onSelect = actions.onSceneSelect,
                playing = state.control.scene,
                scenes = state.selectableScenes
            )
            Spacer(Modifier.height(QuietSpace.Section))
            ProgramEditor(
                state = state,
                actions = actions,
                enabled = ready &&
                    phase != SessionPhase.Calibrating &&
                    phase != SessionPhase.Stopping
            )
            Spacer(Modifier.height(QuietSpace.Section))
            SectionHead(title = "体位与起伏", note = "时长随起身选择，会话中也可调整")
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(QuietSpace.Panel)) {
                    SwitchRow(
                        title = "竖直起伏",
                        checked = state.control.floatLevel > 0,
                        onCheckedChange = { on ->
                            actions.onFloatLevel(
                                if (on) state.caps.floatMax.coerceAtLeast(1) else 0
                            )
                        },
                        enabled = ready && state.caps.float,
                        note = "画面缓慢升降，视野随之移动。"
                    )
                    Rule()
                    RiseDurationRow(
                        selectedMs = state.animDurationMs,
                        enabled = ready,
                        onSelect = actions.onAnimDuration,
                        modifier = Modifier.padding(top = 16.dp)
                    )
                    KeyRow(Modifier.padding(top = 12.dp)) {
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
            SectionHead(title = "语音", note = "患者听到的提示语")
            VoiceSummaryRow(
                state = state,
                onOpenVoice = actions.onVoiceOpen,
                enabled = ready
            )
            Spacer(Modifier.height(QuietSpace.Page))
        }
            // A block cut at the fold reads as a broken layout; the fade reads
            // as "there is more".
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(36.dp)
                    .background(
                        Brush.verticalGradient(
                            listOf(QuietPalette.Paper.copy(alpha = 0f), QuietPalette.Paper)
                        )
                    )
            )
        }
    }
    val right = @Composable { modifier: Modifier ->
        StandbySteps(
            state = state,
            actions = actions,
            phase = phase,
            modifier = modifier
        )
    }
    TwoColumns(wide = wide, left = left, right = right)
}

/**
 * The one action the scene page is about, at the top: before a session, 启动
 * is the decision the whole page exists to support.
 */
@Composable
private fun StartBlock(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase
) {
    val ready = state.phase == BlePhase.READY
    Panel(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(QuietSpace.Panel),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = when (phase) {
                        SessionPhase.Entry -> "已启动，等待按压"
                        SessionPhase.Calibrating -> "校准中"
                        SessionPhase.Running, SessionPhase.Stopping -> "训练中"
                        else -> "准备本次训练"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = if (!ready) {
                        "头显未连接。返回配对页重连。"
                    } else if (phase == SessionPhase.Entry) {
                        "已过 ${clock(state.sessionElapsedMs)}。20 秒未按将重开页面。"
                    } else if (phase.inSession) {
                        "会话在会话页调整。"
                    } else {
                        "患者确认后开始训练。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary
                )
            }
            Spacer(Modifier.width(24.dp))
            // The start key lives once, at the foot of the chain on the right:
            // two identical ice blocks would be two primaries on one page.
            if (phase == SessionPhase.Entry) {
                LoadingDots(color = QuietPalette.Ink)
            }
        }
    }
}

/**
 * Right: the four steps as a chain, with the start key as its foot. The
 * numbers are the order of the procedure, the same 01–04 the guide walks.
 */
@Composable
private fun StandbySteps(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier
) {
    val ready = state.phase == BlePhase.READY
    val live = phase == SessionPhase.Running || phase == SessionPhase.Stopping
    Panel(modifier) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            Text(
                text = "准备",
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "启动后，患者按一次；先进入准备间。",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            Spacer(Modifier.height(24.dp))
            // The chain follows the room the patient is actually in: the
            // start key is not the scene choice any more, and the scene list
            // is not a pre-session step.
            StepLine("连接头显", if (ready) "已连接" else "未连接", ready)
            Spacer(Modifier.height(16.dp))
            StepLine(
                "启动训练",
                when (phase) {
                    SessionPhase.Entry -> "等待患者按压"
                    SessionPhase.Calibrating -> "准备间 · 记录中"
                    SessionPhase.Running -> "已在准备间"
                    else -> "按后进入准备间"
                },
                phase != SessionPhase.Idle
            )
            Spacer(Modifier.height(16.dp))
            StepLine(
                "记录起始体位",
                when {
                    phase == SessionPhase.Calibrating -> "进行中"
                    live && !state.inSpecialScene -> "已记录"
                    live && state.inSpecialScene -> "待技术员"
                    else -> "启动后"
                },
                phase == SessionPhase.Calibrating || (live && !state.inSpecialScene)
            )
            Spacer(Modifier.height(16.dp))
            StepLine(
                "进入正式场景",
                when {
                    live && !state.inSpecialScene -> "已进入"
                    phase == SessionPhase.Running -> "标定后可选"
                    else -> "标定后解锁"
                },
                live && !state.inSpecialScene
            )
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
                text = if (!ready) {
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
                    BarWordKey(
                        label = "打开量表",
                        onClick = actions.onSusOpen,
                        enabled = ready
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 语音 / 量表
// ---------------------------------------------------------------------------

/** A whole panel as its own page: heading, hairline, then the panel itself. */
@Composable
private fun PanelPage(
    title: String,
    note: String,
    onBack: () -> Unit,
    content: @Composable () -> Unit
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            SectionHead(title = title, note = note, modifier = Modifier.weight(1f))
            BarWordKey(label = "返回控制台", onClick = onBack)
        }
        Rule()
        Spacer(Modifier.height(QuietSpace.Section))
        content()
        Spacer(Modifier.height(QuietSpace.Page))
    }
}

// ---------------------------------------------------------------------------
// Shared page shapes
// ---------------------------------------------------------------------------

/**
 * Two columns on a wide screen, one stacked column below 1000 dp. The stacked
 * version relies on the *caller's* scroller for the two halves not to nest
 * their own: two vertical scrollers inside one another is a crash in Compose,
 * not a layout choice.
 */
@Composable
private fun TwoColumns(
    wide: Boolean,
    left: @Composable (Modifier) -> Unit,
    right: @Composable (Modifier) -> Unit
) {
    if (wide) {
        Row(
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section)
        ) {
            left(Modifier.weight(1f).fillMaxHeight())
            // The action column scrolls when the window is short: its last
            // block used to be cut off under the system bar.
            right(
                Modifier
                    .width(ActionColumnWidth)
                    .fillMaxHeight()
            )
        }
    } else {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
        ) {
            left(Modifier)
            right(Modifier)
            Spacer(Modifier.height(QuietSpace.Page))
        }
    }
}

// ---------------------------------------------------------------------------
// Link state
// ---------------------------------------------------------------------------

/**
 * The link, when it needs saying: a banner above the content, never a dialog.
 * Red never appears here — red belongs to the stop.
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
