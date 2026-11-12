package com.quietshore.control.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.theme.ControlMotion
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The monitor: what the operator can read at a glance without touching
 * anything.
 *
 * Three figures, in the order the question comes — is it still running, how
 * long has it run, where is the patient — at sizes that carry from a metre
 * away in daylight:
 *
 * ```text
 *   仍在运行            18:42            12 %             ±18 mm
 *   会话态 · 已运行       时长              体位              强度
 *   场景 · 仰望湖面                       视高 0.68 m       3 级
 * ```
 *
 * The elapsed clock is the largest thing in the app because it is the one
 * number a technician reads while watching the patient rather than the screen.
 * Every figure is read from the headset's state frame; nothing is re-derived
 * here, so the monitor cannot disagree with the controls under it.
 */
@Composable
fun MonitorPanel(
    state: ControlUiState,
    running: Boolean,
    headline: String,
    sessionWord: String,
    clockWord: String,
    modifier: Modifier = Modifier
) {
    val mix = state.control.mix.coerceIn(0f, 1f)
    val percent = (mix * 100f).roundToInt()
    val eyeHeight = String.format(Locale.US, "%.2f", state.control.eyeHeight)
    val elapsed = clock(state.sessionElapsedMs)
    val level = state.control.floatLevel.coerceIn(0, 3)
    val rise = String.format(
        Locale.US,
        "±%d mm",
        abs(state.control.floatMm).roundToInt()
    )
    val sceneName = com.quietshore.control.model.SceneCatalog
        .scene(state.control.scene)?.name ?: state.control.scene

    val animated by animateFloatAsState(
        targetValue = mix,
        animationSpec = tween(ControlMotion.duration(ControlMotion.BAR_MS)),
        label = "posture-mix"
    )

    Panel(modifier.fillMaxWidth()) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = headline,
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.width(12.dp))
                if (sessionWord.isNotBlank()) {
                    Text(
                        text = sessionWord,
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.InkSecondary
                    )
                }
                Spacer(Modifier.weight(1f))
                Text(
                    text = sceneName,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.InkSecondary
                )
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Figure(
                    value = elapsed,
                    label = "时长",
                    note = clockWord,
                    modifier = Modifier.weight(1.15f),
                    primary = true
                )
                FigureDivider()
                Figure(
                    value = "$percent",
                    suffix = "%",
                    label = "体位",
                    note = "视高 $eyeHeight m",
                    modifier = Modifier.weight(1f)
                )
                FigureDivider()
                Figure(
                    value = if (level > 0) rise else "静止",
                    label = "强度",
                    note = if (level > 0) "$level 级" else "起伏关闭",
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(Modifier.height(14.dp))
            Meter(fraction = animated, active = running)
        }
    }
}

/** What the mix means in words, so the number is readable without a legend. */
private fun postureWord(percent: Int): String = when {
    percent <= 5 -> "平卧"
    percent >= 95 -> "坐起"
    percent < 45 -> "半卧"
    else -> "半坐"
}

/**
 * One figure: the number at display size, its Latin caps label over it in second
 * ink, its note under it. Tabular, never re-derived, never a placeholder.
 */
@Composable
private fun Figure(
    value: String,
    label: String,
    note: String,
    modifier: Modifier = Modifier,
    suffix: String? = null,
    primary: Boolean = false
) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = value,
                style = if (primary) {
                    MaterialTheme.typography.displayLarge
                } else {
                    MaterialTheme.typography.displaySmall
                },
                color = QuietPalette.Ink,
                maxLines = 1
            )
            if (suffix != null) {
                Text(
                    text = suffix,
                    style = MaterialTheme.typography.titleLarge,
                    color = QuietPalette.InkSecondary,
                    modifier = Modifier.padding(bottom = 10.dp, start = 2.dp)
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = note,
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
    }
}

/** The monitor's only division: a hairline down the panel's height. */
@Composable
private fun FigureDivider() {
    Box(
        Modifier
            .padding(horizontal = 20.dp)
            .width(1.dp)
            .height(96.dp)
            .background(QuietPalette.Hairline)
    )
}

/** mm:ss, capped at an hour so the figure never changes width. */
fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}
