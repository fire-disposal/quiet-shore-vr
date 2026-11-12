package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The four shipped scenes in one row, wire order, the current one filled with
 * ice and the rest on paper.
 *
 * It is the same component before and during a session: the only difference is
 * [enabled]. That is deliberate — the operator learns one strip and then finds
 * it in the same place mid-session, where it switches instantly and the mark
 * follows the headset's readback rather than the tap.
 */
@Composable
fun SceneStrip(
    current: String,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        for (scene in SceneCatalog.ALL) {
            SceneChip(
                label = scene.name,
                current = scene.id == current,
                enabled = enabled,
                onClick = { onSelect(scene.id) }
            )
            Spacer(Modifier.width(6.dp))
        }
    }
}

/**
 * One scene. The current one is an ice block under ink — the mark the panel's
 * leading edge also uses, said here as something the eye finds without reading.
 * A cut corner says "pressable"; nothing else on paper has a shape.
 */
@Composable
private fun SceneChip(
    label: String,
    current: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val shape = CutCornerShape(0.dp, 0.dp, 8.dp, 0.dp)
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = TouchTarget, minHeight = TouchTarget)
            .height(TouchTarget)
            .clip(shape)
            .background(if (current) QuietPalette.Ice else QuietPalette.Background)
            .semantics { selected = current }
            .clickable(
                enabled = enabled,
                role = Role.RadioButton,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (enabled || current) QuietPalette.TextPrimary else QuietPalette.Disabled,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
