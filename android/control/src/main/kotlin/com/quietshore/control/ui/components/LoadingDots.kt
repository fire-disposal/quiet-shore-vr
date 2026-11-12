package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.rememberMotionPhase
import kotlin.math.PI
import kotlin.math.sin

/**
 * Waiting cue: three square blocks filling in sequence, on a fixed clock.
 * Not a dot row — the console has no dots anywhere else. Settles into two lit
 * blocks when the system asks for reduced motion.
 */
@Composable
fun LoadingDots(
    modifier: Modifier = Modifier,
    color: Color = QuietPalette.TextPrimary
) {
    val phase = rememberMotionPhase(CYCLE_NANOS)
    Row(
        modifier = modifier.size(width = 24.dp, height = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(3) { index ->
            val alpha = if (phase == null) {
                if (index < 2) 1f else 0.25f
            } else {
                val shift = (phase - index * 0.16f + 1f) % 1f
                val wave = (sin(shift * 2f * PI.toFloat()) + 1f) / 2f
                0.3f + 0.7f * wave
            }
            Box(
                Modifier
                    .size(6.dp)
                    .background(color.copy(alpha = alpha))
            )
        }
    }
}

/** Two cycles per second: fast enough to read as "working", slow enough to stay calm. */
private const val CYCLE_NANOS = 1_200_000_000L
