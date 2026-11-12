package com.quietshore.control.ui.components

import androidx.compose.foundation.background
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHead(
                title = "患者视野",
                // The elapsed clock is the one datum the old readout card
                // carried that nothing else does; it rides here instead of
                // costing a whole block under the picture.
                note = when {
                    phase == SessionPhase.Calibrating -> "标定中 · 镜像来自状态帧"
                    state.sessionElapsedMs > 0L -> "已运行 ${clock(state.sessionElapsedMs)}"
                    else -> "镜像来自状态帧"
                },
                modifier = Modifier.weight(1f)
            )
            // The two cameras, inline: selection is an outline, never a fill.
            // No second layer to open — the picture is already here.
            if (onModeChange != null && hasFrame) {
                for (mode in com.quietshore.control.model.MirrorMode.entries) {
                    Key(
                        label = mode.label,
                        onClick = { onModeChange(mode) },
                        kind = if (state.mirrorMode == mode) KeyKind.Selected else KeyKind.Outline,
                        height = 48.dp
                    )
                    Spacer(Modifier.width(8.dp))
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
                .padding(top = 12.dp)
                .clip(CutCornerShape(0.dp, 0.dp, 0.dp, 18.dp))
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
                            state.control.calibrating -> "标定中 · 请患者保持不动"
                            state.sessionElapsedMs > 0L -> "准备间 · 右侧选择正式场景"
                            else -> "准备间 · 调整体位并记录起始朝向"
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
                        !hasFrame && phase == SessionPhase.Entry -> "头显在入口页，等待患者按压。"
                        !hasFrame -> "头显未连接，或未收到状态帧。"
                        else -> "画面就绪后自动替换。"
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

/** Four ramp lengths; the page accepts any 4–14 s, these are the useful ones. */
private val DURATIONS_S = listOf(6, 8, 10, 12)

/**
 * The rise length, as four selectable keys. The current one is an ice
 * *outline* with medium ink — selection is a state, and a fill on this console
 * means "pressing this does something now".
 */
@Composable
fun DurationRow(selected: Int, enabled: Boolean, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for (seconds in DURATIONS_S) {
            val active = selected == seconds * 1000
            Key(
                label = "$seconds 秒",
                onClick = { onSelect(seconds * 1000) },
                kind = if (active) KeyKind.Selected else KeyKind.Outline,
                enabled = enabled,
                minWidth = 96.dp,
                height = 64.dp,
                textStyle = MaterialTheme.typography.titleSmall
            )
        }
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

/** The posture gauges, side by side: one read-only block on any page. */
@Composable
fun PostureGauges(state: ControlUiState, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(40.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        PitchSideGauge(pose = state.pose, stale = state.poseStale)
        AngleGauge(pose = state.pose, stale = state.poseStale)
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
