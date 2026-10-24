package com.quietshore.control.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
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
 * Side elevation of the patient's head pitch.
 *
 * The corner dial answers "which way is the patient facing"; this one answers
 * "how much is the head tipped", which is the number the operator actually
 * corrects on a bed. Side view, hip as the pivot, head at the far end.
 */
@Composable
fun PitchSideGauge(
    pose: TelemetryPose?,
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    val pitchDeg = if (pose == null) 0.0 else pose.pitch * 180.0 / Math.PI
    val fresh = pose != null && !stale
    val accent = if (fresh) QuietPalette.Accent else QuietPalette.TextSecondary
    val label = if (pose == null) {
        "俯仰 —"
    } else {
        String.format(Locale.US, "俯仰 %+d°", pitchDeg.roundToInt())
    }

    Surface(
        modifier = modifier.semantics(mergeDescendants = true) {
            contentDescription = "患者俯仰侧视图，$label"
        },
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface.copy(alpha = 0.86f),
        contentColor = QuietPalette.TextPrimary
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text("患者俯仰", style = MaterialTheme.typography.labelLarge)
            Canvas(modifier = Modifier.size(width = 132.dp, height = 74.dp)) {
                val w = size.width
                val h = size.height
                val hip = Offset(w * 0.24f, h * 0.78f)
                val length = w * 0.56f

                // Level reference.
                drawLine(
                    color = QuietPalette.Outline,
                    start = Offset(0f, hip.y),
                    end = Offset(w, hip.y),
                    strokeWidth = 1.5f
                )

                // Body line + head, rotated by the head pitch (positive = up).
                rotate(degrees = -pitchDeg.toFloat(), pivot = hip) {
                    drawLine(
                        color = accent,
                        start = hip,
                        end = Offset(hip.x + length, hip.y),
                        strokeWidth = 5f,
                        cap = StrokeCap.Round
                    )
                    drawCircle(
                        color = accent,
                        radius = 7f,
                        center = Offset(hip.x + length, hip.y),
                        style = Stroke(width = 2.5f)
                    )
                }

                // Pivot.
                drawCircle(color = QuietPalette.TextSecondary, radius = 3f, center = hip)
            }
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = if (fresh) QuietPalette.TextPrimary else QuietPalette.Warning
            )
        }
    }
}
