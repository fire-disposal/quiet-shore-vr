package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.Scenes
import com.quietshore.control.model.ViewMode
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.ControlRail
import com.quietshore.control.ui.components.SignalBars
import com.quietshore.control.ui.components.ViewModeToggle
import com.quietshore.control.ui.components.phaseColor
import com.quietshore.control.ui.components.phaseLabel
import com.quietshore.control.ui.theme.QuietPalette

@Composable
fun ControlScreen(
    state: ControlUiState,
    actions: ControlActions,
    viewport: @Composable (Modifier) -> Unit
) {
    val offline = state.phase == BlePhase.DISCONNECTED ||
        state.phase == BlePhase.ERROR ||
        state.phase == BlePhase.IDLE

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp)
    ) {
        ControlTopBar(state = state, onDisconnect = actions.onDisconnect)
        Spacer(Modifier.height(12.dp))
        if (offline) {
            DisconnectedBanner(
                onReconnect = actions.onReconnect,
                onLeave = actions.onLeave
            )
            Spacer(Modifier.height(12.dp))
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            ViewportPanel(
                state = state,
                onViewModeChange = actions.onViewModeChange,
                viewport = viewport,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
            )
            ControlRail(
                state = state,
                actions = actions,
                modifier = Modifier
                    .width(400.dp)
                    .fillMaxHeight()
            )
        }
    }
}

@Composable
private fun ControlTopBar(
    state: ControlUiState,
    onDisconnect: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "静岸控制台",
            style = MaterialTheme.typography.titleLarge,
            color = QuietPalette.TextPrimary
        )
        Spacer(Modifier.width(28.dp))
        Text(
            text = "静岸头显",
            style = MaterialTheme.typography.titleSmall,
            color = QuietPalette.TextPrimary
        )
        if (state.deviceSuffix.isNotEmpty()) {
            Spacer(Modifier.width(10.dp))
            Text(
                text = "尾号 ${state.deviceSuffix}",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
        }
        Spacer(Modifier.width(16.dp))
        SignalBars(rssi = state.rssi)
        state.rssi?.let { rssi ->
            Spacer(Modifier.width(8.dp))
            Text(
                text = "$rssi dBm",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
        }
        Spacer(Modifier.width(16.dp))
        ConnectionChip(phase = state.phase)
        Spacer(Modifier.weight(1f))
        TextButton(
            onClick = onDisconnect,
            enabled = state.phase.isConnected,
            colors = ButtonDefaults.textButtonColors(contentColor = QuietPalette.TextSecondary)
        ) {
            Text("断开")
        }
    }
}

@Composable
private fun DisconnectedBanner(
    onReconnect: () -> Unit,
    onLeave: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = QuietPalette.Danger.copy(alpha = 0.12f),
        contentColor = QuietPalette.Danger
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("头显已断开", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.weight(1f))
            TextButton(
                onClick = onReconnect,
                colors = ButtonDefaults.textButtonColors(contentColor = QuietPalette.Danger)
            ) {
                Text("重新连接")
            }
            TextButton(
                onClick = onLeave,
                colors = ButtonDefaults.textButtonColors(contentColor = QuietPalette.Danger)
            ) {
                Text("返回配对")
            }
        }
    }
}

@Composable
private fun ViewportPanel(
    state: ControlUiState,
    onViewModeChange: (ViewMode) -> Unit,
    viewport: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(24.dp))
            .background(QuietPalette.Viewport)
    ) {
        viewport(Modifier.fillMaxSize())

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OverlayPill(
                label = Scenes.label(state.control.scene),
                accent = QuietPalette.Primary
            )
            OverlayPill(
                label = phaseLabel(state.phase),
                accent = phaseColor(state.phase)
            )
        }

        ViewModeToggle(
            selected = state.viewMode,
            onSelect = onViewModeChange,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(20.dp)
                .width(340.dp)
        )

        PoseFreshness(
            stale = state.poseStale || state.pose == null,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(20.dp)
        )
    }
}

@Composable
private fun OverlayPill(
    label: String,
    accent: Color
) {
    Surface(
        shape = RoundedCornerShape(50),
        color = QuietPalette.Surface.copy(alpha = 0.78f),
        contentColor = QuietPalette.TextPrimary
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(accent)
            )
            Spacer(Modifier.width(8.dp))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun PoseFreshness(
    stale: Boolean,
    modifier: Modifier = Modifier
) {
    val color = if (stale) QuietPalette.Warning else QuietPalette.Success
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = QuietPalette.Surface.copy(alpha = 0.78f),
        contentColor = color
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (stale) "姿态未更新" else "实时",
                style = MaterialTheme.typography.labelLarge
            )
        }
    }
}
