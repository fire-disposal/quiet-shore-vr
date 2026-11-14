package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Two horizons and one head, drawn small.
 *
 * The compensation is an angle, and an angle is easier to believe when you can
 * see the gap closing:
 *
 * - **grey** — the real world's horizon. Fixed, because the patient's room does
 *   not move.
 * - **ice** — the horizon of the scene as it is being placed right now. At
 *   `mix = 0` a room drawn for a standing eye sits on the ceiling, so this line
 *   is a quarter turn away from the grey one; every step of the correction
 *   closes the gap, and at full correction the two lines are one.
 * - **ink needle** — where the patient's head is actually pointing, from the
 *   headset's own pose. Only drawn when a pose is arriving.
 *
 * The gap is `(1 - mix) · 90°`: the documented one-quarter-turn correction for a
 * supine body, so the tablet never re-derives a rotation of its own.
 */
@Composable
fun PitchDial(
    headPitchDeg: Float?,
    gapDeg: Float,
    modifier: Modifier = Modifier
) {
    val gap = gapDeg.coerceIn(0f, 90f)
    val head = headPitchDeg?.coerceIn(-90f, 90f)
    val description = buildString {
        append("真实水平与虚拟水平相差 ")
        append(gap.roundToInt())
        append(" 度")
        if (head != null) {
            append("，患者俯仰 ")
            append(head.roundToInt())
            append(" 度")
        }
    }
    Canvas(
        modifier
            // A reading, not a target, but it shares the strip's baseline: 46 dp
            // sat a hairline under the 48 dp floor and the whole strip looked
            // slightly misaligned because of it.
            .height(TouchTarget)
            .semantics { contentDescription = description }
    ) {
        val cx = size.width * 0.5f
        val cy = size.height * 0.5f
        val reach = size.width * 0.42f
        val hairline = 1.dp.toPx()

        // Real world: the line everything else is measured against. Ink at a
        // quarter, not the hairline: on paper the hairline all but vanished and
        // the instrument looked like one line drawn twice.
        drawLine(
            color = QuietPalette.Ink.copy(alpha = 0.28f),
            start = Offset(cx - reach, cy),
            end = Offset(cx + reach, cy),
            strokeWidth = hairline * 1.5f
        )
        // The centre: the patient's eye.
        drawLine(
            color = QuietPalette.Hairline,
            start = Offset(cx, cy - 4.dp.toPx()),
            end = Offset(cx, cy + 4.dp.toPx()),
            strokeWidth = hairline
        )
        // Virtual world: a quarter turn of correction, closing as mix rises.
        val gapRad = Math.toRadians(gap.toDouble())
        drawLine(
            color = QuietPalette.Ice,
            start = Offset(cx, cy),
            end = Offset(
                cx + (reach * cos(gapRad)).toFloat(),
                cy - (reach * sin(gapRad)).toFloat()
            ),
            strokeWidth = 2.dp.toPx(),
            cap = StrokeCap.Square
        )
        // The patient's head, when a pose is arriving at all.
        if (head != null) {
            val headRad = Math.toRadians(head.toDouble())
            drawLine(
                color = QuietPalette.Ink,
                start = Offset(cx, cy),
                end = Offset(
                    cx + (reach * 0.72f * cos(headRad)).toFloat(),
                    cy - (reach * 0.72f * sin(headRad)).toFloat()
                ),
                strokeWidth = 2.5.dp.toPx(),
                cap = StrokeCap.Square
            )
        }
    }
}

/**
 * The dial plus the two angles it draws, as one readout line: the gap is the
 * number the operator is actually moving.
 */
@Composable
fun PitchReadout(
    headPitchDeg: Float?,
    gapDeg: Float,
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        PitchDial(
            headPitchDeg = if (stale) null else headPitchDeg,
            gapDeg = gapDeg,
            modifier = Modifier.width(104.dp)
        )
        Column {
            Fact(
                label = "俯仰",
                value = if (stale || headPitchDeg == null) "—" else "${headPitchDeg.roundToInt()}°"
            )
            Fact(
                // The number the operator is moving: how far the scene's own
                // horizon still is from the real one.
                label = "水平差",
                value = "${gapDeg.coerceIn(0f, 90f).roundToInt()}°"
            )
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = QuietPalette.InkSecondary,
            maxLines = 1,
            overflow = TextOverflow.Clip
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleSmall,
            color = QuietPalette.Ink,
            maxLines = 1
        )
    }
}
