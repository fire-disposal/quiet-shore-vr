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
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.EmptyNote
import com.quietshore.control.ui.components.Key
import com.quietshore.control.ui.components.KeyKind
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.RefusalNote
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.TouchTarget
import com.quietshore.control.ui.components.tabularFigures
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The screen before a session: the procedure on the left, the link on the
 * right. Same paper and same app bar as the console, so the app never changes
 * identity between "pairing" and "controlling" — but nothing here competes with
 * the patient: the only thing that matters is whether the headset is on.
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
            .background(QuietPalette.Paper)
            .safeDrawingPadding()
    ) {
        val wide = maxWidth >= 900.dp
        val compact = maxHeight < 620.dp
        val cardMaxHeight = maxHeight - CHROME.dp - QuietSpace.Page

        Column(Modifier.fillMaxSize()) {
            AppBar(onOpenInfo = onOpenInfo)

            if (wide) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(QuietSpace.Page),
                    verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
                ) {
                    PairingIntro(
                        compact = compact,
                        horizontal = true,
                        modifier = Modifier.fillMaxWidth()
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
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
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

/** Bar plus the screen's own cut: the card may take everything else. */
private const val CHROME = 72

/**
 * The app bar on paper: the app's name, then 操作说明 as a shaped key. Same
 * hairline as the console's, same height, so the two screens cannot drift.
 */
@Composable
private fun AppBar(onOpenInfo: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(QuietPalette.Board)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(72.dp)
                .padding(horizontal = QuietSpace.Page),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "连接头显",
                style = MaterialTheme.typography.titleMedium,
                color = QuietPalette.Ink
            )
            Spacer(Modifier.weight(1f))
            Key(
                label = "说明",
                onClick = onOpenInfo,
                kind = KeyKind.Outline
            )
        }
        Rule()
    }
}

@Composable
private fun PairingIntro(
    compact: Boolean,
    horizontal: Boolean = false,
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
            color = QuietPalette.Ink
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "先连头显，再开始会话。",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.height(if (compact) 16.dp else 28.dp))
        Rule()

        // The pairing page only teaches pairing. The rest of the shift is in
        // the guide, which is one press away; eight steps here made the one
        // screen that has to be quick into a manual.
        val steps = listOf(
            "打开头显",
            "点“搜索头显”",
            "等“已连接”"
        )
        // Wide screens put the three steps side by side across the width; a
        // left column with the action on the right left half the screen empty.
        if (horizontal) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section)
            ) {
                steps.forEachIndexed { index, step ->
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = String.format(java.util.Locale.US, "%02d", index + 1),
                            style = MaterialTheme.typography.titleSmall.tabularFigures(),
                            color = QuietPalette.InkSecondary,
                            modifier = Modifier.width(44.dp)
                        )
                        Text(
                            text = step,
                            style = MaterialTheme.typography.bodyMedium,
                            color = QuietPalette.Ink
                        )
                    }
                }
            }
        } else {
            for ((index, step) in steps.withIndex()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = if (compact) 6.dp else 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = String.format(java.util.Locale.US, "%02d", index + 1),
                        style = MaterialTheme.typography.titleSmall.tabularFigures(),
                        color = QuietPalette.InkSecondary,
                        modifier = Modifier.width(44.dp)
                    )
                    Text(
                        text = step,
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.Ink
                    )
                }
                Rule()
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = "患者说停：先按“急停”，再摘头显。",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.Ink
        )
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
            modifier.fillMaxWidth().background(QuietPalette.Board)
        } else {
            modifier.fillMaxWidth().heightIn(max = maxHeight).background(QuietPalette.Board)
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier
                )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(QuietSpace.Panel),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "头显",
                    style = MaterialTheme.typography.titleLarge,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.width(20.dp))
                ConnectionChip(
                    phase = state.phase,
                    stale = state.stateStale,
                    rssi = state.rssi
                )
            }
            Rule()

            // A refusal the operator must read: ice field, ink text.
            (event as? UiEvent.Error)?.let { failure ->
                Spacer(Modifier.height(16.dp))
                Box(Modifier.padding(horizontal = QuietSpace.Panel)) {
                    RefusalNote(text = OperatorCopy.operatorText(failure))
                }
            }

            Column(Modifier.padding(QuietSpace.Panel)) {
                when {
                    !permissionsGranted && permissionRequested -> PromptBlock(
                        title = "缺少“附近设备”权限",
                        body = "开启后再搜索。",
                        actionLabel = "去设置",
                        onAction = onOpenSettings
                    )

                    !bluetoothEnabled -> PromptBlock(
                        title = "蓝牙未开启",
                        body = "开启后再搜索。",
                        actionLabel = "去开启",
                        onAction = onEnableBluetooth
                    )

                    state.phase == BlePhase.SCANNING -> StatusLine(
                        text = "正在搜索",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onStopScan
                    )

                    state.phase == BlePhase.CONNECTING -> StatusLine(
                        text = "正在连接",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    state.phase == BlePhase.AUTHENTICATING -> StatusLine(
                        text = "正在接管",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    state.phase == BlePhase.RECONNECTING -> StatusLine(
                        text = "正在重连",
                        loading = true,
                        actionLabel = "取消",
                        onAction = onCancelConnect
                    )

                    else -> {
                        Key(
                            label = if (state.scanAttempted) "重新搜索" else "搜索头显",
                            onClick = onScan,
                            modifier = Modifier.fillMaxWidth(),
                            kind = KeyKind.Fill,
                            height = 72.dp,
                            enabled = bluetoothEnabled && (permissionsGranted || !permissionRequested),
                            textStyle = MaterialTheme.typography.titleMedium
                        )
                        if (state.phase == BlePhase.IDLE &&
                            state.scanAttempted &&
                            bluetoothEnabled &&
                            permissionsGranted
                        ) {
                            EmptyNote("未找到头显。确认头显已开机。")
                        }
                    }
                }
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
    Column(
        Modifier
            .fillMaxWidth()
            .background(QuietPalette.Ice)
            .padding(20.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = QuietPalette.OnIce)
        Spacer(Modifier.height(4.dp))
        Text(body, style = MaterialTheme.typography.bodySmall, color = QuietPalette.OnIce)
        Spacer(Modifier.height(16.dp))
        Key(
            label = actionLabel,
            onClick = onAction,
            kind = KeyKind.Outline,
            minWidth = 140.dp
        )
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
            .height(TouchTarget + 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (loading) {
            LoadingDots(color = QuietPalette.Ink)
            Spacer(Modifier.width(14.dp))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.titleMedium,
            color = QuietPalette.Ink,
            modifier = Modifier.weight(1f)
        )
        Key(label = actionLabel, onClick = onAction, kind = KeyKind.Outline)
    }
}
