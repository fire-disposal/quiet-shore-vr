package com.quietshore.control.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.Scenes
import com.quietshore.control.ui.theme.QuietPalette

@Composable
fun SceneCards(
    selectedId: String,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Scenes.all.chunked(2).forEach { rowScenes ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                rowScenes.forEach { scene ->
                    SceneCard(
                        label = scene.label,
                        selected = scene.id == selectedId,
                        enabled = enabled,
                        onClick = { onSelect(scene.id) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
private fun SceneCard(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(68.dp),
        enabled = enabled,
        shape = RoundedCornerShape(16.dp),
        color = if (selected) {
            QuietPalette.Primary.copy(alpha = 0.16f)
        } else {
            QuietPalette.SurfaceRaised
        },
        contentColor = if (selected) QuietPalette.Primary else QuietPalette.TextPrimary,
        border = if (selected) BorderStroke(1.dp, QuietPalette.Primary.copy(alpha = 0.6f)) else null
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            Text(label, style = MaterialTheme.typography.titleMedium)
        }
    }
}
