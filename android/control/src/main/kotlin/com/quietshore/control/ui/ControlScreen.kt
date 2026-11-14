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
import androidx.compose.foundation.layout.heightIn
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
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.OutcomeReceipt
import com.quietshore.control.model.PREPARATION_SCENE
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.UiEvent
import com.quietshore.control.model.outcomePanelVisible
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
import com.quietshore.control.ui.components.PitchReadout
import com.quietshore.control.ui.components.PostureMixBar
import com.quietshore.control.ui.components.RampField
import com.quietshore.control.ui.components.HeaveBar
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.LevelBar
import com.quietshore.control.ui.components.KeyKind
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
import com.quietshore.control.ui.components.SceneIndex
import com.quietshore.control.ui.components.SectionHead
import com.quietshore.control.ui.components.Stepper
import com.quietshore.control.ui.components.StepLine
import com.quietshore.control.ui.components.SusSheet
import com.quietshore.control.ui.components.SwitchRow
import com.quietshore.control.ui.components.TouchTarget
import com.quietshore.control.ui.components.AudioPanel
import com.quietshore.control.ui.components.ExperiencePanel
import com.quietshore.control.ui.components.clock
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.components.nextVoiceId
import com.quietshore.control.ui.theme.QuietPalette
import kotlin.math.roundToInt
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console, as four destinations under one app bar.
 *
 * The bar is the only thing that never moves: state, the two charges, the
 * menu and the stop. Everything else is one of five pages, chosen by what the
 * operator is doing rather than by what fits on a screen:
 *
 * ```text
 *   会话  the patient's picture, the figures, the dials — plus the live
 *         controls (scene, strength, voice, posture) and the end.
 *   场景  the preparation bench: scene, rise length, posture, start.
 *   音频  the full cue panel: sequences, single cues, volume, water, tone.
 *   体验  the operator's observation sheet, filled in after the headset is
 *         off; records list under the form, CSV out of it.
 *   说明  the manual, as a page.
 *
 * The questionnaire (SUS) is its own application face; it is not a training
 * destination. The 体验 sheet is the operator's, not the patient's, so it is
 * not offered there either.
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
    /** The main area while no headset is claimed: the initial page. */
    initialContent: @Composable () -> Unit = {},
    /** Design review only: open the mirror cover on first composition. */
    startWithMirrorOpen: Boolean = false,
    modifier: Modifier = Modifier
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
        modifier = modifier
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
                Column(Modifier.fillMaxSize()) {
                    // While a session runs, the two exits ride above the page —
                    // whichever destination the operator is on — so nobody has
                    // to navigate back to 会话 to stop the patient. The session
                    // page carries them at the foot of its own column instead.
                    if (phase.showsSessionVerbs && section != ConsoleSection.Session) {
                        SessionVerbsStrip(
                            state = state,
                            actions = actions,
                            phase = phase
                        )
                    }
                    Row(Modifier.weight(1f).fillMaxWidth()) {
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
                                ConsoleSection.Guide -> GuideScreen(
                                    onBack = {},
                                    app = "training",
                                    // The chrome is the console's own: this is a page
                                    // in the main area, not an overlay over it.
                                    withChrome = false,
                                    onExport = actions.onExportRecords
                                )
                                ConsoleSection.Audio -> PanelPage(
                                    title = "音频",
                                    note = "提示语与水声，都在这一页",
                                    onBack = { chosen = back }
                                ) {
                                    AudioPanel(state = state, actions = actions)
                                }
                                ConsoleSection.Experience -> PanelPage(
                                    title = "体验",
                                    note = "取下头显后填写；导出为 CSV 表格",
                                    onBack = { chosen = back }
                                ) {
                                    ExperiencePanel(state = state, actions = actions)
                                }

                            }
                        }
                    }
                }
            }

        }
    }
}

/**
 * The two session exits, on whatever page the operator is looking at.
 *
 * They are duplicated with the foot of the session column on purpose: the
 * session column is one tab away, and "stop the patient" is not a navigation.
 * The strip is a board, not a bar, so it reads as part of the page it sits on.
 *
 * The disconnect is drawn as the emergency it is. With the patient wearing the
 * headset and holding no controls, cutting the tablet *is* the stop: the page
 * freezes motion and voice immediately and holds the session for five seconds,
 * and only if that window closes with no reconnect does it end the session and
 * leave to the entry screen. Both halves are printed on the key, because the
 * difference between "frozen for five seconds" and "session over" is the whole
 * decision the operator is making.
 */
@Composable
private fun SessionVerbsStrip(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase
) {
    val ready = state.phase == BlePhase.READY
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(QuietPalette.Board)
            .padding(horizontal = QuietSpace.Page, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = if (phase == SessionPhase.Stopping) "正在结束" else "会话进行中",
            style = MaterialTheme.typography.labelMedium,
            color = QuietPalette.InkSecondary,
            modifier = Modifier.width(72.dp)
        )
        if (phase.awaitingPress) {
            ActionKey(
                label = "取消启动",
                subLabel = "患者尚未进入",
                onClick = actions.onCancelLaunch,
                tone = ActionTone.Secondary,
                height = 56.dp
            )
        } else {
            ActionKey(
                label = when (phase) {
                    SessionPhase.Stopping -> "正在结束"
                    else -> "结束会话"
                },
                onClick = actions.onEnd,
                tone = ActionTone.Danger,
                enabled = ready && phase != SessionPhase.Stopping,
                height = 56.dp
            )
        }
        Spacer(Modifier.weight(1f))
    }
    Rule()
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
            if (section == QuestionnaireSection.Guide) {
                // Owns its own scroller and its own full height: inside the
                // scrolling column below it was handed unbounded height and
                // drew nothing at all.
                GuideScreen(
                    onBack = {},
                    app = "questionnaire",
                    withChrome = false,
                    onExport = actions.onExportRecords
                )
                return@Box
            }
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
            ) {
                when (section) {
                    // Handled above: it owns its own scroller.
                    QuestionnaireSection.Guide -> Unit
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
 *
 * **Nothing here is optimistic.** A tap sends `record:outcome:*` and the row
 * shows "等待页面回执"; the button turns into "已记录" only when the page's own
 * `log kind=outcome.recorded` names that half of the question. The command
 * acknowledgement is not a receipt: it says the write reached the page's inbox,
 * which is exactly the thing that was true in the bug this replaces.
 */
@Composable
private fun OutcomePrompt(
    state: ControlUiState,
    phase: SessionPhase,
    actions: ControlActions
) {
    if (!outcomePanelVisible(
            lastSessionElapsedMs = state.lastSessionElapsedMs,
            sessionRunning = state.control.session,
            phase = phase
        )
    ) {
        return
    }
    val outcome = state.outcome
    val ready = state.phase == BlePhase.READY
    SectionHead(
        title = "本次结果",
        note = "上一轮 ${clock(state.lastSessionElapsedMs)}，取下头显后记录",
        modifier = Modifier.fillMaxWidth()
    )
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
                        text = outcome.summary,
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.InkSecondary
                    )
                }
                // The word keys are the *commands*: enabled while the answer is
                // still unknown and no write is in flight, and off once the page
                // has spoken — an answer the page already filed is not a question
                // the operator can answer differently from this screen.
                BarWordKey(
                    label = "试了",
                    onClick = { actions.onOutcome(OutcomeReceipt.SLOT_ATTEMPT, true) },
                    enabled = ready && !outcome.pending && outcome.attempted == null
                )
                Spacer(Modifier.width(12.dp))
                BarWordKey(
                    label = "没试",
                    onClick = { actions.onOutcome(OutcomeReceipt.SLOT_ATTEMPT, false) },
                    enabled = ready && !outcome.pending && outcome.attempted == null
                )
            }
            if (outcome.canReportSuccess) {
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
                        onClick = { actions.onOutcome(OutcomeReceipt.SLOT_SUCCESS, true) },
                        enabled = ready && !outcome.pending && outcome.succeeded == null
                    )
                    Spacer(Modifier.width(12.dp))
                    BarWordKey(
                        label = "未成功",
                        onClick = { actions.onOutcome(OutcomeReceipt.SLOT_SUCCESS, false) },
                        enabled = ready && !outcome.pending && outcome.succeeded == null
                    )
                }
            }
            if (outcome.succeeded != null) {
                Spacer(Modifier.height(10.dp))
                Rule()
                Text(
                    text = "结果已记入页面账本；本页不再改动这一轮。",
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.InkSecondary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            } else if (!ready) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "头显未连接：结果要在页面的账本上记录，先重新连接。",
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.InkSecondary
                )
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
    // The picture is two thirds of the column, not all of it. At full height it
    // crowded the strip underneath — the numbers and the instrument sat in a
    // band that looked tacked on — and the third it keeps free is what makes the
    // strip read as its own row instead of as leftovers.
    BoxWithConstraints(modifier) {
        val picture = maxHeight * MIRROR_HEIGHT_SHARE
        Column(Modifier.fillMaxSize()) {
            MirrorSlot(
                state = state,
                phase = phase,
                onModeChange = actions.onMirrorModeChange,
                modifier = Modifier.height(picture)
            )
            Spacer(Modifier.height(12.dp))
            // One card, like the column on the right: the strip used to sit on
            // bare paper, which made it read as a caption to the picture rather
            // than as the session's own instrument.
            SessionReadout(state = state)
            Spacer(Modifier.weight(1f))
            // The two continuous controls the operator rides mid-session sit
            // together at the foot of the picture: heave above water, one row
            // each, same height. Voice sets and cue ladders stay on 音频.
            SessionHeave(state = state, actions = actions, phase = phase)
            Spacer(Modifier.height(8.dp))
            SessionAudio(state = state, actions = actions)
        }
    }
}

/** Share of the left column the patient's picture takes. */
private const val MIRROR_HEIGHT_SHARE = 0.66f

/** The preparation room as a pickable card, not a header verb. */
private val PREPARATION_CARD =
    SceneCatalog.Scene(PREPARATION_SCENE, "准备间", "", special = true)

/** Scene name from the live catalogue, falling back to the built-in table. */
private fun sceneName(state: ControlUiState, id: String): String =
    state.scenes.firstOrNull { it.id == id }?.name
        ?: com.quietshore.control.model.SceneCatalog.scene(id)?.name
        ?: id

/**
 * One row, one baseline: elapsed, scene, buoyancy, and the two horizons.
 *
 * The numbers here are the ones an operator glances at while talking to the
 * patient. The pitch used to be a bare angle; it is now a small dial, because
 * what the correction *is* — the gap between the real horizon and the one the
 * scene is being placed in — cannot be read off a single number.
 */
@Composable
private fun SessionReadout(state: ControlUiState) {
    val stale = state.poseStale || state.pose == null
    val facts = buildList {
        // The clock rides the mirror's own header and the scene name is on the
        // picture's own chip: printing either here gave the strip three owners
        // for two facts, and pushed the calibration key out of the width.
        add("起伏" to "${state.control.floatMm.toInt()} mm")
    }
    Panel(Modifier.fillMaxWidth()) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
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
        // The instrument sits on the same baseline as the facts it belongs with:
        // one strip under the picture, not a line of numbers here and a gauge
        // somewhere else. A quarter turn of correction for a supine body, of
        // which `mix` of it has been applied — the page's own derivation.
        PitchReadout(
            headPitchDeg = if (stale) null else (state.pose!!.pitch * 180.0 / Math.PI).toFloat(),
            gapDeg = (1f - state.mix.coerceIn(0f, 1f)) * 90f,
            stale = stale
        )
    }
    }
}

/** Height of the two continuous rows under the picture: heave and water. */
private val SessionControlHeight = 60.dp

/**
 * The heave, one row over the water row.
 *
 * Same shape as [SessionAudio]: label, slider, value, switch. Same 60 dp
 * height and same switch width, so the pair reads as one instrument.
 */
@Composable
private fun SessionHeave(
    state: ControlUiState,
    actions: ControlActions,
    phase: SessionPhase,
    modifier: Modifier = Modifier
) {
    val ready = state.phase == BlePhase.READY
    val percent = state.floatPercent.coerceIn(0, 100)
    val capped = state.caps.floatCap <= 0
    val enabled = ready && phase.acceptsChanges && !capped
    Panel(modifier.fillMaxWidth().height(SessionControlHeight)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "起伏",
                style = MaterialTheme.typography.labelMedium,
                color = QuietPalette.InkSecondary
            )
            Spacer(Modifier.width(10.dp))
            HeaveBar(
                percent = percent,
                cap = state.caps.floatCap.coerceIn(0, 100),
                enabled = enabled,
                onPercent = actions.onFloatAmount,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = if (capped) "—" else "$percent",
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = if (capped) QuietPalette.Disabled else QuietPalette.InkSecondary,
                modifier = Modifier.width(34.dp)
            )
            Spacer(Modifier.width(10.dp))
            Key(
                label = if (state.breath) "禁用" else "启用",
                onClick = { actions.onBreathChange(!state.breath) },
                kind = if (state.breath) KeyKind.Outline else KeyKind.Selected,
                enabled = enabled && percent > 0,
                height = TouchTarget,
                minWidth = 84.dp
            )
        }
    }
}

/**
 * The scene bed, one card: a switch and a level.
 *
 * The voice is not here on purpose. A cue is a sentence the operator starts and
 * the patient hears out; the bed is the room tone they ride for the whole
 * session and want to turn down for one minute. Only the second one belongs
 * under the picture.
 */
@Composable
private fun SessionAudio(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier
) {
    val ready = state.phase == BlePhase.READY
    val muted = state.control.audioMuted
    Panel(modifier.fillMaxWidth().height(SessionControlHeight)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "水声",
                style = MaterialTheme.typography.labelMedium,
                color = QuietPalette.InkSecondary
            )
            Spacer(Modifier.width(10.dp))
            LevelBar(
                percent = state.waterVolume,
                enabled = ready && !muted,
                onChange = actions.onAudioVolume,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = if (muted) "关" else "${state.waterVolume}",
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = if (muted) QuietPalette.Disabled else QuietPalette.InkSecondary,
                modifier = Modifier.width(34.dp)
            )
            Spacer(Modifier.width(10.dp))
            Key(
                label = if (muted) "恢复" else "静音",
                onClick = actions.onToggleAudio,
                kind = if (muted) KeyKind.Selected else KeyKind.Outline,
                enabled = ready,
                height = TouchTarget,
                minWidth = 84.dp
            )
        }
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
    val calibration = calibrationView(phase, ready)
    // The one posture number, as the operator reads it: a whole percent.
    val mixPercent = (state.mix.coerceIn(0f, 1f) * 100f).roundToInt()
    val mixEnabled = ready && phase.acceptsChanges && (state.caps.rise || state.caps.lie)

    Column(modifier) {
        Column(
            Modifier.then(
                if (fill) {
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                } else {
                    Modifier.fillMaxWidth()
                }
            ),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Scenes come back here as chips: a session can be switched live, and
            // mid-session the operator should not have to leave the body
            // controls to do it. Only the divergence draws a key, so the block
            // is one row when the intent already matches what the patient sees.
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "场景",
                            style = MaterialTheme.typography.labelMedium,
                            color = QuietPalette.InkSecondary,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = sceneName(state, state.sceneIntent.ifEmpty { state.control.scene }),
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary,
                            maxLines = 1
                        )
                        Spacer(Modifier.width(10.dp))
                        Key(
                            label = if (state.inSpecialScene) "进入场景" else "切换场景",
                            onClick = actions.onSceneApply,
                            kind = KeyKind.Fill,
                            enabled = ready && phase.acceptsChanges && state.sceneIntentDiverges,
                            height = 40.dp,
                            minWidth = 96.dp
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (scene in state.selectableScenes) {
                            SceneCardView(
                                scene = scene,
                                current = scene.id == state.sceneIntent.ifEmpty { state.control.scene },
                                enabled = ready && phase.acceptsChanges,
                                onSelect = actions.onSceneSelect,
                                // Taller than the kit floor: this is the block
                                // the hand reaches for mid-session, and the
                                // preparation room now sits in the same row.
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 96.dp),
                                showBlurb = false
                            )
                        }
                        if (phase.inSession) {
                            SceneCardView(
                                scene = PREPARATION_CARD,
                                current = state.prepScenePending ||
                                    state.control.scene == PREPARATION_SCENE,
                                enabled = ready && phase.acceptsChanges && state.canReturnToPrep,
                                onSelect = { actions.onScenePrep() },
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 96.dp),
                                showBlurb = false
                            )
                        }
                    }
                }
            }

            // The heave moved to the left column, above water: two continuous
            // controls together, and the right column left for scene and body.
            Panel(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "体位",
                            style = MaterialTheme.typography.titleSmall,
                            color = QuietPalette.Ink,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = "补偿 $mixPercent%",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.InkSecondary
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    // One bar, the one posture scalar: the fill is what the
                    // headset applies, the handle is where the hand is. Touching
                    // it is the manual override, so no separate "stop" gesture
                    // is needed for a drag.
                    PostureMixBar(
                        applied = state.mix,
                        enabled = mixEnabled,
                        onTarget = actions.onPostureMix
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "天花板",
                            style = MaterialTheme.typography.labelSmall,
                            color = QuietPalette.InkSecondary
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = "平视前方",
                            style = MaterialTheme.typography.labelSmall,
                            color = QuietPalette.InkSecondary
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    // One value, both directions: the rise and the lie-back are
                    // the same motion run backwards, so they share one length.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "时长",
                            style = MaterialTheme.typography.labelMedium,
                            color = QuietPalette.InkSecondary
                        )
                        Spacer(Modifier.width(10.dp))
                        RampField(
                            rampMs = state.rampMs,
                            enabled = ready && state.caps.rise,
                            onCommit = actions.onAnimDuration
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = "${ControlProtocol.RAMP_S_MIN}–${ControlProtocol.RAMP_S_MAX}",
                            style = MaterialTheme.typography.labelSmall,
                            color = QuietPalette.InkSecondary
                        )
                        Spacer(Modifier.weight(1f))
                        // Re-aiming the world shares the ramp's row: the row has
                        // the width, and the two are the same kind of decision —
                        // how the world is placed right now.
                        CalibrationKey(
                            view = calibration,
                            onClick = actions.onRecalibrate,
                            height = TouchTarget,
                            modifier = Modifier.width(116.dp)
                        )
                    }
                    Text(
                        text = "正反两个方向同速",
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.InkSecondary,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                    Spacer(Modifier.height(10.dp))
                    KeyRow {
                        ActionKey(
                            label = "修正",
                            subLabel = "起身",
                            onClick = actions.onPostureRise,
                            modifier = Modifier.weight(1f),
                            tone = ActionTone.Primary,
                            enabled = ready && state.caps.rise && phase.acceptsChanges,
                            height = 64.dp
                        )
                        ActionKey(
                            label = "逆修正",
                            subLabel = "躺下",
                            onClick = actions.onPostureLower,
                            modifier = Modifier.weight(1f),
                            enabled = ready && state.caps.lie && phase.acceptsChanges,
                            height = 64.dp
                        )
                        ActionKey(
                            label = "暂停",
                            subLabel = "冻结",
                            onClick = actions.onPostureStop,
                            modifier = Modifier.weight(1f),
                            enabled = ready && state.caps.stop && phase.acceptsChanges,
                            height = 64.dp
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        // The foot of the column is the session's verbs, and they are present on
        // the *page* rather than only in the bar: during a session the operator
        // must never have to find another tab to stop the patient.
        if (phase.awaitingPress) {
            // Nothing has been entered, so this is not a stop: the launch is
            // withdrawn before the patient moves.
            ActionKey(
                label = "取消启动",
                subLabel = "患者尚未进入",
                onClick = actions.onCancelLaunch,
                modifier = Modifier.fillMaxWidth(),
                tone = ActionTone.Secondary,
                enabled = true,
                height = 64.dp
            )
        } else if (phase.inSession) {
            EndKey(
                enabled = ready && phase != SessionPhase.Stopping,
                label = when (phase) {
                    SessionPhase.Stopping -> "正在结束"
                    else -> "结束会话"
                },
                onClick = actions.onEnd,
                modifier = Modifier.fillMaxWidth()
            )
        }
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
    val calibration = calibrationView(phase, ready)
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
            OutcomePrompt(state = state, phase = phase, actions = actions)
            Spacer(Modifier.height(QuietSpace.Section))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom
            ) {
                SectionHead(
                    title = "01 场景",
                    note = when {
                        selectedName != null -> "已选「$selectedName」"
                        state.inSpecialScene -> "准备间中"
                        // The ice mark on a row says "this one is loaded", so the
                        // header has to name it: a bare 未选择 beside a marked row
                        // is two answers to the same question.
                        else -> "已载入「${sceneName(state, state.control.scene)}」"
                    },
                    modifier = Modifier.weight(1f)
                )
                // The apply key only exists where it can act. Before the posture
                // is recorded no scene can be entered, and a disabled key beside
                // a disabled list is a page with no decision on it at all.
                if (scenesEnabled) {
                    Key(
                        label = if (state.inSpecialScene) "进入正式场景" else "切换场景",
                        onClick = actions.onSceneApply,
                        enabled = state.sceneIntentDiverges,
                        height = TouchTarget,
                        modifier = Modifier.padding(bottom = 16.dp)
                    )
                }
            }
            if (scenesEnabled) {
                // The choice is the page, and it is live: the cards take every
                // pixel the header leaves, so a ten-inch tablet is a large
                // target rather than three small ones over a field of paper.
                SceneChooser(
                    current = state.sceneIntent.ifEmpty { state.control.scene },
                    enabled = true,
                    onSelect = actions.onSceneSelect,
                    playing = state.control.scene,
                    scenes = state.selectableScenes,
                    fillHeight = true,
                    modifier = Modifier.weight(1f)
                )
            } else {
                // Nothing can be entered yet, so the scenes are an agenda, not
                // targets: the page's one live decision is 启动 on the right.
                SceneIndex(
                    scenes = state.selectableScenes,
                    current = state.control.scene,
                    note = calibration.unlockNote,
                    modifier = Modifier.fillMaxWidth()
                )
                // The agenda is a short board at the top; the rest of the column
                // is air on purpose.
                Spacer(Modifier.weight(1f))
            }
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
    val calibration = calibrationView(phase, ready)
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
                Spacer(Modifier.width(16.dp))
                // The launch wait is up to twenty seconds of a page that cannot
                // otherwise be backed out of. This is not a stop: nothing has
                // been entered yet, so it only withdraws the request.
                Key(
                    label = "取消启动",
                    onClick = actions.onCancelLaunch,
                    kind = KeyKind.Outline,
                    enabled = true,
                    height = TouchTarget,
                    minWidth = 96.dp
                )
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
    val calibration = calibrationView(phase, ready)
    Panel(modifier) {
        Column(Modifier.fillMaxSize().padding(QuietSpace.Panel)) {
            Text(
                text = "准备",
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "患者按一次头显按钮，进入画面。",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            Spacer(Modifier.height(14.dp))
            // The chain follows the room the patient is actually in: the
            // start key is not the scene choice any more, and the scene list
            // is not a pre-session step.
            StepLine("连接头显", if (ready) "已连接" else "未连接", ready)
            Spacer(Modifier.height(12.dp))
            StepLine(
                "启动训练",
                when (phase) {
                    SessionPhase.Entry -> "等待患者进入"
                    SessionPhase.Calibrating -> "准备间，记录中"
                    SessionPhase.Running -> "已在准备间"
                    else -> "未启动"
                },
                phase != SessionPhase.Idle
            )
            Spacer(Modifier.height(12.dp))
            StepLine(
                "记录起始体位",
                calibration.stepValue,
                calibration.stepDone
            )
            Spacer(Modifier.height(12.dp))
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
                // The countdown already lives in the page headline; repeating it
                // under the key made the same sentence appear twice on one screen.
                Spacer(Modifier.height(8.dp))
                // The wait is the operator's to call off: the patient has not
                // pressed yet, so nothing about this is a session decision.
                ActionKey(
                    label = "取消启动",
                    onClick = actions.onCancelLaunch,
                    modifier = Modifier.fillMaxWidth(),
                    tone = ActionTone.Secondary,
                    height = TouchTarget,
                    textStyle = MaterialTheme.typography.titleSmall
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = calibration.hint,
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary
            )
            if (phase == SessionPhase.Idle && state.lastSessionElapsedMs > 0L) {
                // The session that just ended is recorded; the scale is a
                // separate application face and is not offered from training.
                Spacer(Modifier.height(16.dp))
                Rule()
                Text(
                    text = "上一轮 ${clock(state.lastSessionElapsedMs)} 已记录。量表在「问卷」应用内。",
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
