package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The four top destinations, in the order a session is run.
 *
 * `连接` is deliberately not one of them: pairing is the screen you see before
 * the console exists, and once a headset is claimed there is no reason to go
 * back to it. Putting it in the bar would add a destination nobody visits.
 */
enum class ConsoleTab(val label: String, val latin: String) {
    Session("会话", "SESSION"),
    Scene("场景", "SCENE"),
    Voice("语音", "VOICE"),
    Scale("量表", "SCALE")
}

/** Bar height: a 56 dp target plus the bar's own margin. */
val TabBarHeight = 68.dp

/**
 * The bottom bar: flat paper, one hairline on top, no shadow and no floating
 * pill. The current destination is an ice block under ink with a cut corner —
 * the same "this is the current one" mark the scene cards use — plus medium
 * weight, so it survives being looked at in one colour.
 *
 * It carries no emergency stop: the stop lives in the app bar, above every
 * destination, and must be in the same place whether this bar exists or not.
 */
@Composable
fun ConsoleTabBar(
    current: ConsoleTab,
    onSelect: (ConsoleTab) -> Unit,
    modifier: Modifier = Modifier,
    /** A count for the scale's unanswered items; null draws nothing. */
    scaleBadge: String? = null
) {
    Column(modifier.fillMaxWidth().background(QuietPalette.Board)) {
        Rule()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(TabBarHeight),
            verticalAlignment = Alignment.CenterVertically
        ) {
            for (tab in ConsoleTab.entries) {
                TabItem(
                    tab = tab,
                    selected = tab == current,
                    badge = if (tab == ConsoleTab.Scale) scaleBadge else null,
                    onClick = { onSelect(tab) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun TabItem(
    tab: ConsoleTab,
    selected: Boolean,
    badge: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val shape = CutCornerShape(0.dp, 0.dp, 12.dp, 0.dp)
    Box(
        modifier = modifier
            .fillMaxHeight()
            .padding(horizontal = 6.dp, vertical = 8.dp)
            .clip(shape)
            .background(if (selected) QuietPalette.Ice else QuietPalette.Board)
            .semantics { this.selected = selected }
            .clickable(
                role = Role.Tab,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Latin cap over the Chinese name: the skill's pairing, and the
            // one place in the bar where the label is allowed to be small.
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = tab.latin,
                    style = MaterialTheme.typography.labelSmall,
                    color = QuietPalette.InkSecondary,
                    maxLines = 1
                )
                Text(
                    text = tab.label,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                    color = QuietPalette.Ink,
                    maxLines = 1
                )
            }
            if (badge != null) {
                Spacer(Modifier.width(8.dp))
                Text(
                    text = badge,
                    style = MaterialTheme.typography.bodySmall.tabularFigures(),
                    color = QuietPalette.InkSecondary,
                    maxLines = 1
                )
            }
        }
    }
}

/**
 * Where the app opens: the bench before a session, the monitor during one.
 * A destination the operator picked by hand wins over this default.
 */
fun defaultTab(state: ControlUiState, phase: SessionPhase): ConsoleTab =
    when {
        phase.inSession -> ConsoleTab.Session
        state.phase != BlePhase.READY -> ConsoleTab.Scene
        else -> ConsoleTab.Scene
    }
