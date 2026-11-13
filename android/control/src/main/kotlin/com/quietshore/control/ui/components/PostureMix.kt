package com.quietshore.control.ui.components

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
 * The correction as one draggable bar, 0 % → 100 %.
 *
 * 0 % is the real world: the ceiling is the patient's real ceiling and the room
 * only turns to their heading. 100 % is the scene's authored standing view.
 * Everything between is the pitch correction itself — the same scalar lifts the
 * eye, so the bar is the whole posture story in one number.
 *
 * Two values are on screen, and the difference between them is the design:
 * the **fill** is the applied mix (the headset's readback) and the **handle** is
 * where the hand is. A drag sets targets that the page follows under its own
 * speed cap, so the handle runs ahead of the world by design; on release the
 * handle falls back onto the readback and they agree again.
 *
 * The bar is also the manual override: the first sample of a drag freezes
 * whatever the correction was doing (page contract), so a hand on this bar
 * always wins over a running ramp.
 */
@Composable
fun PostureMixBar(
    applied: Float,
    enabled: Boolean,
    onTarget: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var local by remember { mutableFloatStateOf(0f) }
    val shown = if (dragging) local else applied.coerceIn(0f, 1f)
    val percent = (applied.coerceIn(0f, 1f) * 100f).roundToInt()

    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .alpha(if (enabled) 1f else 0.35f)
            .semantics { contentDescription = "体位补偿 $percent%" }
            // Tap to place, drag to sweep. Two detectors, one bar: a tap that
            // never leaves the slop would otherwise do nothing at all.
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures { offset ->
                    local = (offset.x / size.width).coerceIn(0f, 1f)
                    onTarget((local * 100f).roundToInt())
                }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectDragGestures(
                    onDragStart = { offset ->
                        dragging = true
                        local = (offset.x / size.width).coerceIn(0f, 1f)
                        onTarget((local * 100f).roundToInt())
                    },
                    onDragCancel = { dragging = false },
                    onDragEnd = { dragging = false }
                ) { change, drag ->
                    change.consume()
                    local = (local + drag.x / size.width).coerceIn(0f, 1f)
                    onTarget((local * 100f).roundToInt())
                }
            }
            .drawBehind {
                val midY = size.height / 2f
                val headX = (size.width * shown).coerceIn(0f, size.width)
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
                drawRect(
                    color = QuietPalette.Ink,
                    topLeft = Offset(headX - 1.5.dp.toPx(), midY - 15.dp.toPx()),
                    size = Size(3.dp.toPx(), 30.dp.toPx())
                )
            }
    )
}
