package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.components.AngleGauge
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.ControlPanel
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.SceneMirror
import com.quietshore.control.ui.components.ScenePage
import com.quietshore.control.ui.components.SignalBars
import com.quietshore.control.ui.components.StatusPanel
import com.quietshore.control.ui.components.SusPanel
import com.quietshore.control.ui.components.VoicePanel
import com.quietshore.control.ui.theme.QuietPalette

@Composable
fun ControlScreen(
    state: ControlUiState,
    actions: ControlActions
) {
    val offline = state.phase == BlePhase.DISCONNECTED ||
        state.phase == BlePhase.ERROR ||
        state.phase == BlePhase.IDLE
    // A retrying reconnect passes through scanning/connecting; keep the
    // "reconnecting" banner until the link is READY or given up.
    val reconnecting = state.reconnectAttempt > 0 &&
        (state.phase == BlePhase.RECONNECTING ||
            state.phase == BlePhase.SCANNING ||
            state.phase == BlePhase.CONNECTING)

    // Panel selection lives above the layout so a constraint change (rotation,
    // window resize) cannot reset or drop the visible panel.
    var tab by rememberSaveable { mutableStateOf(PanelTab.MOTION) }
    var infoOpen by rememberSaveable { mutableStateOf(false) }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
    ) {
        val compact = maxWidth < 1000.dp
        val railWidth = if (compact) minOf(320.dp, maxWidth * 0.84f) else 380.dp
        val voiceWidth = if (compact) minOf(360.dp, maxWidth * 0.92f) else 420.dp
        val panelWidth = if (tab == PanelTab.VOICE) voiceWidth else railWidth
        val railOverlayInset = panelWidth + 14.dp

        Box(Modifier.fillMaxSize()) {
            // Bottom layer: the scene mirror. Every control surface is drawn
            // after it, so the top-left status panel is never covered.
            run {
                SceneMirror(
                    state = state,
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(
                            start = if (compact) 10.dp else 16.dp,
                            top = if (compact) 78.dp else 82.dp,
                            end = railOverlayInset + 14.dp,
                            bottom = 14.dp
                        )
                        .clip(RoundedCornerShape(14.dp))
                )
            }

            ControlTopBar(
                state = state,
                compact = compact,
                infoOpen = infoOpen,
                tab = tab,
                onSelectTab = { tab = it },
                onToggleInfo = { infoOpen = !infoOpen },
                onDisconnect = actions.onDisconnect
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

            when (tab) {
                PanelTab.MOTION -> ControlPanel(
                    state = state,
                    actions = actions,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = if (compact) 78.dp else 82.dp, end = 14.dp, bottom = 14.dp)
                        .width(railWidth)
                )
                PanelTab.SCENE -> ScenePage(
                    selectedScene = state.control.scene,
                    sessionRunning = state.control.session,
                    enabled = state.phase == BlePhase.READY,
                    onSelect = actions.onSceneSelect,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = if (compact) 78.dp else 82.dp, end = 14.dp, bottom = 14.dp)
                        .width(railWidth)
                )
                PanelTab.VOICE -> VoicePanel(
                    state = state,
                    actions = actions,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = if (compact) 78.dp else 82.dp, end = 14.dp, bottom = 14.dp)
                        .width(voiceWidth)
                )
                PanelTab.SUS -> SusPanel(
                    state = state,
                    actions = actions,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = if (compact) 78.dp else 82.dp, end = 14.dp, bottom = 14.dp)
                        .width(voiceWidth)
                )
            }

            // Read-only heading readout: a corner badge, never a touch target.
            AngleGauge(
                pose = state.pose,
                stale = state.poseStale,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 14.dp, bottom = 14.dp)
            )
        }
    }
}

/** The right half of the console: one panel at a time. */
private enum class PanelTab { MOTION, SCENE, VOICE, SUS }

@Composable
private fun TabButton(label: String, selected: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(
            text = label,
            color = if (selected) QuietPalette.Primary else QuietPalette.TextSecondary
        )
    }
}

@Composable
private fun ControlTopBar(
    state: ControlUiState,
    compact: Boolean,
    infoOpen: Boolean,
    tab: PanelTab,
    onSelectTab: (PanelTab) -> Unit,
    onToggleInfo: () -> Unit,
    onDisconnect: () -> Unit
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
                ConnectionChip(phase = state.phase, stale = state.stateStale)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (infoOpen) "▾" else "▸",
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            Spacer(Modifier.weight(1f))
            // Tabs, not toggles: exactly one right-hand panel is visible and
            // the selected one is never ambiguous.
            TabButton("控制", tab == PanelTab.MOTION) { onSelectTab(PanelTab.MOTION) }
            TabButton("场景", tab == PanelTab.SCENE) { onSelectTab(PanelTab.SCENE) }
            TabButton("语音", tab == PanelTab.VOICE) { onSelectTab(PanelTab.VOICE) }
            TabButton("SUS", tab == PanelTab.SUS) { onSelectTab(PanelTab.SUS) }
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
