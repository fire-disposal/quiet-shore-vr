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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.components.ActionTone
import com.quietshore.control.ui.components.ActionKey
import com.quietshore.control.ui.components.ActionColumnWidth
import com.quietshore.control.ui.components.BarWordKey
import com.quietshore.control.ui.components.CalibrationKey
import com.quietshore.control.ui.components.calibrationView
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
import com.quietshore.control.ui.components.RailWidth
import com.quietshore.control.ui.components.QuestionnaireRail
import com.quietshore.control.ui.components.QuestionnaireSection
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SceneCardView
import com.quietshore.control.ui.components.SceneChooser
import com.quietshore.control.ui.components.SectionHead
import com.quietshore.control.ui.components.Stepper
import com.quietshore.control.ui.components.StepLine
import com.quietshore.control.ui.components.SusSheet
import com.quietshore.control.ui.components.SwitchRow
import com.quietshore.control.ui.components.TouchTarget
import com.quietshore.control.ui.components.AudioPanel
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
 *
 * The questionnaire (SUS) is its own application face; it is not a training
 * destination, so the training rail has three tabs.
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

    val bottomInset = WindowInsets.tappableElement.asPaddingValues().calculateBottomPadding()
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Paper)
            // The rail is chrome down to the bottom edge; only its interior
            // keeps the same 16 dp gap at the top and bottom. The system
            // taskbar inset is outside the content, so the rail background is
            // carried through it explicitly.
            .drawBehind {
                // The rail is a full-height chrome surface. The page content
                // stops above the system inset and its own bottom padding, so
                // carrying only the inset left a detached white patch; this
                // draws the whole left column behind whatever the rail frame
                // happens to measure, and stops at the same 16 dp bottom gap.
                drawRect(
                    color = QuietPalette.Board,
                    topLeft = Offset.Zero,
                    size = Size(RailWidth.toPx(), size.height - 16.dp.toPx())
                )
            }
            .safeDrawingPadding()
            // Same fix the guide page needed: `tappableElement` (the system
            // taskbar's tappable band) is not in safeDrawing, so the last rows
            // could render underneath it.
            .padding(bottom = bottomInset)
    ) {
        // 1000 dp is where a picture and a column of keys both fit at a size
        // worth reading; below it the page becomes one column in the same order.
        val wide = maxWidth >= 1000.dp
        Column(Modifier.fillMaxSize()) {
            CommandBar(
                state = state,
                onOpenInfo = onOpenInfo,
                onAppSelect = actions.onAppSelect,
                onDisconnect = actions.onDisconnect
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
                        modifier = Modifier.fillMaxSize()
                    )
                    return@Box
                }
                // Navigation on the left, as a rail: a landscape tablet is
                // short on height, and the rail scrolls instead of clipping.
                Row(Modifier.fillMaxSize()) {
                    ConsoleRail(
                        current = section,
                        onSelect = { chosen = it }
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
                                wide = wide
                            )
                            ConsoleSection.Scene -> ScenePage(
                                state = state,
                                actions = actions,
                                phase = phase,
                                wide = wide
                            )
                            ConsoleSection.Audio -> PanelPage(
                                title = "音频",
                                note = "提示语与水声，都在这一页",
                                onBack = { chosen = back }
                            ) {
                                AudioPanel(state = state, actions = actions)
                            }

                        }
                    }
                }
            }

        }
    }
}

/**
 * The questionnaire app's main area.
 *
 * Two jobs, one rail: answer the loaded instrument, or work the archive. The
 * split is the skeleton for the multi-instrument version: the answer page owns
 * the current questionnaire and its switching point, the archive page owns the
 * cross-instrument record set. The shell (top bar) still says which app runs.
 */
