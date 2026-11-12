package com.quietshore.control.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.ScannedHeadset
import com.quietshore.control.ui.components.Panel
import com.quietshore.control.ui.components.Rule
import com.quietshore.control.ui.components.SectionHead
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The main area while no headset is claimed.
 *
 * One job: pick a headset. The page therefore has exactly two parts — the
 * title block and the list of headsets the radio can hear — and one action per
 * row. Nothing connects by itself: an earlier build connected to the first
 * matching device, which parked the screen in "connecting" whenever the
 * headset happened not to be advertising yet.
 */
@Composable
fun InitialPanel(
    state: ControlUiState,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 900.dp
        val scanning = state.phase == BlePhase.SCANNING
        if (wide) {
            // One measured column pair, centred: the page is a choice, not a
            // dashboard, and two blocks pinned to opposite edges read as two
            // unrelated screens.
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Row(
                Modifier.widthIn(max = 1180.dp).fillMaxHeight(),
                horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IntroBlock(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState())
                )
                DeviceList(
                    state = state,
                    scanning = scanning,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
                    modifier = Modifier.width(520.dp)
                )
            }
            }
        } else {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(QuietSpace.Section)
            ) {
                IntroBlock()
                DeviceList(
                    state = state,
                    scanning = scanning,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(QuietSpace.Page))
            }
        }
    }
}

/** Left: what this tablet is and what the operator does next. */
@Composable
private fun IntroBlock(modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(
            text = "静岸控制台",
            style = MaterialTheme.typography.headlineMedium,
            color = QuietPalette.Ink
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "选择一台头显并连接。连接后才能开始本次训练。",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.height(QuietSpace.Section))
        SectionHead(title = "准备", note = "按顺序")
        Rule()
        Spacer(Modifier.height(16.dp))
        for ((index, step) in listOf(
            "打开头显，确认它显示训练入口",
            "点“搜索头显”",
            "在列表里点那台头显的“连接”"
        ).withIndex()) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = String.format(java.util.Locale.US, "%02d", index + 1),
                    style = MaterialTheme.typography.titleSmall.copy(letterSpacing = 1.sp),
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
}

/** Right: what the radio heard, and the one action beside each row. */
@Composable
private fun DeviceList(
    state: ControlUiState,
    scanning: Boolean,
    onScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Panel(modifier) {
        Column(Modifier.padding(QuietSpace.Panel)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "头显",
                        style = MaterialTheme.typography.titleMedium,
                        color = QuietPalette.Ink
                    )
                    Text(
                        text = when {
                            scanning -> "//搜索中"
                            state.scanResults.isEmpty() -> "//未发现"
                            else -> "//已发现 ${state.scanResults.size} 台"
                        },
                        style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.4.sp),
                        color = QuietPalette.InkSecondary
                    )
                }
                BarKey(
                    label = if (scanning) "停止搜索" else "搜索头显",
                    onClick = if (scanning) onStopScan else onScan,
                    primary = !scanning
                )
            }
            Spacer(Modifier.height(QuietSpace.Row))
            Rule()
            if (state.scanResults.isEmpty()) {
                Spacer(Modifier.height(24.dp))
                Text(
                    text = "未发现头显",
                    style = MaterialTheme.typography.titleSmall,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "确认头显已开机，再点“搜索头显”。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QuietPalette.InkSecondary
                )
                Spacer(Modifier.height(24.dp))
            } else {
                for (headset in state.scanResults) {
                    DeviceRow(headset = headset, onConnect = onConnect)
                    Rule()
                }
            }
        }
    }
}

@Composable
private fun DeviceRow(headset: ScannedHeadset, onConnect: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = headset.name.ifEmpty { "未命名设备" },
                style = MaterialTheme.typography.titleSmall,
                color = QuietPalette.Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "${headset.address}  ${signalWord(headset.rssi)}",
                style = MaterialTheme.typography.labelSmall,
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
        }
        Spacer(Modifier.width(12.dp))
        BarKey(label = "连接", onClick = { onConnect(headset.address) }, primary = true)
    }
}

/** Signal as a word, not a number: -70 dBm means nothing to a nurse. */
private fun signalWord(rssi: Int): String = when {
    rssi >= -60 -> "信号强"
    rssi >= -75 -> "信号中"
    else -> "信号弱"
}

@Composable
private fun BarKey(label: String, onClick: () -> Unit, primary: Boolean) {
    val shape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
    Box(
        modifier = Modifier
            .height(48.dp)
            .clip(shape)
            .background(if (primary) QuietPalette.Ice else QuietPalette.Board)
            .then(
                if (primary) {
                    Modifier
                } else {
                    Modifier.background(QuietPalette.Board)
                }
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Button,
                onClick = onClick
            )
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge.copy(
                fontWeight = if (primary) FontWeight.Medium else FontWeight.Normal
            ),
            color = QuietPalette.Ink,
            maxLines = 1
        )
    }
}
