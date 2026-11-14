package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.ControlProtocol
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The blocks more than one destination needs. They live here rather than in a
 * screen so the session page and the scene page cannot drift into two
 * slightly different mirrors or two different step lists.
 */

/**
 * The mirror's height. Fixed rather than weighted: the column above it sizes
 * itself to its content, and a mirror that shrank with the window would leave
 * the gauges floating in a gap.
 */
val MirrorHeight = 300.dp

/**
 * The renderer: the patient's picture when there is one, a placeholder that
 * says why when there is not.
 *
 * A session screen with an empty box was the old failure this replaces. The
 * placeholder is paper, not an illustration and not an accent: "no picture" is
 * information, not an alert.
 */
@Composable
fun MirrorSlot(
    state: ControlUiState,
    phase: SessionPhase,
    modifier: Modifier = Modifier,
    /** The camera the mirror is using, and the way to change it. */
    onModeChange: ((com.quietshore.control.model.MirrorMode) -> Unit)? = null
) {
    val hasFrame = state.phase == BlePhase.READY && state.pose != null && !state.poseStale
    // A WebView that has been told to load but has not finished is a black
    // rectangle for a second or two. That second is not allowed to look like a
    // failure, so the placeholder stays up until the page says it can draw.
    var loaded by remember(state.mirrorMode) { mutableStateOf(false) }

    Column(modifier.fillMaxWidth()) {
        // A picture label, not a page title: 32 dp of title plus 16 dp of gap
        // above the image is height the mirror could be using. One compact row,
        // 20 sp title, its clock, then the two cameras — and on a board, because
        // every other fact on this page is on one.
        Panel(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "VR 视野",
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.width(12.dp))
            Text(
                // The elapsed clock is the one datum the old readout card
                // carried that nothing else does; it rides here instead of
                // costing a whole block under the picture.
                text = when {
                    phase == SessionPhase.Calibrating -> "标定中，镜像来自状态帧"
                    state.sessionElapsedMs > 0L -> "已运行 ${clock(state.sessionElapsedMs)}"
                    else -> "镜像来自状态帧"
                },
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary,
                // Two lines: the caption is a sentence and the camera keys now
                // take the height the font scale asks for, so a single line here
                // was the first thing to be ellipsised.
                maxLines = 2,
                modifier = Modifier.weight(1f)
            )
            // The two cameras, inline: selection is an outline, never a fill.
            // No second layer to open — the picture is already here.
            if (onModeChange != null && hasFrame) {
                for (mode in com.quietshore.control.model.MirrorMode.entries) {
                    Key(
                        label = mode.label,
                        onClick = { onModeChange(mode) },
                        // A segmented pair: the current camera keeps its ice
                        // outline, the other one is a word on paper. Two boxes
                        // side by side were two primaries beside a picture.
                        kind = if (state.mirrorMode == mode) KeyKind.Selected else KeyKind.Quiet,
                        height = TouchTarget,
                        minWidth = 88.dp
                    )
                    Spacer(Modifier.width(4.dp))
                }
            }
        }
        }
        Rule()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                // The session column gives this slot a weight: the picture is
                // the primary surface, and it should use the height the page
                // has, not a fixed box with dead paper around it.
                .weight(1f, fill = false)
                .heightIn(min = MirrorHeight)
                .padding(top = 10.dp)
                // The picture is not pressable, so it takes no cut corner: a
                // wedge cut out of a photograph read as damage, not as design.
                .background(if (hasFrame && loaded) QuietPalette.Ink else QuietPalette.Board)
        ) {
            if (hasFrame) {
                MirrorView(
                    state = state,
                    modifier = Modifier.fillMaxSize(),
                    onLoadedChange = { loaded = it }
                )
                // In the preparation room the picture is intentionally empty;
                // the operator's next step is the one useful thing it can
                // carry. A small overlay, never a panel.
                if (state.inSpecialScene) {
                    Text(
                        text = when {
                            state.control.calibrating -> "标定中，请患者保持不动"
                            state.sessionElapsedMs > 0L -> "准备间，右侧选择正式场景"
                            else -> "准备间，调整体位并记录起始朝向"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.Ink,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .background(QuietPalette.Paper.copy(alpha = 0.92f))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
            // Once the link is live, the picture is the only thing worth
            // showing: the page can paint before onPageFinished reports, so a
            // placeholder keyed on the load callback would sit on top of a
            // working picture.
            if (!hasFrame) {
                Column(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    val title = when {
                        !hasFrame && phase == SessionPhase.Entry -> "患者尚未进入场景"
                        !hasFrame -> "镜像未连接"
                        else -> "正在载入镜像"
                    }
                    val note = when {
                        !hasFrame && phase == SessionPhase.Entry -> "头显在入口页，等待患者进入。"
                        !hasFrame -> "头显未连接，或未收到状态帧。"
                        else -> "画面还没有到。"
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
}

/**
 * One row of the preparation chain: the step, its current value, and a 4 dp
 * ice bar on the leading edge once it is done. The bar is the selection mark
 * used elsewhere for "this is the current one", so a done step reads as state
 * without a fill.
 */
@Composable
fun StepLine(name: String, value: String, done: Boolean) {
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

/**
 * One value drives both directions: the operator types the seconds once and the
 * rise and the lie-back both take it.
 *
 * It is a field, not four keys, because the useful range is wider than any row
 * of buttons (4–20 s) and because a length is a number the bedside says out
 * loud. The band is the protocol's own (`ControlProtocol.RAMP_S_*`), so the
 * tablet can never offer a value the page would reject. Out of band the text
 * turns red and nothing is sent; a refused value must not look applied.
 */
@Composable
fun RampField(
    rampMs: Int,
    enabled: Boolean,
    onCommit: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    // The readback is the truth, so the buffer refills whenever the page reports
    // a new length — a typed value that the page refused never sticks. A page
    // that has not reported one yet (0) shows the default rather than an error:
    // an all-red field on a fresh link reads as a fault in the app.
    val secondsShown = if (rampMs > 0) rampMs / 1000 else ControlProtocol.RAMP_S_DEFAULT
    var text by rememberSaveable(secondsShown) { mutableStateOf(secondsShown.toString()) }
    var touched by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val seconds = text.toIntOrNull()
    val valid = seconds != null && seconds in ControlProtocol.RAMP_S_MIN..ControlProtocol.RAMP_S_MAX

    fun commit() {
        val value = text.toIntOrNull()
        if (value != null && value in ControlProtocol.RAMP_S_MIN..ControlProtocol.RAMP_S_MAX) {
            onCommit(value * 1000)
        } else {
            text = secondsShown.toString()
        }
    }

    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            value = text,
            onValueChange = { raw ->
                touched = true
                // Two digits is the whole band: no signs, no decimals, no paste.
                text = raw.filter { it.isDigit() }.take(2)
            },
            enabled = enabled,
            singleLine = true,
            textStyle = MaterialTheme.typography.titleMedium
                .tabularFigures()
                .copy(
                    color = if (valid) QuietPalette.Ink else QuietPalette.Danger,
                    textAlign = TextAlign.End
                ),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(onDone = {
                commit()
                focus.clearFocus()
            }),
            cursorBrush = SolidColor(QuietPalette.Ink),
            modifier = Modifier
                .width(64.dp)
                .height(48.dp)
                .border(1.dp, if (valid) QuietPalette.Hairline else QuietPalette.Danger)
                .padding(horizontal = 10.dp, vertical = 10.dp)
                .onFocusChanged { state ->
                    // Commit on the way out only, and only after the field was
                    // actually used: the first composition reports "unfocused".
                    if (state.isFocused) {
                        touched = true
                    } else if (touched) {
                        touched = false
                        commit()
                    }
                }
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = "秒",
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary
        )
    }
}

/** The cue after the one speaking, from the catalogue's own order. */
fun nextVoiceId(state: ControlUiState): String {
    val lines = com.quietshore.control.voice.VoiceCatalog.LINES
    val index = lines.indexOfFirst { it.id == state.voiceLine?.id }
    return lines.getOrNull(index + 1)?.id ?: lines.first().id
}

/**
 * One line of voice state plus the door to the full panel. The session page
 * and the scene page both offer it: it is a summary, not a second console.
 */
@Composable
fun VoiceSummaryRow(
    state: ControlUiState,
    onOpenVoice: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val line = state.voiceLine
    Row(
        modifier = modifier.fillMaxWidth(),
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
        Key(label = "全部语音", onClick = onOpenVoice, enabled = enabled)
    }
}

/**
 * The head's angles, as two figures and nothing else.
 *
 * This used to be three drawings of one fact — a side elevation, a compass dial
 * and a slider — spread across a third of the page. The operator reads this
 * while looking at the patient, not while studying it: two numbers on the same
 * baseline answer "which way is the head facing and how far is it tipped", and
 * the mirror above already shows the same thing as a picture.
 */
@Composable
fun PostureGauges(state: ControlUiState, modifier: Modifier = Modifier) {
    val pose = state.pose
    val stale = state.poseStale || pose == null
    val yaw = pose?.yaw ?: 0f
    val pitch = pose?.pitch ?: 0f
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(48.dp),
        verticalAlignment = Alignment.Bottom
    ) {
        for ((label, value, unit) in listOf(
            Triple("偏航", yaw, "°"),
            Triple("俯仰", pitch, "°")
        )) {
            Column {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.InkSecondary
                )
                Text(
                    // `%+.0f` turns -0.2° into "-0°" and 0° into "+0°"; below
                    // half a degree the sign carries no information at all.
                    text = if (stale) {
                        "—"
                    } else {
                        val rounded = Math.round(value)
                        if (rounded == 0) {
                            "0$unit"
                        } else {
                            String.format(java.util.Locale.US, "%+d%s", rounded, unit)
                        }
                    },
                    style = MaterialTheme.typography.headlineMedium.tabularFigures(),
                    color = if (stale) QuietPalette.Disabled else QuietPalette.Ink
                )
            }
        }
    }
}

/**
 * The figure block, wired to the phase so every caption tells the same story:
 * the headline says whether the session is running, being recorded or fading,
 * the clock's caption follows the same word.
 */
@Composable
/** mm:ss, capped at an hour so the figure never changes width. */
fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(java.util.Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}
