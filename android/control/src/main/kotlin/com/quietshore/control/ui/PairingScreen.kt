package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.UiEvent
import com.quietshore.control.ui.components.Band
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.EmptyNote
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.RefusalNote
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The screen before a session: one dark bar, the procedure on the left, the
 * link on the right. Nothing here competes with the patient — the tablet is
 * being set up, and the only thing that matters is whether the headset is on.
 */
@Composable
fun PairingScreen(
    state: ControlUiState,
    /** Latest one-shot message; a failure is shown inline while pairing. */
    event: UiEvent? = null,
    bluetoothEnabled: Boolean,
    permissionsGranted: Boolean,
    permissionRequested: Boolean,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onCancelConnect: () -> Unit,
    onEnableBluetooth: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenInfo: () -> Unit = {}
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
    ) {
        val wide = maxWidth >= 900.dp
        val compact = maxHeight < 560.dp
        val cardMaxHeight = maxHeight - MAX_CHROME.dp

        Column(Modifier.fillMaxSize()) {
            // The same dark bar as the console, so the app never changes
            // identity between "pairing" and "controlling".
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .background(QuietPalette.Bar)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "静岸控制台",
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.OnBar
                )
                Spacer(Modifier.weight(1f))
                Key(
                    label = "流程说明",
                    onClick = onOpenInfo,
                    kind = KeyKind.Quiet,
                    onBar = true
                )
            }

            if (wide) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 32.dp, vertical = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(48.dp)
                ) {
                    PairingIntro(
                        compact = compact,
                        modifier = Modifier.weight(1f)
                    )
                    PairingCard(
                        state = state,
                        event = event,
                        bluetoothEnabled = bluetoothEnabled,
                        permissionsGranted = permissionsGranted,
                        permissionRequested = permissionRequested,
                        onScan = onScan,
                        onStopScan = onStopScan,
                        onCancelConnect = onCancelConnect,
                        onEnableBluetooth = onEnableBluetooth,
                        onOpenSettings = onOpenSettings,
                        scrollable = true,
                        maxHeight = cardMaxHeight,
                        modifier = Modifier
                            .weight(1f)
                            .widthIn(max = 560.dp)
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp, vertical = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    PairingIntro(compact = compact, modifier = Modifier.fillMaxWidth())
                    PairingCard(
                        state = state,
                        event = event,
                        bluetoothEnabled = bluetoothEnabled,
                        permissionsGranted = permissionsGranted,
                        permissionRequested = permissionRequested,
                        onScan = onScan,
                        onStopScan = onStopScan,
                        onCancelConnect = onCancelConnect,
                        onEnableBluetooth = onEnableBluetooth,
                        onOpenSettings = onOpenSettings,
                        scrollable = false,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
}

/** Bar plus the screen's own outer padding. */
private const val MAX_CHROME = 64 + 48

@Composable
private fun PairingIntro(
    compact: Boolean,
    modifier: Modifier = Modifier
) {
    Column(modifier) {
        Text(
            text = "连接头显",
            style = if (compact) {
                MaterialTheme.typography.headlineMedium
            } else {
                MaterialTheme.typography.headlineLarge
            },
            color = QuietPalette.TextPrimary
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "先连头显，再开始会话。",
            style = MaterialTheme.typography.titleMedium,
            color = QuietPalette.TextSecondary
        )
        Spacer(Modifier.height(if (compact) 16.dp else 28.dp))

        // Eight steps, numbered by a rule rather than a bubble: the count is
        // the information, the circle was decoration.
        val steps = listOf(
            "打开头显",
            "搜索并连接头显",
            "平板接管控制",
            "协助患者戴好头显",
            "「场景」页选场景，启动训练",
            "「控制」页调体位与起伏、微调视线",
            "结束后在「SUS」页施测",
            "摘下头显，记录反馈"
        )
        for ((index, step) in steps.withIndex()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = if (compact) 4.dp else 7.dp),
                verticalAlignment = Alignment.Top
            ) {
                Text(
                    text = String.format(java.util.Locale.US, "%02d", index + 1),
                    style = MaterialTheme.typography.bodySmall.tabularFigures(),
                    color = QuietPalette.TextSecondary,
                    modifier = Modifier.width(32.dp)
                )
                Text(
                    text = step,
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextPrimary
                )
            }
            Rule()
        }
    }
}

