package com.quietshore.control.ui.theme

import android.animation.ValueAnimator
import android.provider.Settings
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/**
 * Every transition in the tablet console draws its timing from here.
 *
 * 冷库 / calm: motion is a state change, not a performance. Tints and fills
 * cross-fade; nothing slides, scales, bounces or pulses. All values are
 * 100–400 ms so a press reads as a press.
 */
object ControlMotion {
    /**
     * Global kill switch. When false every [duration] becomes 0, so all
     * transitions complete instantly without touching the call sites.
     */
    @Volatile
    var enabled: Boolean = true

    /** Chosen/current fill and tab ink; the shortest value that still reads as a fade. */
    const val TINT_MS: Int = 120

    /** A selection moving between two rows (scene list, answered SUS item). */
    const val SELECT_MS: Int = 160

    /** Anything that replaces content: panel swap, banner in, notice in. */
    const val CONTENT_MS: Int = 200

    /** The slowest token here: a bar filling to a new value. */
    const val BAR_MS: Int = 320

    /** Legacy name used by the panel swap; same value as [TINT_MS]. */
    const val TAB_SWITCH_MS: Int = TINT_MS

    /** Mechanical: linear-ish, no overshoot. */
    val standard: Easing = LinearOutSlowInEasing

    fun duration(milliseconds: Int): Int = if (enabled) milliseconds else 0
}

/**
 * Honours the system "remove animations" switch (Animator duration scale 0 or
 * accessibility reduce-motion). Kept as a remember so the reading happens once
 * per screen rather than per frame.
 */
@Composable
fun rememberMotionEnabled(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        val animations = ValueAnimator.areAnimatorsEnabled()
        val reduced = try {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f
            ) == 0f
        } catch (error: Exception) {
            false
        }
        val enabled = animations && !reduced
        ControlMotion.enabled = enabled
        enabled
    }
}

/**
 * Frame clock for the waiting cue: a fixed tick so the dot wave is time-based,
 * never a spring. Returns 0..1, or null when motion is off.
 */
@Composable
fun rememberMotionPhase(cycleNanos: Long): Float? {
    val enabled = rememberMotionEnabled()
    if (!enabled) return null
    var phase by remember { mutableStateOf(0f) }
    LaunchedEffect(Unit) {
        var start = 0L
        while (true) {
            withFrameNanos { now ->
                if (start == 0L) start = now
                phase = ((now - start) % cycleNanos) / cycleNanos.toFloat()
            }
        }
    }
    return phase
}
