package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette

/**
 * `−  2  +` — a value you can move one step and read without aiming.
 *
 * Used for the buoyancy level and anything else with a short ladder. A slider
 * would be wrong here: three levels on a 460 dp band is a target an operator
 * has to hunt for with a gloved hand, while a key is 48 dp of certainty. The
 * figure between the keys is the headset's applied value, not a local copy.
 */
@Composable
fun Stepper(
    value: String,
    onDecrement: () -> Unit,
    onIncrement: () -> Unit,
    modifier: Modifier = Modifier,
    canDecrement: Boolean = true,
    canIncrement: Boolean = true,
    description: String? = null
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Key(
            label = "−",
            onClick = onDecrement,
            enabled = canDecrement,
            minWidth = TouchTarget,
            modifier = Modifier.width(TouchTarget)
        )
        Spacer(Modifier.width(2.dp))
        NumberText(
            text = value,
            style = MaterialTheme.typography.titleMedium.tabularFigures(),
            modifier = Modifier
                .defaultMinSize(minWidth = 28.dp)
                .semantics {
                    if (description != null) contentDescription = description
                }
        )
        Spacer(Modifier.width(2.dp))
        Key(
            label = "+",
            onClick = onIncrement,
            enabled = canIncrement,
            minWidth = TouchTarget,
            modifier = Modifier.width(TouchTarget)
        )
    }
}

/** The label that sits left of a [Stepper]; same tier as the scene strip's. */
@Composable
fun StepperLabel(text: String) {
    androidx.compose.material3.Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = QuietPalette.TextSecondary,
        maxLines = 1
    )
}