@Composable
private fun PairingCard(
    state: ControlUiState,
    event: UiEvent?,
    bluetoothEnabled: Boolean,
    permissionsGranted: Boolean,
    permissionRequested: Boolean,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onCancelConnect: () -> Unit,
    onEnableBluetooth: () -> Unit,
    onOpenSettings: () -> Unit,
    scrollable: Boolean,
    modifier: Modifier = Modifier,
    /** The card wraps its content but never grows past the screen. */
    maxHeight: Dp = Dp.Unspecified
) {
    Column(
        modifier = if (maxHeight == Dp.Unspecified) {
            modifier.fillMaxWidth().background(QuietPalette.Surface)
        } else {
            modifier.fillMaxWidth().heightIn(max = maxHeight).background(QuietPalette.Surface)
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier
                )
        ) {
            Band(title = "头显") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ConnectionChip(phase = state.phase, stale = state.stateStale, onBar = false)
                }
            }

            // A refusal the operator must read: ice field, ink text.
            (event as? UiEvent.Error)?.let { failure ->
                RefusalNote(text = OperatorCopy.operatorText(failure))
            }

            Column(Modifier.padding(20.dp)) {
                when {
                    !permissionsGranted && permissionRequested -> PromptBlock(
                        title = "需要附近设备权限",
                        body = "搜索头显需要这一权限。",
                        actionLabel = "去设置",
                        onAction = onOpenSettings
                    )

                    !bluetoothEnabled -> PromptBlock(
                        title = "蓝牙未开启",
                        body = "打开平板蓝牙后才能搜索头显。",
                        actionLabel = "去开启",
                        onAction = onEnableBluetooth
                    )

                    state.phase == BlePhase.SCANNING -> StatusLine(
                        text = "正在搜索头显",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onStopScan
                    )

                    state.phase == BlePhase.CONNECTING -> StatusLine(
                        text = "正在连接头显",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    state.phase == BlePhase.AUTHENTICATING -> StatusLine(
                        text = "正在接管控制",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    state.phase == BlePhase.RECONNECTING -> StatusLine(
                        text = "连接中断，正在重连",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    else -> {
                        Key(
                            label = if (state.scanAttempted) "重新搜索" else "搜索头显",
                            onClick = onScan,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(56.dp),
                            kind = KeyKind.Fill,
                            enabled = bluetoothEnabled && (permissionsGranted || !permissionRequested)
                        )
                        if (state.phase == BlePhase.IDLE &&
                            state.scanAttempted &&
                            bluetoothEnabled &&
                            permissionsGranted
                        ) {
                            EmptyNote("未找到头显。确认头显已开机，且训练页面在前台。")
                        }
                    }
                }
            }

            Band(title = "须知") {
                EmptyNote(
                    text = "患者说停时：先按急停，再检查头显。",
                    modifier = Modifier.padding(horizontal = 20.dp)
                )
            }
        }
    }
}

/** A pre-condition the operator must clear: ice field, one instruction, one key. */
@Composable
private fun PromptBlock(
    title: String,
    body: String,
    actionLabel: String,
    onAction: () -> Unit
) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(QuietPalette.Ice)
            .padding(16.dp)
    ) {
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium, color = QuietPalette.TextPrimary)
            Spacer(Modifier.height(4.dp))
            Text(body, style = MaterialTheme.typography.bodySmall, color = QuietPalette.TextPrimary)
            Spacer(Modifier.height(12.dp))
            Key(
                label = actionLabel,
                onClick = onAction,
                kind = KeyKind.Outline,
                minWidth = 120.dp
            )
        }
    }
}

@Composable
private fun StatusLine(
    text: String,
    loading: Boolean,
    actionLabel: String,
    onAction: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (loading) {
            LoadingDots(color = QuietPalette.TextPrimary)
            Spacer(Modifier.width(14.dp))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.titleMedium,
            color = QuietPalette.TextPrimary,
            modifier = Modifier.weight(1f)
        )
        Key(label = actionLabel, onClick = onAction, kind = KeyKind.Outline)
    }
}
