package com.quietshore.control.ui.components

import android.animation.ValueAnimator
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import kotlin.math.PI
import kotlin.math.sin

/**
 * Indeterminate waiting cue: three small dots with a soft staggered wave.
 * Uses frame callbacks rather than an animation spec so it stays dependency
 * free, and settles into static dots when system animations are disabled.
 */
@Composable
fun LoadingDots(
    modifier: Modifier = Modifier,
    color: Color = QuietPalette.Primary
) {
    val animated = remember { ValueAnimator.areAnimatorsEnabled() }
    var phase by remember { mutableStateOf(0f) }

    if (animated) {
        LaunchedEffect(Unit) {
            var startNanos = 0L
            while (true) {
                withFrameNanos { now ->
                    if (startNanos == 0L) {
                        startNanos = now
                    }
                    val elapsed = now - startNanos
                    phase = (elapsed % CYCLE_NANOS) / CYCLE_NANOS.toFloat()
                }
            }
        }
    }

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(3) { index ->
            val shift = (phase - index * 0.12f + 1f) % 1f
            val wave = ((sin(shift * 2f * PI.toFloat()) + 1f) / 2f)
            val alpha = if (animated) 0.35f + 0.65f * wave else 0.6f
            val lift = if (animated) 3f * wave else 0f
            Box(
                Modifier
                    .offset(y = (-lift).dp)
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = alpha))
            )
        }
    }
}

private const val CYCLE_NANOS = 840_000_000L
