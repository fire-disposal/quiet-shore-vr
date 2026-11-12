package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The console's four faces, in a left rail.
 *
 * A bottom bar on a 10" landscape tablet wastes the one dimension that is short
 * (height) and puts the targets where a hand holding the tablet cannot reach
 * without moving it. A left rail uses the width the page already has, keeps the
 * labels in a column that reads top-to-bottom like the procedure itself, and —
 * because it scrolls — it survives a short window without clipping.
 */
enum class ConsoleSection(val label: String, val latin: String) {
    Session("会话", "SESSION"),
    Scene("场景", "SCENE"),
    Voice("语音", "VOICE")
}

/** Width of the rail: Latin eyebrow + Chinese label, one column each. */
val RailWidth = 132.dp

@Composable
fun ConsoleRail(
    current: ConsoleSection,
    onSelect: (ConsoleSection) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(RailWidth)
            .background(QuietPalette.Board)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp, horizontal = 8.dp)
            .semantics { role = Role.Tab }
    ) {
        for (section in ConsoleSection.entries) {
            RailItem(
                section = section,
                selected = section == current,
                onClick = { onSelect(section) }
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun RailItem(
    section: ConsoleSection,
    selected: Boolean,
    onClick: () -> Unit
) {
    val shape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(shape)
            .background(if (selected) QuietPalette.Ice else QuietPalette.Board)
            .then(
                if (selected) Modifier else Modifier
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Tab,
                onClick = onClick
            )
            .semantics { this.selected = selected }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = section.latin,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) QuietPalette.Ink else QuietPalette.InkSecondary,
            maxLines = 1,
            overflow = TextOverflow.Clip
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = section.label,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            color = QuietPalette.Ink,
            maxLines = 1
        )
    }
}

/** Hairline between the rail and the page; the rail is chrome, not content. */
@Composable
fun RailRule() {
    androidx.compose.foundation.layout.Box(
        Modifier
            .fillMaxHeight()
            .width(1.dp)
            .background(QuietPalette.Hairline)
    )
}

/** Spacing used between a rail and the page it belongs to. */
val RailGap = QuietSpace.Row
