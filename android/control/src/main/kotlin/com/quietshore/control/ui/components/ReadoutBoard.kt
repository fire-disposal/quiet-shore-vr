package com.quietshore.control.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.theme.ControlMotion
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The three numbers that answer "is this session going the way I planned":
 * how long it has run, how strong the motion is, and how far the body has
 * risen. Every figure is read from the headset's state frame; nothing is
 * re-derived here, so the board cannot disagree with the panel.
 *
 * Sitting directly under the bar, it stays on screen whichever band is open:
 * the operator should not have to change tabs to see the session.
 */
@Composable
fun ReadoutBoard(
    state: ControlUiState,
    modifier: Modifier = Modifier
) {
    val running = state.control.session
    val mix = state.control.mix.coerceIn(0f, 1f)
    val percent = (mix * 100f).roundToInt()
    val eyeHeight = String.format(Locale.US, "%.2f", state.control.eyeHeight)
    val elapsed = clock(state.sessionElapsedMs)
    val strength = when {
        !running -> "0"
        state.control.floatLevel > 0 -> "±${abs(state.control.floatMm).roundToInt()}"
        else -> "0"
    }
    val strengthUnit = if (state.control.floatLevel > 0) "mm" else "静止"
    val level = if (running) state.control.floatLevel.coerceIn(0, 3) / 3f else 0f
    val animated by animateFloatAsState(
        targetValue = mix,
        animationSpec = tween(ControlMotion.duration(ControlMotion.BAR_MS)),
        label = "posture-mix"
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Surface)
            .padding(horizontal = 20.dp, vertical = 14.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "时长 $elapsed，强度 $strength $strengthUnit，体位 $percent%，视高 $eyeHeight 米"
            },
        verticalAlignment = Alignment.Bottom
    ) {
        Figure(
            label = "时长",
            value = elapsed,
            unit = if (running) "进行中" else "未开始",
            modifier = Modifier.weight(1f),
            primary = true
        )
        Divider()
        Figure(
            label = "强度",
            value = strength,
            unit = strengthUnit,
            modifier = Modifier.weight(1f)
        )
        Divider()
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = "$percent",
                    style = MaterialTheme.typography.displayMedium,
                    color = QuietPalette.TextPrimary,
                    maxLines = 1
                )
                Text(
                    text = "%",
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.padding(bottom = 8.dp, start = 2.dp)
                )
            }
            Spacer(Modifier.height(6.dp))
            Meter(fraction = animated, active = running)
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "体位",
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.TextSecondary,
                    maxLines = 1
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = "视高 $eyeHeight m",
                    style = MaterialTheme.typography.bodySmall.tabularFigures(),
                    color = QuietPalette.TextSecondary,
                    maxLines = 1
                )
            }
        }
    }
}

/** One number, its small caps label above it, its unit beside it. */
@Composable
private fun Figure(
    label: String,
    value: String,
    unit: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false
) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = value,
                style = if (primary) {
                    MaterialTheme.typography.displayMedium
                } else {
                    MaterialTheme.typography.displaySmall
                },
                color = QuietPalette.TextPrimary,
                maxLines = 1
            )
        }
        Spacer(Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = QuietPalette.TextSecondary,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = unit,
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.TextSecondary,
                maxLines = 1
            )
        }
    }
}

/** Hairline column rule between two figures; the board's only division. */
@Composable
private fun Divider() {
    Box(
        Modifier
            .padding(horizontal = 16.dp)
            .width(1.dp)
            .height(56.dp)
            .fillMaxHeight(0.72f)
            .background(QuietPalette.Hairline)
    )
}

/** mm:ss, capped at an hour so the figure never changes width. */
fun clock(milliseconds: Long): String {
    val totalSeconds = (milliseconds / 1000).coerceIn(0, 3599)
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
}

/** Room for the board: the bar is above it, the bands below. */
val BoardHeight = 108.dp
