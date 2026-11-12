package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.TelemetryPose
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Read-only heading dial for the patient pose.
 *
 * The ring is a compass with a needle for yaw, the crosshair is the level
 * reference, and the bubble slides up or down with pitch. Nothing here is
 * interactive: it is a corner readout and must never eat viewport gestures.
 * It carries no fill and no box — a figure printed on the paper.
 */
@Composable
fun AngleGauge(
    pose: TelemetryPose?,
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    val current = pose
    val fresh = current != null && !stale
    val description = if (current != null && !stale) {
        String.format(
            Locale.US,
            "患者朝向，偏航 %d 度，俯仰 %d 度",
            degrees(current.yaw).roundToInt(),
            degrees(current.pitch).roundToInt()
        )
    } else {
        "患者朝向未更新"
    }

    Row(
        modifier = modifier
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AngleDial(pose = pose, fresh = fresh)
        // No header word: the two rows are already labelled, and "朝向" over
        // them was a third name for the same reading.
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = angleLine("偏航", pose?.let { degrees(it.yaw) }, fresh),
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.TextPrimary
            )
            Text(
                text = angleLine("俯仰", pose?.let { degrees(it.pitch) }, fresh),
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.TextPrimary
            )
        }
    }
}

/**
 * The dial is drawn in ink, not in the accent: a heading is a reading, not a
 * state and not a press. The needle is a thin wedge with an ink outline, the
 * frame and reference lines are the same hairline that divides the page, and
 * the only non-ink mark is the empty centre that says "no data yet".
 */
@Composable
private fun AngleDial(pose: TelemetryPose?, fresh: Boolean) {
    Canvas(modifier = Modifier.size(72.dp)) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val radius = size.minDimension / 2f - 2.dp.toPx()
        val inner = radius * 0.7f
        val ring = if (fresh) QuietPalette.InkSecondary else QuietPalette.Hairline

        // Fixed frame: outer ring, level reference, and the crest line.
        drawCircle(color = ring, radius = radius, center = center, style = Stroke(width = 1.dp.toPx()))
        drawLine(
            color = QuietPalette.InkSecondary.copy(alpha = 0.55f),
            start = Offset(center.x - inner, center.y),
            end = Offset(center.x + inner, center.y),
            strokeWidth = 1.dp.toPx()
        )
        drawLine(
            color = QuietPalette.InkSecondary.copy(alpha = 0.55f),
            start = Offset(center.x, center.y - inner),
            end = Offset(center.x, center.y + inner),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))
        )

        if (!fresh || pose == null) {
            // Stale: a hollow centre and no needle. An old heading is worse
            // than none.
            drawCircle(
                color = QuietPalette.InkSecondary,
                radius = radius * 0.16f,
                center = center,
                style = Stroke(width = 1.dp.toPx())
            )
            return@Canvas
        }

        // Three.js Y rotation is counter-clockwise seen from above; Canvas
        // rotate() is clockwise, so negate to match the 3D patient marker.
        rotate(degrees = -degrees(pose.yaw), pivot = center) {
            val tip = Offset(center.x, center.y - radius * 0.82f)
            val path = Path().apply {
                moveTo(tip.x, tip.y)
                lineTo(center.x - 5.dp.toPx(), center.y + 4.dp.toPx())
                lineTo(center.x + 5.dp.toPx(), center.y + 4.dp.toPx())
                close()
            }
            drawPath(path, color = QuietPalette.Board)
            drawPath(path, color = QuietPalette.TextPrimary, style = Stroke(width = 1.5.dp.toPx()))
        }

        // Pitch bubble: ink, so it reads as a number rather than a highlight.
        val pitchOffset = (degrees(pose.pitch) / PITCH_FULL_SCALE_DEGREES).coerceIn(-1f, 1f)
        drawCircle(
            color = QuietPalette.TextPrimary,
            radius = 3.dp.toPx(),
            center = Offset(center.x, center.y - pitchOffset * inner)
        )
    }
}

/** Wire pose is radians; every visible angle is degrees. */
private fun degrees(radians: Float): Float =
    Math.toDegrees(radians.toDouble()).toFloat()

private fun angleLine(label: String, value: Float?, fresh: Boolean): String =
    if (!fresh || value == null) "$label —" else String.format(Locale.US, "%s %d°", label, value.roundToInt())

/** Pitch is clamped to the dial edge at this angle. */
private const val PITCH_FULL_SCALE_DEGREES = 60f
