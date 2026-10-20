package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private val PAD_DIAMETER = 132.dp
private val KNOB_RADIUS = 16.dp
private val SPRING_SECONDS = 0.16f

/**
 * Therapist-only virtual view nudge.
 *
 * Dragging reports a normalized vector (`+x` view right, `+z` view forward,
 * both in [-1, 1]) at pointer speed while the visual knob follows the finger;
 * the ViewModel owns the ~10 Hz wire repeat. Releasing, cancelling, or losing
 * the ability to steer always reports a release so movement stops immediately.
 */
@Composable
fun JoystickPad(
    enabled: Boolean,
    onVector: (Float, Float) -> Unit,
    onRelease: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    var knob by remember { mutableStateOf(Offset.Zero) }
    var dragging by remember { mutableStateOf(false) }
    val springJob = remember { mutableStateOf<Job?>(null) }

    val springBack: () -> Unit = {
        springJob.value?.cancel()
        springJob.value = scope.launch {
            val start = knob
            if (start != Offset.Zero) {
                val startNanos = withFrameNanos { it }
                while (true) {
                    val now = withFrameNanos { it }
                    val t = ((now - startNanos) / 1_000_000_000f / SPRING_SECONDS).coerceIn(0f, 1f)
                    val eased = 1f - (1f - t) * (1f - t)
                    knob = start * (1f - eased)
                    if (t >= 1f) {
                        break
                    }
                }
            }
            knob = Offset.Zero
        }
    }

    // Losing permission mid-drag must not leave the page moving.
    LaunchedEffect(enabled) {
        if (!enabled) {
            springJob.value?.cancel()
            springJob.value = null
            knob = Offset.Zero
            dragging = false
            onRelease()
        }
    }

    // The rail can be collapsed or swapped to fullscreen mid-drag; pointer
    // cancellation does not call onDragCancel, so release on unmount too.
    DisposableEffect(Unit) {
        onDispose { onRelease() }
    }

    val accent = if (enabled) QuietPalette.Primary else QuietPalette.TextSecondary.copy(alpha = 0.5f)
    val ring = if (enabled) QuietPalette.Outline else QuietPalette.Outline.copy(alpha = 0.5f)

    Box(
        modifier = modifier
            .size(PAD_DIAMETER)
            .clip(CircleShape)
            .background(QuietPalette.SurfaceSunken.copy(alpha = 0.92f))
            .semantics { contentDescription = "虚拟视点摇杆，按住拖动，松手停止" }
            .pointerInput(enabled) {
                if (!enabled) {
                    return@pointerInput
                }
                val travel = minOf(size.width, size.height) / 2f - KNOB_RADIUS.toPx()
                fun report(position: Offset) {
                    val centre = Offset(size.width / 2f, size.height / 2f)
                    val delta = position - centre
                    val length = delta.getDistance()
                    val clamped = if (length > travel && length > 0f) {
                        delta * (travel / length)
                    } else {
                        delta
                    }
                    knob = clamped
                    onVector(
                        (clamped.x / travel).coerceIn(-1f, 1f),
                        (-clamped.y / travel).coerceIn(-1f, 1f)
                    )
                }
                detectDragGestures(
                    onDragStart = { position ->
                        springJob.value?.cancel()
                        springJob.value = null
                        dragging = true
                        report(position)
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        report(change.position)
                    },
                    onDragEnd = {
                        dragging = false
                        onRelease()
                        springBack()
                    },
                    onDragCancel = {
                        dragging = false
                        onRelease()
                        springBack()
                    }
                )
            }
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val centre = Offset(size.width / 2f, size.height / 2f)
            val radius = size.minDimension / 2f - 2.dp.toPx()
            drawCircle(
                color = ring,
                radius = radius,
                center = centre,
                style = Stroke(width = 1.5.dp.toPx())
            )
            drawLine(
                color = ring.copy(alpha = 0.5f),
                start = Offset(centre.x - radius * 0.55f, centre.y),
                end = Offset(centre.x + radius * 0.55f, centre.y),
                strokeWidth = 1.dp.toPx(),
                cap = StrokeCap.Round
            )
            drawLine(
                color = ring.copy(alpha = 0.5f),
                start = Offset(centre.x, centre.y - radius * 0.55f),
                end = Offset(centre.x, centre.y + radius * 0.55f),
                strokeWidth = 1.dp.toPx(),
                cap = StrokeCap.Round
            )
            drawCircle(
                color = accent.copy(alpha = if (dragging) 0.22f else 0.12f),
                radius = KNOB_RADIUS.toPx() * 1.6f,
                center = centre + knob
            )
            drawCircle(color = accent, radius = KNOB_RADIUS.toPx(), center = centre + knob)
        }
    }
}
