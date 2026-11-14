package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import kotlin.math.roundToInt

/**
 * The heave as a percentage of the envelope, 0–100 %, capped by the scene.
 *
 * Continuous: the intensity is an amplitude, not a ladder, so the fill follows
 * the finger and the value is printed as a percent. The quarter marks stay as
 * bearings — 25 / 50 / 75 % is how an operator describes the amount out loud —
 * but they are marks, not stops.
 */
@Composable
fun HeaveBar(
    percent: Int,
    cap: Int,
    enabled: Boolean,
    onPercent: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val ceiling = cap.coerceIn(0, 100)
    var dragging by remember { mutableStateOf(false) }
    var local by remember { mutableFloatStateOf(0f) }
    val applied = percent.coerceIn(0, 100) / 100f
    val shown = if (dragging) local else applied

    Box(
        modifier
            .fillMaxWidth()
            // The *touch* surface is the whole band, not the 5 dp ink: at 44 dp
            // a fingertip aimed at the handle had 13 dp of tolerance above and
            // below it, and the session's main continuous control was the least
            // forgiving target on the page.
            .height(TouchTarget)
            .alpha(if (enabled) 1f else 0.35f)
            .semantics { contentDescription = "起伏 $percent%，本场景上限 $ceiling%" }
            .pointerInput(enabled, ceiling) {
                if (!enabled) return@pointerInput
                detectTapGestures { offset ->
                    local = (offset.x / size.width).coerceIn(0f, 1f)
                    onPercent(toPercent(local, ceiling))
                }
            }
            .pointerInput(enabled, ceiling) {
                if (!enabled) return@pointerInput
                detectDragGestures(
                    onDragStart = { offset ->
                        dragging = true
                        local = (offset.x / size.width).coerceIn(0f, 1f)
                        onPercent(toPercent(local, ceiling))
                    },
                    onDragCancel = { dragging = false },
                    onDragEnd = { dragging = false }
                ) { change, drag ->
                    change.consume()
                    local = (local + drag.x / size.width).coerceIn(0f, 1f)
                    onPercent(toPercent(local, ceiling))
                }
            }
            .drawBehind {
                val midY = size.height / 2f
                val headX = size.width * shown
                drawLine(
                    color = QuietPalette.Hairline,
                    start = Offset(0f, midY),
                    end = Offset(size.width, midY),
                    strokeWidth = 1.5.dp.toPx()
                )
                drawLine(
                    color = QuietPalette.Ice,
                    start = Offset(0f, midY),
                    end = Offset(headX, midY),
                    strokeWidth = 5.dp.toPx()
                )
                // Quarter marks as bearings, not stops.
                for (mark in 1..3) {
                    val x = size.width * mark / 4f
                    drawRect(
                        color = QuietPalette.Hairline,
                        topLeft = Offset(x - 0.5.dp.toPx(), midY - 8.dp.toPx()),
                        size = Size(1.dp.toPx(), 16.dp.toPx())
                    )
                }
                drawRect(
                    color = QuietPalette.Ink,
                    topLeft = Offset(headX - 1.5.dp.toPx(), midY - 13.dp.toPx()),
                    size = Size(3.dp.toPx(), 26.dp.toPx())
                )
            }
    )
}

/** A 0..1 position as a whole percent, never above the scene's own ceiling. */
private fun toPercent(position: Float, ceiling: Int): Int =
    (position.coerceIn(0f, 1f) * 100).roundToInt().coerceIn(0, ceiling)

/**
 * A plain level, 0–100 %: volume, not intensity.
 *
 * Same gesture and drawing as [HeaveBar] — one finger, one fill, one handle —
 * but with no ceiling and no quarter marks: a volume has neither a scene cap
 * nor bearings worth printing.
 */
@Composable
fun LevelBar(
    percent: Int,
    enabled: Boolean,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var local by remember { mutableFloatStateOf(0f) }
    val applied = percent.coerceIn(0, 100) / 100f
    val shown = if (dragging) local else applied

    Box(
        modifier
            // Same rule as the heave band: the band is the target. The 4 dp line
            // is the reading; 32 dp of it could not be hit while talking.
            .height(TouchTarget)
            .alpha(if (enabled) 1f else 0.35f)
            .semantics { contentDescription = "音量 $percent%" }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures { offset ->
                    local = (offset.x / size.width).coerceIn(0f, 1f)
                    onChange((local * 100).roundToInt())
                }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectDragGestures(
                    onDragStart = { offset ->
                        dragging = true
                        local = (offset.x / size.width).coerceIn(0f, 1f)
                        onChange((local * 100).roundToInt())
                    },
                    onDragCancel = { dragging = false },
                    onDragEnd = { dragging = false }
                ) { change, drag ->
                    change.consume()
                    local = (local + drag.x / size.width).coerceIn(0f, 1f)
                    onChange((local * 100).roundToInt())
                }
            }
            .drawBehind {
                val midY = size.height / 2f
                val headX = size.width * shown
                drawLine(
                    color = QuietPalette.Hairline,
                    start = Offset(0f, midY),
                    end = Offset(size.width, midY),
                    strokeWidth = 1.5.dp.toPx()
                )
                drawLine(
                    color = QuietPalette.Ice,
                    start = Offset(0f, midY),
                    end = Offset(headX, midY),
                    strokeWidth = 4.dp.toPx()
                )
                drawRect(
                    color = QuietPalette.Ink,
                    topLeft = Offset(headX - 1.5.dp.toPx(), midY - 9.dp.toPx()),
                    size = Size(3.dp.toPx(), 18.dp.toPx())
                )
            }
    )
}
