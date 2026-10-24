package com.quietshore.control.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.ui.theme.QuietPalette

/**
 * Scene page.
 *
 * The operator picks the scene here, before a session; the headset stores it as
 * the launch parameter and forwards it to the page, so the patient never
 * chooses anything. The list comes from the protocol's shipped scenes, not from
 * a copy kept in the UI — `SCENE_LABELS` and `SCENE_IDS` are the single source
 * for both ends.
 */
@Composable
fun ScenePage(
    selectedScene: String,
    sessionRunning: Boolean,
    enabled: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Surface,
        contentColor = QuietPalette.TextPrimary
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("场景", style = MaterialTheme.typography.titleMedium)
            Text(
                text = if (sessionRunning) {
                    "训练中不可切换场景；结束后再换"
                } else {
                    "选好场景后按“启动训练”，患者只需戴好后按一次确认键"
                },
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
            for ((id, label) in ControlProtocol.SCENE_LABELS) {
                val selected = id == selectedScene
                val selectable = enabled && !sessionRunning
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            enabled = selectable,
                            onClick = { onSelect(id) }
                        ),
                    shape = RoundedCornerShape(10.dp),
                    color = if (selected) {
                        QuietPalette.Primary.copy(alpha = 0.12f)
                    } else {
                        QuietPalette.SurfaceRaised
                    },
                    border = BorderStroke(
                        if (selected) 2.dp else 1.dp,
                        if (selected) QuietPalette.Primary else QuietPalette.Outline
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(label, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = if (selected) "已选" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.Primary
                        )
                    }
                }
            }
        }
    }
}
