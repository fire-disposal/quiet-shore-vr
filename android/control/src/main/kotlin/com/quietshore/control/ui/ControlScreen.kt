package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.Scenes
import com.quietshore.control.model.ViewMode
import com.quietshore.control.ui.components.AngleGauge
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.ControlRail
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.RecordingChip
import com.quietshore.control.ui.components.RecordingNotice
import com.quietshore.control.ui.components.SignalBars
import com.quietshore.control.ui.components.StatusPanel
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
    // Keep the WebView alive when moving between the docked layout and the
    // fullscreen patient view; recreating it would reload the 3D scene.
    val viewportContent = remember {
        movableContentOf<Modifier> { modifier -> viewport(modifier) }
    }

    if (state.fullscreen) {
        FullscreenPatientView(state = state, actions = actions, viewport = viewportContent)
        return
    }

    val offline = state.phase == BlePhase.DISCONNECTED ||
        state.phase == BlePhase.ERROR ||
        state.phase == BlePhase.IDLE
    // A retrying reconnect passes through scanning/connecting; keep the
    // "reconnecting" banner until the link is READY or given up.
    val reconnecting = state.reconnectAttempt > 0 &&
        (state.phase == BlePhase.RECONNECTING ||
            state.phase == BlePhase.SCANNING ||
            state.phase == BlePhase.CONNECTING)

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
    ) {
        val compact = maxWidth < 1000.dp
        var controlsOpen by rememberSaveable { mutableStateOf(!compact) }
        var infoOpen by rememberSaveable { mutableStateOf(false) }
        val railWidth = if (compact) minOf(320.dp, maxWidth * 0.84f) else 380.dp
        // Banners and notices live in the same top band as the rail; inset
        // them so the rail cannot cover their recovery actions.
        val railOverlayInset = if (controlsOpen) railWidth + 14.dp else 0.dp

        Box(Modifier.fillMaxSize()) {
            viewportContent(Modifier.fillMaxSize())

            ControlTopBar(
                state = state,
                compact = compact,
                controlsOpen = controlsOpen,
                infoOpen = infoOpen,
                onToggleControls = { controlsOpen = !controlsOpen },
                onToggleInfo = { infoOpen = !infoOpen },
                onDisconnect = actions.onDisconnect,
                onStartRecording = actions.onStartRecording,
                onStopRecording = actions.onStopRecording
            )

            if (infoOpen) {
                StatusPanel(
                    state = state,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(
                            start = if (compact) 10.dp else 16.dp,
                            top = if (compact) 78.dp else 82.dp
                        )
                        .width(if (compact) 300.dp else 360.dp)
                )
            }

            if (reconnecting) {
                ReconnectingBanner(
                    attempt = state.reconnectAttempt,
                    max = state.reconnectMax,
                    onLeave = actions.onLeave,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(
                            top = if (compact) 78.dp else 82.dp,
                            end = railOverlayInset
                        )
                )
            } else if (offline) {
                DisconnectedBanner(
                    onReconnect = actions.onReconnect,
                    onLeave = actions.onLeave,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(
                            top = if (compact) 78.dp else 82.dp,
                            end = railOverlayInset
                        )
                )
            }

            if (controlsOpen) {
                ControlRail(
                    state = state,
                    actions = actions,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = if (compact) 78.dp else 82.dp, end = 14.dp, bottom = 14.dp)
                        .width(railWidth)
                        .fillMaxHeight()
                )
            }

            // Patient/global mirror mode plus the fullscreen entry. This is
            // the only way into the headset view besides tapping it there.
            ViewportControls(
                state = state,
                onViewModeChange = actions.onViewModeChange,
                onFullscreen = { actions.onFullscreenChange(true) },
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 14.dp, bottom = 14.dp)
            )

            RecordingNotice(
                state = state,
                onShare = actions.onShareRecording,
                onDismiss = actions.onDismissRecording,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(
                        top = (if (compact) 78.dp else 82.dp) +
                            if (reconnecting || offline) 58.dp else 0.dp,
                        end = railOverlayInset
                    )
            )

            // Read-only heading readout: a corner badge, never a touch target.
            AngleGauge(
                pose = state.pose,
                stale = state.poseStale,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 14.dp, bottom = 84.dp)
            )
        }
    }
}