@Composable
private fun QuestionnaireApp(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    var section by rememberSaveable { mutableStateOf(QuestionnaireSection.Answer) }
    Row(modifier.fillMaxSize()) {
        QuestionnaireRail(
            current = section,
            onSelect = { section = it },
            modifier = Modifier.fillMaxHeight()
        )
        RailRule()
        // The rail is chrome and reaches the page edge exactly like the
        // guidance app's rail; only the content takes the page gutter.
        Box(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(
                    start = QuietSpace.Page,
                    end = QuietSpace.Page,
                    bottom = 12.dp
                )
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
            ) {
                when (section) {
                    QuestionnaireSection.Answer -> {
                        SectionHead(
                            title = "作答",
                            note = "逐题作答；答完最后一题即归档"
                        )
                        Rule()
                        Spacer(Modifier.height(12.dp))
                        SusSheet(
                            state = state,
                            actions = actions,
                            showArchive = false
                        )
                    }
                    QuestionnaireSection.Archive -> {
                        SectionHead(
                            title = "归档",
                            note = "按问卷与时间筛选，导出"
                        )
                        Rule()
                        Spacer(Modifier.height(12.dp))
                        SusSheet(
                            state = state,
                            actions = actions,
                            showAnswer = false
                        )
                    }
                }
                Spacer(Modifier.height(QuietSpace.Page))
            }
        }
    }
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
    wide: Boolean
) {
    if (!wide) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
        ) {
            SessionMain(state = state, actions = actions, phase = phase)
            SessionColumn(state = state, actions = actions, phase = phase, fill = false)
            Spacer(Modifier.height(QuietSpace.Page))
        }
        return
    }
    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section)
    ) {
        // The picture is the product; it takes every pixel the controls do not
        // need, and the controls are sized to what a hand reaches for.
        Box(Modifier.weight(1f).fillMaxHeight()) {
            SessionMain(state = state, actions = actions, phase = phase)
        }
        SessionColumn(
            state = state,
            actions = actions,
            phase = phase,
            fill = true,
            modifier = Modifier.width(ActionColumnWidth).fillMaxHeight()
        )
    }
}

/**
 * The patient's picture, and one line of facts under it.
 *
 * Everything here is read, not pressed. The four facts are the ones an
 * operator glances at while talking to the patient; each used to have its own
 * drawing (a dial, a side elevation, a slider), which is three pictures of one
 * number and three places to look away from the person.
 */
@Composable
private fun SessionMain(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier
) {
    Column(modifier) {
        MirrorSlot(
            state = state,
            phase = phase,
            onModeChange = actions.onMirrorModeChange,
            modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.height(16.dp))
        Rule()
        SessionReadout(state = state)
    }
}

/** Scene name from the live catalogue, falling back to the built-in table. */
private fun sceneName(state: ControlUiState, id: String): String =
    state.scenes.firstOrNull { it.id == id }?.name
        ?: com.quietshore.control.model.SceneCatalog.scene(id)?.name
        ?: id

/** One row, one baseline: elapsed, scene, buoyancy, head angles. */
@Composable
private fun SessionReadout(state: ControlUiState) {
    val stale = state.poseStale || state.pose == null
    val facts = buildList {
        add("已运行" to clock(state.sessionElapsedMs))
        add("场景" to sceneName(state, state.control.scene))
        add("起伏" to "${state.control.floatMm.toInt()} mm")
        // The wire carries radians; every screen prints degrees.
        val deg = 180.0 / Math.PI
        add("偏航" to if (stale) "—" else "${(state.pose!!.yaw * deg).toInt()}°")
        add("俯仰" to if (stale) "—" else "${(state.pose!!.pitch * deg).toInt()}°")
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        for ((label, value) in facts) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.InkSecondary,
                    modifier = Modifier.padding(bottom = 3.dp)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = value,
                    style = MaterialTheme.typography.titleMedium.tabularFigures(),
                    color = QuietPalette.Ink,
                    maxLines = 1
                )
            }
        }
        Spacer(Modifier.weight(1f))
    }
}

/**
 * Right column: what the hand reaches for during a session.
 *
 * Three blocks in the order the bedside asks for them — which room, how much
 * motion, where the body is — then the two corrections pinned at the foot. The
 * blocks size themselves and the column scrolls, so a short window loses the
 * end of a block instead of clipping a key.
 */
