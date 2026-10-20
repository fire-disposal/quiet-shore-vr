package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.EyeHeight
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.roundToInt

private val MIN_CM = (EyeHeight.MIN * 100f).roundToInt()
private val MAX_CM = (EyeHeight.MAX * 100f).roundToInt()
private val STEP_CM = (EyeHeight.STEP * 100f).roundToInt()

/**
 * Eye height belongs to the patient, so this is a deliberate tap stepper rather
 * than a slider: every press sends exactly one `settings:eyeheight:<m>` command.
 */
@Composable
fun EyeHeightStepper(
    meters: Float,
    enabled: Boolean,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val centimetres = (meters * 100f).roundToInt().coerceIn(MIN_CM, MAX_CM)
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        StepButton(
            increase = false,
            enabled = enabled && centimetres > MIN_CM,
            onClick = { onChange((centimetres - STEP_CM) / 100f) }
        )
        Column(
            modifier = Modifier.weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = String.format(Locale.US, "%.2f 米", centimetres / 100f),
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.TextPrimary
            )
            Text(
                text = String.format(Locale.US, "%.2f – %.2f 米", EyeHeight.MIN, EyeHeight.MAX),
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
        }
        StepButton(
            increase = true,
            enabled = enabled && centimetres < MAX_CM,
            onClick = { onChange((centimetres + STEP_CM) / 100f) }
        )
    }
}

@Composable
private fun StepButton(
    increase: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(52.dp),
        shape = RoundedCornerShape(14.dp),
        color = if (enabled) {
            QuietPalette.SurfaceRaised
        } else {
            QuietPalette.SurfaceRaised.copy(alpha = 0.4f)
        },
        contentColor = if (enabled) {
            QuietPalette.TextPrimary
        } else {
            QuietPalette.TextSecondary.copy(alpha = 0.5f)
        }
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = if (increase) Icons.Rounded.Add else Icons.Rounded.Remove,
                contentDescription = if (increase) "提高视点高度" else "降低视点高度",
                modifier = Modifier.size(20.dp)
            )
        }
    }
}
