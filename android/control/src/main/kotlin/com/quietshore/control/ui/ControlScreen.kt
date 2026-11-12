package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.UiEvent
import com.quietshore.control.ui.components.AngleGauge
import com.quietshore.control.ui.components.Band
import com.quietshore.control.ui.components.CommandBar
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.NoticeRow
import com.quietshore.control.ui.components.PitchSideGauge
import com.quietshore.control.ui.components.ReadoutBoard
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SceneMirror
import com.quietshore.control.ui.components.ScenePage
import com.quietshore.control.ui.components.SessionPanel
import com.quietshore.control.ui.components.SusPanel
import com.quietshore.control.ui.components.VoicePanel
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The console, one screen, top to bottom:
 *
 * ```text
 *   [ dark command bar ]   link · scene · session · tabs · stop   (fixed)
 *   [ readout board   ]    time · strength · posture              (fixed)
 *   [ bands           ]    scene / voice / SUS, hairline-divided  (scrolls)
 *   [ mirror + gauges ]    what the patient sees and where they face
 * ```
 *
 * Only the band column scrolls. The stop is in the bar and the session figures
 * are in the board, so neither can be scrolled away.
 */
@Composable
fun ControlScreen(
    state: ControlUiState,
    actions: ControlActions,
    /** Latest one-shot operator message; shown briefly under the bar. */
    event: UiEvent? = null,
    onOpenInfo: () -> Unit = {}
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

    // The first action of every session is 场景 (pick, then 启动); opening on
    // 控制 used to show a panel whose every control was dead.
    var tab by rememberSaveable { mutableStateOf("SCENE") }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
    ) {
        // A 10" tablet in landscape gets a fixed band column and the mirror
        // takes the rest; anything narrower stacks the bands under the board
        // so neither column is squeezed below a readable width.
        val wide = maxWidth >= 1000.dp
        val bandWidth = if (wide) 460.dp else maxWidth - 24.dp
        Column(Modifier.fillMaxSize()) {
            CommandBar(
                state = state,
                tab = tab,
                onSelect = { tab = it },
                onMirrorModeChange = actions.onMirrorModeChange,
                onOpenInfo = onOpenInfo,
                onDisconnect = actions.onDisconnect,
                onEmergencyStop = actions.onEmergencyStop
            )
            ReadoutBoard(state = state)
            Rule()

            Box(Modifier.weight(1f)) {
                // Left: what the patient sees, then the two read-only gauges.
                // In the stacked layout the mirror is hidden rather than
                // squeezed: a 200 dp video is not worth a third of the screen.
                Column(
                    modifier = Modifier
                        .fillMaxHeight()
                        .padding(end = bandWidth + 32.dp)
                ) {
                    if (wide) {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .padding(start = 20.dp, top = 16.dp, end = 20.dp)
                                .clip(CutCornerShape(0.dp, 0.dp, 0.dp, 16.dp))
                        ) {
                            SceneMirror(state = state, modifier = Modifier.fillMaxSize())
                        }
                    }
                    Row(
                        modifier = Modifier.padding(20.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        PitchSideGauge(pose = state.pose, stale = state.poseStale)
                        AngleGauge(pose = state.pose, stale = state.poseStale)
                    }
                }

                // Right: the bands. The only scrolling region on the screen.
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .width(bandWidth + 20.dp)
                        .fillMaxHeight()
                ) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .width(1.dp)
                            .background(QuietPalette.Hairline)
                    )
                    Column(
                        modifier = Modifier
                            .fillMaxHeight()
                            .padding(start = 1.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        if (reconnecting) {
                            LinkBanner(
                                title = "连接中断",
                                body = "正在重连（${state.reconnectAttempt.coerceAtLeast(1)}/${state.reconnectMax.coerceAtLeast(1)}），保持头显开机。",
                                actionLabel = "返回配对",
                                onAction = actions.onLeave,
                                loading = true
                            )
                        } else if (offline) {
                            LinkBanner(
                                title = "头显已断开",
                                body = "让头显回到前台，再重新连接。",
                                actionLabel = "重新连接",
                                onAction = actions.onReconnect,
                                secondaryLabel = "返回配对",
                                onSecondary = actions.onLeave
                            )
                        }
                        if (event != null) {
                            NoticeRow(
                                text = OperatorCopy.operatorText(event),
                                danger = event is UiEvent.Error
                            )
                        }
                        when (tab) {
                            "MOTION" -> SessionPanel(state = state, actions = actions)
                            "VOICE" -> VoicePanel(state = state, actions = actions)
                            "SUS" -> SusPanel(state = state, actions = actions)
                            else -> ScenePage(state = state, actions = actions)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Link state above the bands. Ice while it is a wait the operator can sit out;
 * red never appears here — red belongs to the stop and to deletions.
 */
@Composable
private fun LinkBanner(
    title: String,
    body: String,
    actionLabel: String,
    onAction: () -> Unit,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    loading: Boolean = false
) {
    Band(title = "链路") {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (loading) {
                LoadingDots(color = QuietPalette.TextPrimary)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(
                    text = body,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            Spacer(Modifier.width(12.dp))
            Key(label = actionLabel, onClick = onAction, kind = KeyKind.Outline)
            if (secondaryLabel != null && onSecondary != null) {
                Spacer(Modifier.width(8.dp))
                Key(label = secondaryLabel, onClick = onSecondary, kind = KeyKind.Quiet)
            }
        }
    }
}


