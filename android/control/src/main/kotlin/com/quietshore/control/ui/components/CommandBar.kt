package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.MirrorMode
import com.quietshore.control.model.SceneCatalog
import com.quietshore.control.ui.theme.QuietPalette

/** Bar height: 72 dp for status and scene, 52 dp for the tab rail. */
val CommandBarHeight = 72.dp

/** The four panels, in the order the session walks through them. */
val TABS: List<Pair<String, String>> = listOf(
    "MOTION" to "控制",
    "SCENE" to "场景",
    "VOICE" to "语音",
    "SUS" to "SUS"
)

/**
 * The dark command bar: the only dark surface in the console, and the only
 * place ice may be text.
 *
 * It carries the facts that must never scroll — the link, which scene is
 * running, whether a session is up — plus the stop, which is outside every
 * scrolling container on purpose. The tab rail sits under it and stays put.
 */
@Composable
fun CommandBar(
    state: ControlUiState,
    tab: String,
    onSelect: (String) -> Unit,
    onMirrorModeChange: (MirrorMode) -> Unit,
    onOpenInfo: () -> Unit,
    onDisconnect: () -> Unit,
    onEmergencyStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    val sceneName = SceneCatalog.scene(state.control.scene)?.name ?: state.control.scene
    val attention = phaseNeedsAttention(state.phase, state.stateStale)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Bar)
            .padding(start = 20.dp, end = 12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(CommandBarHeight),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PresenceMark(presenceOf(state.phase, state.stateStale), onBar = true)
            Spacer(Modifier.width(10.dp))
            Text(
                text = phaseLabel(state.phase, state.stateStale),
                style = MaterialTheme.typography.labelLarge,
                color = if (attention) QuietPalette.Ice else QuietPalette.OnBar,
                maxLines = 1
            )
            if (state.deviceSuffix.isNotEmpty()) {
                Spacer(Modifier.width(10.dp))
                Text(
                    text = state.deviceSuffix,
                    style = MaterialTheme.typography.labelLarge.tabularFigures(),
                    color = QuietPalette.OnBarSecondary,
                    maxLines = 1
                )
            }
            BarHairline()
            // The scene the patient is living inside right now.
            Text(
                text = sceneName,
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.OnBar,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = if (state.control.session) "会话中" else "未开始",
                style = MaterialTheme.typography.labelSmall,
                color = QuietPalette.OnBarSecondary,
                maxLines = 1
            )
            Spacer(Modifier.weight(1f))
            BarKey("说明", onOpenInfo)
            BarKey("断开", onDisconnect, enabled = state.phase.isConnected)
            Spacer(Modifier.width(8.dp))
            StopKey(enabled = state.control.session, onClick = onEmergencyStop)
        }

        // Rail: four tabs from the left, camera choice from the right, both on
        // the same underline. Each tab owns its own click box.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            for ((key, label) in TABS) {
                BarTab(
                    label = label,
                    selected = tab == key,
                    onClick = { onSelect(key) }
                )
                Spacer(Modifier.width(4.dp))
            }
            Spacer(Modifier.weight(1f))
            for (option in MirrorMode.entries) {
                BarTab(
                    label = option.label,
                    selected = state.mirrorMode == option,
                    onClick = { onMirrorModeChange(option) }
                )
                Spacer(Modifier.width(4.dp))
            }
        }
    }
}

/**
 * A tab: secondary ink, and an ice underline that marks the one on screen.
 * The underline is the selection mark — no pill, no fill, no moving indicator.
 */
@Composable
private fun BarTab(
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .defaultMinSize(minWidth = 72.dp, minHeight = 48.dp)
            .semantics { this.selected = selected }
            .clickable(
                role = Role.Tab,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Bottom
    ) {
        Box(
            modifier = Modifier.height(46.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) QuietPalette.OnBar else QuietPalette.OnBarSecondary,
                fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                maxLines = 1,
                modifier = Modifier.padding(horizontal = 12.dp)
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(if (selected) QuietPalette.Ice else QuietPalette.Bar)
        )
    }
}

/** A word key on the bar: secondary ink, no box. */
@Composable
private fun BarKey(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true
) {
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 64.dp, minHeight = 48.dp)
            .clickable(
                enabled = enabled,
                role = Role.Button,
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
            color = if (enabled) QuietPalette.OnBarSecondary else QuietPalette.OnBarDisabled,
            maxLines = 1
        )
    }
}

/**
 * The stop: 48 dp tall, ice field with ink text while a session runs, plain
 * bar when there is nothing to stop. It never moves, never hides inside a
 * scroll container, and never needs a second tap.
 */
@Composable
private fun StopKey(enabled: Boolean, onClick: () -> Unit) {
    val shape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 104.dp, minHeight = 48.dp)
            .height(48.dp)
            .clip(shape)
            .background(if (enabled) QuietPalette.Ice else QuietPalette.Bar)
            .clickable(
                enabled = enabled,
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "急停",
            style = MaterialTheme.typography.labelLarge,
            color = if (enabled) QuietPalette.TextPrimary else QuietPalette.OnBarDisabled,
            maxLines = 1
        )
    }
}

/** A 1 dp vertical rule inside the bar. */
@Composable
private fun BarHairline() {
    Box(
        Modifier
            .padding(horizontal = 16.dp)
            .width(1.dp)
            .height(20.dp)
            .background(QuietPalette.OnBarHairline)
    )
}