@Composable
private fun SessionColumn(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    fill: Boolean,
    modifier: Modifier = Modifier
) {
    val ready = state.phase == BlePhase.READY
    val scenesEnabled = ready && phase == SessionPhase.Running
    val level = state.control.floatLevel.coerceIn(0, 3)
    val calibration = calibrationView(state, phase, ready)
    val selectedScene = state.sceneIntent.ifEmpty { state.control.scene }
    val selectedName = state.selectableScenes
        .firstOrNull { it.id == state.sceneIntent }
        ?.name

    Column(modifier) {
        Column(
            Modifier.then(
                if (fill) {
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                } else {
                    Modifier.fillMaxWidth()
                }
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "场景",
                            style = MaterialTheme.typography.labelMedium,
                            color = QuietPalette.InkSecondary,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = selectedName ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary,
                            maxLines = 1
                        )
                    }
                    Spacer(Modifier.height(8.dp))
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
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = when {
                                phase == SessionPhase.Calibrating -> calibration.unlockNote
                                phase != SessionPhase.Running -> calibration.unlockNote
                                state.inSpecialScene -> "准备间中：选择一个正式场景。"
                                selectedName != null -> "已选「$selectedName」"
                                else -> "点一张卡选择场景。"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(Modifier.width(8.dp))
                        Key(
                            label = if (state.inSpecialScene) "进入正式场景" else "切换场景",
                            onClick = actions.onSceneApply,
                            enabled = scenesEnabled && state.sceneIntentDiverges,
                            height = TouchTarget
                        )
                    }
                }
            }

            Panel(Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = "强度",
                            style = MaterialTheme.typography.labelMedium,
                            color = QuietPalette.InkSecondary
                        )
                        Text(
                            text = when {
                                level == 0 -> "已关闭"
                                else -> "上限 ${state.caps.floatMax} 级"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary
                        )
                    }
                    Stepper(
                        value = if (level == 0) "关" else "$level",
                        description = if (level == 0) "起伏已关闭" else "强度 $level 级",
                        canDecrement = ready && phase.acceptsChanges && level > 0,
                        canIncrement = ready && phase.acceptsChanges &&
                            level < state.caps.floatMax,
                        onDecrement = { actions.onFloatLevel(level - 1) },
                        onIncrement = { actions.onFloatLevel(level + 1) }
                    )
                }
            }

            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        text = "体位",
                        style = MaterialTheme.typography.titleSmall,
                        color = QuietPalette.Ink
                    )
                    Spacer(Modifier.height(8.dp))
                    // The duration is part of the manual rise: it sits where the
                    // hand is when the operator decides to raise the patient.
                    RiseDurationRow(
                        selectedMs = state.rampMs,
                        enabled = ready && state.caps.rise,
                        onSelect = actions.onAnimDuration
                    )
                    Spacer(Modifier.height(12.dp))
                    // A disabled key that says nothing sends the operator
                    // hunting for a fault. The page already knows why: it is
                    // the same `blocked` reason it gates its own commands on.
                    if (state.caps.blocked.isNotEmpty()) {
                        Text(
                            text = state.caps.blocked,
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
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
                            label = "保持",
                            onClick = actions.onPostureStop,
                            modifier = Modifier.weight(1f),
                            enabled = ready && state.caps.stop && phase.acceptsChanges
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CalibrationKey(
                view = calibration,
                onClick = actions.onRecalibrate,
                height = 56.dp,
                modifier = Modifier.weight(0.62f)
            )
            EndKey(
                enabled = ready && phase != SessionPhase.Stopping,
                label = when (phase) {
                    SessionPhase.Stopping -> "正在结束"
                    else -> "结束"
                },
                onClick = actions.onEnd,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

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
private fun EndKey(
    enabled: Boolean,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth()
) {
    ActionKey(
        label = label,
        onClick = onClick,
        modifier = modifier,
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
    // The list unlocks only inside XR after the posture is recorded; before
    // that the preparation room is the whole app surface.
    val scenesEnabled = ready && phase == SessionPhase.Running
    val calibration = calibrationView(state, phase, ready)
    val selectedName = state.selectableScenes
        .firstOrNull { it.id == state.sceneIntent }
        ?.name
    val left = @Composable { modifier: Modifier ->
        // No scroller here: the cards take a weight, and a scrollable column
        // gives its children unbounded height, which silently turned the
        // largest target on the page back into a strip.
        Column(modifier) {
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
                        selectedName != null -> "已选「$selectedName」"
                        state.inSpecialScene -> calibration.unlockNote
                        else -> calibration.unlockNote
                    },
                    modifier = Modifier.weight(1f)
                )
                // One key next to the header: the extra control costs width,
                // not a new row in the app's main area.
                Key(
                    label = if (state.inSpecialScene) "进入正式场景" else "切换场景",
                    onClick = actions.onSceneApply,
                    enabled = scenesEnabled && state.sceneIntentDiverges,
                    height = TouchTarget,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
            }
            // The choice is the page: the cards take every pixel the header
            // leaves, so a ten-inch tablet is a large target rather than three
            // small ones over a field of empty paper.
            SceneChooser(
                current = state.sceneIntent.ifEmpty { state.control.scene },
                enabled = scenesEnabled,
                onSelect = actions.onSceneSelect,
                playing = state.control.scene,
                scenes = state.selectableScenes,
                fillHeight = true,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.height(QuietSpace.Page))
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
    val calibration = calibrationView(state, phase, ready)
    // A status line, not another board: the page already has one white work
    // surface on the right, and this line is where the whole page begins.
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = calibration.headline,
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.width(16.dp))
            Text(
                text = if (phase == SessionPhase.Entry) {
                    "已过 ${clock(state.sessionElapsedMs)}。20 秒未按将重开页面。"
                } else {
                    calibration.hint
                },
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(16.dp))
            // The start key lives once, at the foot of the chain on the right:
            // two identical ice blocks would be two primaries on one page.
            if (phase == SessionPhase.Entry) {
                LoadingDots(color = QuietPalette.Ink)
            }
        }
        Rule()
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
    val calibration = calibrationView(state, phase, ready)
    Panel(modifier) {
        Column(Modifier.fillMaxSize().padding(QuietSpace.Panel)) {
            Text(
                text = "准备",
                style = MaterialTheme.typography.titleLarge,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "患者按一次确认键，进入准备间。",
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
                    SessionPhase.Calibrating -> "准备间，记录中"
                    SessionPhase.Running -> "已在准备间"
                    else -> "未启动"
                },
                phase != SessionPhase.Idle
            )
            Spacer(Modifier.height(16.dp))
            StepLine(
                "记录起始体位",
                calibration.stepValue,
                calibration.stepDone
            )
            Spacer(Modifier.height(16.dp))
            StepLine(
                "进入正式场景",
                when {
                    live && !state.inSpecialScene -> "已进入"
                    phase == SessionPhase.Running -> "已标定"
                    else -> "标定未完成"
                },
                live && !state.inSpecialScene
            )
            // The chain sits at the top, the one key at the foot: the panel is
            // the height of the column, so the target is where the thumb is.
            Spacer(Modifier.weight(1f))
            ActionKey(
                label = when (phase) {
                    SessionPhase.Entry -> "等待确认"
                    SessionPhase.Calibrating -> calibration.headline
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
                text = calibration.hint,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            if (phase == SessionPhase.Idle && state.sessionElapsedMs > 0L) {
                // The session that just ended is recorded; the scale is a
                // separate application face and is not offered from training.
                Spacer(Modifier.height(16.dp))
                Rule()
                Text(
                    text = "上一轮已记录。量表在「问卷」应用内。",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary,
                    modifier = Modifier.padding(top = 8.dp)
                )
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
