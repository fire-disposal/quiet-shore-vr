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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.DiscoveredDevice
import com.quietshore.control.ui.components.ConnectionChip
import com.quietshore.control.ui.components.LoadingDots
import com.quietshore.control.ui.components.SignalBars
import com.quietshore.control.ui.theme.QuietPalette

@Composable
fun PairingScreen(
    state: ControlUiState,
    bluetoothEnabled: Boolean,
    permissionsGranted: Boolean,
    permissionRequested: Boolean,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (String) -> Unit,
    onCancelConnect: () -> Unit,
    onEnableBluetooth: () -> Unit,
    onOpenSettings: () -> Unit
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        contentAlignment = Alignment.Center
    ) {
        val wide = maxWidth >= 560.dp
        val compact = maxHeight < 520.dp
        if (wide) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 1100.dp)
                    .fillMaxHeight(),
                horizontalArrangement = Arrangement.spacedBy(40.dp),
                verticalAlignment = Alignment.Top
            ) {
                PairingIntro(
                    compact = compact,
                    modifier = Modifier
                        .weight(2f)
                        .fillMaxHeight()
                )
                PairingCard(
                    state = state,
                    bluetoothEnabled = bluetoothEnabled,
                    permissionsGranted = permissionsGranted,
                    permissionRequested = permissionRequested,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
                    onCancelConnect = onCancelConnect,
                    onEnableBluetooth = onEnableBluetooth,
                    onOpenSettings = onOpenSettings,
                    scrollable = true,
                    modifier = Modifier
                        .weight(3f)
                        .fillMaxHeight()
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                PairingIntro(compact = compact, modifier = Modifier.fillMaxWidth())
                PairingCard(
                    state = state,
                    bluetoothEnabled = bluetoothEnabled,
                    permissionsGranted = permissionsGranted,
                    permissionRequested = permissionRequested,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
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

@Composable
private fun PairingIntro(compact: Boolean, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(
            text = "静岸控制台",
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.Primary
        )
        Spacer(Modifier.height(if (compact) 6.dp else 14.dp))
        Text(
            text = "连接头显",
            style = if (compact) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.headlineLarge,
            color = QuietPalette.TextPrimary
        )
        Spacer(Modifier.height(if (compact) 6.dp else 12.dp))
        Text(
            text = "同一时间只有一台平板可以控制头显",
            style = MaterialTheme.typography.titleMedium,
            color = QuietPalette.TextSecondary
        )
        Spacer(Modifier.height(if (compact) 12.dp else 24.dp))
        StepRow("1", "打开头显", compact)
        Spacer(Modifier.height(if (compact) 6.dp else 12.dp))
        StepRow("2", "搜索并连接头显", compact)
        Spacer(Modifier.height(if (compact) 6.dp else 12.dp))
        StepRow("3", "平板接管控制", compact)
        if (!compact) {
            Spacer(Modifier.height(24.dp))
            Text(
                text = "连接后由平板控制场景、声音和校准",
                style = MaterialTheme.typography.bodyMedium,
                color = QuietPalette.TextSecondary
            )
        }
    }
}

@Composable
private fun StepRow(index: String, text: String, compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(if (compact) 26.dp else 32.dp)
                .clip(CircleShape)
                .background(QuietPalette.SurfaceRaised),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = index,
                style = MaterialTheme.typography.labelLarge,
                color = QuietPalette.Primary
            )
        }
        Spacer(Modifier.width(if (compact) 10.dp else 14.dp))
        Text(
            text = text,
            style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleMedium,
            color = QuietPalette.TextPrimary
        )
    }
}

@Composable
private fun PairingCard(
    state: ControlUiState,
    bluetoothEnabled: Boolean,
    permissionsGranted: Boolean,
    permissionRequested: Boolean,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (String) -> Unit,
    onCancelConnect: () -> Unit,
    onEnableBluetooth: () -> Unit,
    onOpenSettings: () -> Unit,
    scrollable: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(28.dp),
        color = QuietPalette.Surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (scrollable) {
                        Modifier.verticalScroll(rememberScrollState())
                    } else {
                        Modifier
                    }
                )
                .padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "头显连接",
                    style = MaterialTheme.typography.titleLarge,
                    color = QuietPalette.TextPrimary,
                    modifier = Modifier.weight(1f)
                )
                ConnectionChip(phase = state.phase)
            }

            state.error?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.Danger
                )
            }
            when {
                !permissionsGranted && permissionRequested -> PromptBlock(
                    title = "需要附近设备权限",
                    body = "搜索头显需要附近设备权限",
                    actionLabel = "去设置",
                    onAction = onOpenSettings
                )

                !bluetoothEnabled -> PromptBlock(
                    title = "蓝牙未开启",
                    body = "打开平板蓝牙后才能搜索头显",
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

                else -> Button(
                    onClick = onScan,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    enabled = bluetoothEnabled && (permissionsGranted || !permissionRequested),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text(
                        text = if (state.scanAttempted) "重新搜索" else "搜索头显",
                        style = MaterialTheme.typography.titleMedium
                    )
                }
            }

            if (state.phase == BlePhase.IDLE &&
                state.scanAttempted &&
                state.devices.isEmpty() &&
                bluetoothEnabled &&
                permissionsGranted
            ) {
                Text(
                    text = "未找到头显，请确认头显已开机",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.TextSecondary
                )
            }

            if (state.devices.isNotEmpty()) {
                Text(
                    text = "已找到的头显",
                    style = MaterialTheme.typography.labelLarge,
                    color = QuietPalette.TextSecondary
                )
                state.devices.take(6).forEach { device ->
                    DeviceRow(
                        device = device,
                        enabled = state.canConnect,
                        onConnect = { onConnect(device.address) }
                    )
                }
            }

        }
    }
}

@Composable
private fun PromptBlock(
    title: String,
    body: String,
    actionLabel: String,
    onAction: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = QuietPalette.Warning.copy(alpha = 0.12f),
        contentColor = QuietPalette.Warning
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = QuietPalette.TextSecondary
                )
            }
            Spacer(Modifier.width(12.dp))
            TextButton(
                onClick = onAction,
                colors = ButtonDefaults.textButtonColors(contentColor = QuietPalette.Warning)
            ) {
                Text(actionLabel)
            }
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
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (loading) {
            LoadingDots()
            Spacer(Modifier.width(14.dp))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.titleMedium,
            color = QuietPalette.TextPrimary,
            modifier = Modifier.weight(1f)
        )
        TextButton(onClick = onAction) {
            Text(actionLabel, color = QuietPalette.TextSecondary)
        }
    }
}

@Composable
private fun DeviceRow(
    device: DiscoveredDevice,
    enabled: Boolean,
    onConnect: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = QuietPalette.SurfaceRaised
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "静岸头显",
                    style = MaterialTheme.typography.titleMedium,
                    color = QuietPalette.TextPrimary
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "尾号 ${device.shortAddress}",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = "${device.rssi} dBm",
                        style = MaterialTheme.typography.bodySmall,
                        color = QuietPalette.TextSecondary
                    )
                }
            }
            SignalBars(rssi = device.rssi)
            Spacer(Modifier.width(18.dp))
            Button(
                onClick = onConnect,
                enabled = enabled,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.height(48.dp)
            ) {
                Text("连接")
            }
        }
    }
}
