package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette

/**
 * One figure: the number, its label underneath, its unit on the same line.
 *
 * ```text
 *   04:12
 *   时长            进行中
 * ```
 *
 * The number is the only thing at display size on the whole console, so it has
 * to be a real reading — tabular, never re-derived here, never a placeholder.
 * [primary] marks the one figure the session is really about (time); the rest
 * step down one size so the board reads as a hierarchy and not as four rivals.
 */
@Composable
fun Readout(
    label: String,
    value: String,
    unit: String,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    valueColor: androidx.compose.ui.graphics.Color = QuietPalette.TextPrimary
) {
    Column(modifier) {
        NumberText(
            text = value,
            style = if (primary) {
                MaterialTheme.typography.displayMedium
            } else {
                MaterialTheme.typography.displaySmall
            },
            color = valueColor
        )
        Spacer(Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = QuietPalette.TextSecondary,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = unit,
                style = MaterialTheme.typography.bodySmall.tabularFigures(),
                color = QuietPalette.TextSecondary,
                maxLines = 1
            )
        }
    }
}

/** The board's only division: a short hairline between two figures. */
@Composable
fun ReadoutDivider() {
    Box(
        Modifier
            .padding(horizontal = 16.dp)
            .width(1.dp)
            .height(56.dp)
            .fillMaxHeight(0.72f)
            .background(QuietPalette.Hairline)
    )
}
