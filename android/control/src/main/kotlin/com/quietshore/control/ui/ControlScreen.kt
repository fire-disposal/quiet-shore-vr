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
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
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
import com.quietshore.control.ui.components.SessionReadout
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
    Column(modifier.verticalScroll(rememberScrollState())) {
        MirrorSlot(
            state = state,
            phase = phase,
            onModeChange = actions.onMirrorModeChange
        )
        Spacer(Modifier.height(16.dp))
        SessionReadout(state = state, phase = phase)
        Spacer(Modifier.height(28.dp))
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
    // A scene switch is live during training: the page swaps only the content,
    // keeps the calibration frame and the gaze offset, clamps the buoyancy
    // ceiling to the new scene and runs the posture change along the operator's
    // ramp. It is reversible, so it needs no confirmation and no "switching"
    // state of its own. Two windows stay closed because the page refuses there:
    // recording the posture, and the ending fade.
    val scenesEnabled = ready && (phase == SessionPhase.Running ||
        phase == SessionPhase.Idle || phase == SessionPhase.Entry)
    val level = state.control.floatLevel.coerceIn(0, 3)
    val selectedScene = state.sceneIntent.ifEmpty { state.control.scene }

    Column(modifier) {
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
                        for (scene in com.quietshore.control.model.SceneCatalog.ALL) {
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
                    Text(
                        text = when (phase) {
                            SessionPhase.Calibrating -> "校准中，仅急停可用。"
                            SessionPhase.Stopping -> "正在结束，结束后再切换。"
                            else -> "点选后立即切换"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
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
                    Spacer(Modifier.height(10.dp))
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
            SectionHead(
                title = "01 场景",
                note = when (phase) {
                    SessionPhase.Entry -> "切换会重开页面"
                    SessionPhase.Calibrating -> "校准中，暂不可切换"
                    else -> "点选后立即切换，会话中也可换"
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
                            actions.onFloatLevel(
                                if (on) state.caps.floatMax.coerceAtLeast(1) else 0
                            )
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
            // The numbers live in the section headings on the left; this is one
            // chain and it is counted once.
            StepLine("连接头显", if (ready) "已连接" else "未连接", ready)
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
