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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
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
/** What the initial page's left rail can explain. */
private enum class EntryTab(val latin: String, val label: String) {
    Connect("CONNECT", "连接"),
    Guide("GUIDE", "排尿引导"),
    Survey("SURVEY", "问卷作答")
}

/**
 * The no-headset page: a rail of short explanations on the left, and the one
 * job that needs the radio — picking a headset — fixed on the right. The rail
 * only explains; switching product faces stays in the top bar.
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
        val wide = maxWidth >= 1040.dp
        val scanning = state.phase == BlePhase.SCANNING
        var tab by remember { mutableStateOf(EntryTab.Connect) }

        if (wide) {
            Row(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 32.dp),
                horizontalArrangement = Arrangement.spacedBy(QuietSpace.Section),
                verticalAlignment = Alignment.Top
            ) {
                InitialRail(
                    current = tab,
                    onSelect = { tab = it },
                    modifier = Modifier.fillMaxHeight()
                )
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .verticalScroll(rememberScrollState())
                        .padding(top = 24.dp, end = 8.dp, bottom = QuietSpace.Page)
                ) {
                    TabBody(tab)
                }
                DeviceList(
                    state = state,
                    scanning = scanning,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
                    modifier = Modifier.width(500.dp).padding(top = 24.dp)
                )
            }
        } else {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            ) {
                Row(Modifier.fillMaxWidth()) {
                    InitialRail(current = tab, onSelect = { tab = it })
                    Column(
                        Modifier
                            .weight(1f)
                            .padding(start = QuietSpace.Section, top = 24.dp, end = 24.dp)
                    ) {
                        TabBody(tab)
                    }
                }
                DeviceList(
                    state = state,
                    scanning = scanning,
                    onScan = onScan,
                    onStopScan = onStopScan,
                    onConnect = onConnect,
                    modifier = Modifier.fillMaxWidth().padding(24.dp)
                )
                Spacer(Modifier.height(QuietSpace.Page))
            }
        }
    }
}

@Composable
private fun InitialRail(
    current: EntryTab,
    onSelect: (EntryTab) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .width(132.dp)
            .background(QuietPalette.Board)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 12.dp, horizontal = 8.dp),
    ) {
        for (tab in EntryTab.entries) {
            RailItem(
                tab = tab,
                selected = tab == current,
                onClick = { onSelect(tab) }
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
private fun RailItem(tab: EntryTab, selected: Boolean, onClick: () -> Unit) {
    val shape = CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(shape)
            .background(if (selected) QuietPalette.Ice else QuietPalette.Board)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Tab,
                onClick = onClick
            )
            .semantics { this.selected = selected }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = tab.latin,
            style = MaterialTheme.typography.labelSmall,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = tab.label,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            color = QuietPalette.Ink,
            maxLines = 1
        )
    }
}

@Composable
private fun TabBody(tab: EntryTab) {
    when (tab) {
        EntryTab.Connect -> IntroBlock()
        EntryTab.Guide -> AppSummary(
            title = "场景化排尿引导器",
            note = "一套床边场景体验：患者在躺卧时看见近似站立的视野，节奏由技术员掌握。",
            points = listOf(
                "选择场景与流程：洁净立便间、仰望湖面、病房。",
                "标定起始体位后进入正式场景；会话中可切换场景。",
                "强度、语音、体位与结束都在平板上；患者按头显确认开始。",
                "每段会话写入台账，结束后可在「场景化问卷作答器」作答。"
            )
        )
        EntryTab.Survey -> AppSummary(
            title = "场景化问卷作答器",
            note = "问卷配置化；作答、按次归档与导出，不依赖网络。",
            points = listOf(
                "题目与选项由问卷配置定义；当前内置系统可用性量表（SUS）。",
                "患者戴头显逐题作答，目视选项停住即选定；技术员可代答。",
                "每份问卷按次归档，带完成时间与来源应用。",
                "可按问卷与时间筛选，导出走系统分享；记录只在本机。"
            )
        )
    }
}

/** Left: what this tablet is and what the operator does next. */
@Composable
private fun IntroBlock() {
    Column {
        Text(
            text = "静岸控制台",
            style = MaterialTheme.typography.headlineMedium,
            color = QuietPalette.Ink
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "右侧窗口负责连接头显。点左侧标签，了解排尿引导与问卷作答器。",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.height(QuietSpace.Section))
        SectionHead(title = "准备", note = "按顺序")
        Rule()
        Spacer(Modifier.height(16.dp))
        for ((index, step) in listOf(
            "打开头显，确认它显示静岸入口",
            "点右侧的“搜索头显”",
            "在列表里点那台头显的“连接”"
        ).withIndex()) {
            NumberRow(index = index, text = step)
            Rule()
        }
    }
}

@Composable
private fun AppSummary(title: String, note: String, points: List<String>) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = QuietPalette.Ink
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = note,
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
        Spacer(Modifier.height(QuietSpace.Section))
        SectionHead(title = "摘要", note = "这个应用做什么")
        Rule()
        Spacer(Modifier.height(16.dp))
        for ((index, line) in points.withIndex()) {
            NumberRow(index = index, text = line)
            Rule()
        }
    }
}

@Composable
private fun NumberRow(index: Int, text: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = String.format(java.util.Locale.US, "%02d", index + 1),
            style = MaterialTheme.typography.titleSmall.copy(letterSpacing = 1.sp),
            color = QuietPalette.InkSecondary,
            modifier = Modifier.width(44.dp)
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = QuietPalette.Ink
        )
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