@Composable
private fun ViewportControls(
    state: ControlUiState,
    onViewModeChange: (ViewMode) -> Unit,
    onFullscreen: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ViewModeToggle(
            selected = state.viewMode,
            onSelect = onViewModeChange,
            modifier = Modifier.width(300.dp)
        )
        Surface(
            shape = RoundedCornerShape(50),
            color = QuietPalette.Surface.copy(alpha = 0.86f),
            contentColor = QuietPalette.TextPrimary
        ) {
            TextButton(onClick = onFullscreen) {
                Text("全屏", color = QuietPalette.TextPrimary)
            }
        }
    }
}

@Composable
private fun FullscreenPatientView(
    state: ControlUiState,
    actions: ControlActions,
    viewport: @Composable (Modifier) -> Unit
) {
    BackHandler { actions.onFullscreenChange(false) }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Viewport)
    ) {
        viewport(Modifier.fillMaxSize())
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(18.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
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
        Surface(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(10.dp),
            shape = RoundedCornerShape(50),
            color = QuietPalette.Background.copy(alpha = 0.92f),
            contentColor = QuietPalette.TextPrimary
        ) {
            Row(
                modifier = Modifier.padding(start = 8.dp, end = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RecordingChip(
                    state = state,
                    onStart = actions.onStartRecording,
                    onStop = actions.onStopRecording
                )
                TextButton(onClick = { actions.onFullscreenChange(false) }) {
                    Text("退出全屏", color = QuietPalette.TextPrimary)
                }
            }
        }
        AngleGauge(
            pose = state.pose,
            stale = state.poseStale,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 78.dp, end = 14.dp)
        )
        ViewModeToggle(
            selected = state.viewMode,
            onSelect = actions.onViewModeChange,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(18.dp)
                .width(320.dp)
        )
        RecordingNotice(
            state = state,
            onShare = actions.onShareRecording,
            onDismiss = actions.onDismissRecording,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 16.dp)
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(18.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            PoseFreshness(stale = state.poseStale || state.pose == null)
        }
    }
}

@Composable
private fun ControlTopBar(
    state: ControlUiState,
    compact: Boolean,
    controlsOpen: Boolean,
    infoOpen: Boolean,
    onToggleControls: () -> Unit,
    onToggleInfo: () -> Unit,
    onDisconnect: () -> Unit,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = if (compact) 10.dp else 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(14.dp),
        color = QuietPalette.Background.copy(alpha = 0.92f),
        contentColor = QuietPalette.TextPrimary
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier
                    .clickable { onToggleInfo() }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "静岸控制台",
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.TextPrimary
                )
                if (!compact) {
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = "静岸头显",
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.TextSecondary
                    )
                    if (state.deviceSuffix.isNotEmpty()) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "尾号 ${state.deviceSuffix}",
                            style = MaterialTheme.typography.bodySmall,
                            color = QuietPalette.TextSecondary
                        )
                    }
                }
                Spacer(Modifier.width(if (compact) 8.dp else 12.dp))
                SignalBars(rssi = state.rssi)
                Spacer(Modifier.width(8.dp))
                ConnectionChip(phase = state.phase)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (infoOpen) "▾" else "▸",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            Spacer(Modifier.weight(1f))
            RecordingChip(
                state = state,
                onStart = onStartRecording,
                onStop = onStopRecording
            )
            TextButton(onClick = onToggleControls) {
                Text(if (controlsOpen) "收起" else "控制", color = QuietPalette.TextPrimary)
            }
            TextButton(
                onClick = onDisconnect,
                enabled = state.phase.isConnected,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = QuietPalette.TextSecondary,
                    disabledContentColor = QuietPalette.Outline
                )
            ) {
                Text("断开")
            }
        }
    }
}

@Composable
private fun DisconnectedBanner(
    onReconnect: () -> Unit,
    onLeave: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
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
private fun ReconnectingBanner(
    attempt: Int,
    max: Int,
    onLeave: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = QuietPalette.Warning.copy(alpha = 0.14f),
        contentColor = QuietPalette.Warning
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            LoadingDots(color = QuietPalette.Warning)
            Spacer(Modifier.width(12.dp))
            Text(
                text = "连接中断，正在重连（${attempt.coerceAtLeast(1)}/${max.coerceAtLeast(1)}）",
                style = MaterialTheme.typography.titleSmall
            )
            Spacer(Modifier.weight(1f))
            TextButton(
                onClick = onLeave,
                colors = ButtonDefaults.textButtonColors(contentColor = QuietPalette.Warning)
            ) {
                Text("返回配对")
            }
        }
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
