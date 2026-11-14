package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CutCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.size
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.AppCatalog
import com.quietshore.control.model.Battery
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.theme.QuietPalette

/** Bar height: one row — app name, link, the two doors, the stop. */
val CommandBarHeight = 72.dp

/** One charge field's width: label, state word and value within one glance. */
private val ChargFieldWidth = 268.dp

/** Where the stop sits on the bar's second line, and how wide it is. */
val StopWidth = 168.dp

/** 48 dp still clears the touch target; 56 competed with the traffic in the bar. */
val StopHeight = 48.dp

/**
 * The top app bar — an app bar, not a web header.
 *
 * It is the same paper as the page, closed by a hairline, because a dark bar in
 * a daylit ward is a black rectangle that fights the one thing the hand has to
 * find without looking. The stop is therefore the only solid block on the
 * screen: ink text on an ice field, 184×56, top-right, always in the same
 * place, never inside a scroll container and never behind a dialog.
 *
 * What the bar carries, and nothing more — every one of these is a fact that
 * must not scroll away:
 *
 *   line 1   `静岸控制台  │  已连接 3F-0927  │  说明 ⋯        [ 急停 ]`
 *   line 2   `待机  │  仰望湖面  │  未开始 00:00`
 *
 * The scene appears here once, on line 2, and nowhere else on the console: the
 * scene strip is the control, this is the read-back of what the headset loaded.
 * 说明 / 断开 / 退出场景 / 退出系统 live behind the overflow key — four
 * low-frequency words that used to sit in the bar and ate the room the session
 * facts need.
 */
@Composable
fun CommandBar(
    state: ControlUiState,
    onAppSelect: (String) -> Unit,
    onDisconnect: () -> Unit,
    /** Withdraws a launch that is still waiting for the patient's press. */
    onCancelLaunch: () -> Unit,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY
    val pad = com.quietshore.control.ui.rememberPadBattery()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Board)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // A floor: the bar's own copy scales with the system font, and a
                // fixed 72 dp cut the second line of the device field off as soon
                // as the setting was above 1.0. The height the design asks for is
                // the minimum, not the maximum.
                .heightIn(min = CommandBarHeight)
                .padding(horizontal = 20.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // A terminal line, not a brand header: the app's name is not
            // something the operator needs to read every session. State is
            // one field — signal bars, a solid ink tag, then the device's own
            // number.
            SignalBars(
                phase = state.phase,
                stale = state.stateStale
            )
            Spacer(Modifier.width(10.dp))
            // Two stacked fields, no filled chip: `//已连接` is an eyebrow in
            // the same voice as `//头显电量`, and the device's own number sits
            // under it in the figure face. A black block here read as a button.
            Column {
                // Weight carries the hierarchy, not size: the word is light
                // and quiet, the device number is the only medium-weight thing
                // on the left so the eye lands on "which headset" first.
                Text(
                    text = barLinkLabel(state.phase, state.stateStale),
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 0.4.sp
                    ),
                    color = QuietPalette.InkSecondary,
                    maxLines = 1
                )
                Text(
                    text = state.deviceSuffix.ifEmpty { "—" },
                    style = MaterialTheme.typography.titleMedium.tabularFigures()
                        .copy(fontWeight = FontWeight.SemiBold, letterSpacing = 1.2.sp),
                    color = QuietPalette.Ink,
                    maxLines = 1
                )
            }

            // The middle of the bar is the charge, as two field lines. No
            // bars: a bar made the operator read a length, a field makes the
            // reading the number.
            // Two fields side by side, each as wide as its reading needs. Full
            // width made the operator cross half the bar from the label to its
            // own number, which is what read as "not aligned" even once the
            // numbers were in a fixed column.
            Row(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 32.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BatteryField(
                    label = "头显",
                    level = state.battery?.level,
                    charging = state.battery?.charging ?: false,
                    modifier = Modifier.width(ChargFieldWidth)
                )
                BatteryField(
                    label = "平板",
                    level = pad?.level,
                    charging = pad?.charging ?: false,
                    modifier = Modifier.width(ChargFieldWidth)
                )
            }

            AppSelector(
                app = state.app,
                enabled = connected && !state.control.session,
                onSelect = onAppSelect
            )

            Spacer(Modifier.width(8.dp))

            Spacer(Modifier.width(16.dp))
            // The link's own exit, and a different object from the session's
            // 结束会话: this one drops the radio, that one ends the patient's
            // experience. **The radio is the emergency stop**: the patient holds
            // no controls, so cutting the tablet is how the session is stopped
            // from the other side — the page freezes motion and voice at once
            // and keeps the session for five seconds, which is the whole
            // reconnect window either way.
            Box(
                modifier = Modifier
                    // 48 dp, not 44: it is a terminal control, not a caption, and
                    // a key under the floor is exactly what a panicking hand
                    // misses. Inline text scales with the system font, so the
                    // height grows with the label instead of clipping it.
                    .heightIn(min = 48.dp)
                    .clip(androidx.compose.foundation.shape.CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp))
                    .background(QuietPalette.Board)
                    .border(
                        1.dp,
                        if (connected) QuietPalette.Danger else QuietPalette.Hairline,
                        androidx.compose.foundation.shape.CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
                    )
                    .clickable(
                        enabled = connected,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Button,
                        onClick = onDisconnect
                    )
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                Column {
                    Text(
                        text = "断开链接 = 急停",
                        style = MaterialTheme.typography.labelLarge,
                        // Red ink in a hairline box, never a red fill: the same
                        // language 结束会话 speaks, so two different objects (the
                        // radio, the session) are recognisable as two ends.
                        color = if (connected) QuietPalette.Danger else QuietPalette.InkSecondary,
                        maxLines = 2
                    )
                    Text(
                        text = "冻结会话，5 秒内重连继续",
                        style = MaterialTheme.typography.labelSmall,
                        color = QuietPalette.InkSecondary,
                        maxLines = 2
                    )
                }
            }
        }
        // Line 2: the session's own state and its clock, on every page and at
        // every phase. The console documents this line but never drew it, so
        // "is a session running, and for how long" was answerable only from the
        // 会话 tab — the one page an operator staring at 音频 is not on.
        BarSessionLine(state = state, onCancelLaunch = onCancelLaunch)
    }
}

/**
 * `会话 运行中 03:12 │ 已结束 12:04 │ 等患者按压 00:20 │ …`
 *
 * One line, always in the same place, never inside a scroll container: the two
 * facts that decide whether the operator may leave the bedside. The elapsed
 * figure is the running session's clock; after it ends the line names the
 * length of the session that just ran, which is the number the closing panel
 * asks the bedside question about.
 */
@Composable
private fun BarSessionLine(state: ControlUiState, onCancelLaunch: (() -> Unit)?) {
    val phase = sessionPhaseOf(
        state.control,
        state.phase,
        state.startPending,
        state.stopRequested
    )
    val status = when {
        state.phase != BlePhase.READY && state.lastSessionElapsedMs > 0L ->
            "未连接，上一轮 ${clock(state.lastSessionElapsedMs)}"
        state.phase != BlePhase.READY -> "头显未连接"
        phase == SessionPhase.Stopping -> "正在结束"
        phase == SessionPhase.Calibrating -> "标定中 ${clock(state.sessionElapsedMs)}"
        phase == SessionPhase.Running -> "会话进行中 ${clock(state.sessionElapsedMs)}"
        phase == SessionPhase.Entry -> "等患者进入"
        state.lastSessionElapsedMs > 0L -> "上一轮 ${clock(state.lastSessionElapsedMs)}"
        else -> "未开始"
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            // The scene the headset reports, not the operator's mark: this line
            // is a read-back, and a mark ahead of the frame would claim a room
            // the patient is not in.
            text = sceneLabel(state),
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary,
            maxLines = 1
        )
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .width(1.dp)
                .height(12.dp)
                .background(QuietPalette.Hairline)
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = status,
            style = MaterialTheme.typography.bodySmall.tabularFigures(),
            color = if (phase.inSession) QuietPalette.Ink else QuietPalette.InkSecondary,
            maxLines = 1,
            modifier = Modifier.weight(1f)
        )
        // The launch wait has its own way out here too: the bar is the one
        // surface visible from every destination, and a twenty-second wait
        // with no cancel on the page the operator happens to be on is a trap.
        if (phase == SessionPhase.Entry && onCancelLaunch != null) {
            Text(
                text = "取消启动",
                style = MaterialTheme.typography.labelLarge,
                color = QuietPalette.Ink,
                maxLines = 1,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .clickable(
                        role = Role.Button,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onCancelLaunch
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
    }
}

/** The scene the headset reports, named from its own catalogue. */
private fun sceneLabel(state: ControlUiState): String {
    val id = state.control.scene
    if (id.isEmpty()) {
        return "无场景"
    }
    val name = state.scenes.firstOrNull { it.id == id }?.name
        ?: com.quietshore.control.model.SceneCatalog.scene(id)?.name
        ?: id
    return "场景 $name"
}

/**
 * The current product face, and the way to change it.
 *
 * It shows what the headset reports (`state.app`), never the local click: a
 * switch that the page refused must not look applied. A session locks it, as
 * the page does.
 */
@Composable
private fun AppSelector(app: String, enabled: Boolean, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            modifier = Modifier
                // A minimum width, not a fixed one: the face's name is translated
                // and the system font scale is the operator's, and both used to
                // end in an ellipsis inside a 232 dp box.
                .widthIn(min = 232.dp)
                .heightIn(min = 48.dp)
                .clip(CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp))
                .border(
                    1.dp,
                    if (enabled) QuietPalette.Hairline else QuietPalette.Disabled,
                    CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp)
                )
                .clickable(
                    enabled = enabled,
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    role = Role.Button,
                    onClick = { open = true }
                )
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // No chevron: the full name sits in a hairline box, and the whole
            // box is the hit target.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = String.format(
                        java.util.Locale.US,
                        "%02d",
                        AppCatalog.ALL.indexOfFirst { it.id == app }.coerceAtLeast(0) + 1
                    ),
                    style = MaterialTheme.typography.labelMedium.tabularFigures(),
                    color = QuietPalette.InkSecondary
                )
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .width(1.dp)
                        .height(18.dp)
                        .background(QuietPalette.Hairline)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = AppCatalog.label(app),
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = QuietPalette.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = QuietPalette.Board
        ) {
            for (entry in AppCatalog.ALL) {
                DropdownMenuItem(
                    text = {
                        Text(
                            text = entry.label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (entry.id == app) {
                                QuietPalette.InkSecondary
                            } else {
                                QuietPalette.Ink
                            }
                        )
                    },
                    enabled = entry.id != app,
                    onClick = {
                        open = false
                        onSelect(entry.id)
                    }
                )
            }
        }
    }
}

/** `i`: the current app's guide, nothing global. */


/**
 * Link strength as four bars, tall to short: 24 dp high, 20 dp wide, 3 dp bars
 * with 2 dp between them.
 *
 * The colour is `#29B6F6`, not the palette's ice `#7DE6FF`: on paper the ice
 * tone is a fill colour and reads as a pale wash at 3 dp, while this blue holds
 * contrast at bar width. It is a device reading, so it is shown and never
 * pressed — square, no shape, no ripple.
 */
@Composable
private fun SignalBars(phase: BlePhase, stale: Boolean) {
    // How many bars are lit: a live link shows all four, a search or a retry
    // shows the smallest one, and no link shows none. The count is the state;
    // the RSSI is not a separate reading here (the pairing list carries it).
    val lit = when {
        phase == BlePhase.READY && !stale -> 4
        phase == BlePhase.SCANNING || phase == BlePhase.CONNECTING ||
            phase == BlePhase.AUTHENTICATING || phase == BlePhase.RECONNECTING -> 1
        else -> 0
    }
    Canvas(
        modifier = Modifier
            .size(width = 20.dp, height = 24.dp)
            .semantics { stateDescription = barLinkLabel(phase, stale) }
    ) {
        val barWidth = 3.dp.toPx()
        val gap = 2.dp.toPx()
        val full = size.height
        for (index in 0 until 4) {
            // Tall to short, left to right: the first bar lit is the shortest
            // one, which is what "something answered" looks like.
            val height = full * (0.35f + 0.2f * (3 - index))
            val left = index * (barWidth + gap)
            drawRect(
                color = if (index < lit) SignalBlue else QuietPalette.Hairline,
                topLeft = Offset(left, full - height),
                size = Size(barWidth, height)
            )
        }
    }
}

/** The one blue that survives being 3 dp wide on paper. */
private val SignalBlue = Color(0xFF29B6F6)

/**
 * The link state as a field: an ink block with reverse paper text.
 *
 * It is square, not cut, because a cut corner means "pressable" and this is a
 * readout. Its colour never changes with state — ink always, so the accent
 * keeps meaning "current / you can press this" and the stop keeps its red.
 */
@Composable
private fun StatusTag(label: String) {
    Box(
        modifier = Modifier
            .background(QuietPalette.Ink)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = QuietPalette.Paper,
            maxLines = 1
        )
    }
}

/**
 * The bar's link phrase. The copy deck keeps 搜索 / 重连 / 连接 apart, because
 * "正在连接" during a scan sent the operator looking for the wrong fault.
 */
private fun barLinkLabel(phase: BlePhase, stale: Boolean): String = when (phase) {
    BlePhase.READY -> if (stale) "连接受限" else "已连接"
    BlePhase.SCANNING -> "正在搜索"
    BlePhase.CONNECTING, BlePhase.AUTHENTICATING -> "正在连接"
    BlePhase.RECONNECTING -> "正在重连"
    BlePhase.DISCONNECTED -> "已断开"
    BlePhase.ERROR -> "连接失败"
    else -> "未连接"
}

/**
 * A secondary word in a row that already has a shape: it keeps its own 56 dp
 * hit box so it is pressable, and no hairline, so it never competes with the
 * one fill on the screen. Used for 校准 and 全部语音 — corrections and doors,
 * not the primary action.
 */
@Composable
fun BarWordKey(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true
) {
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 88.dp, minHeight = TouchTarget)
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
            fontWeight = FontWeight.Medium,
            color = if (enabled) QuietPalette.Ink else QuietPalette.Disabled,
            maxLines = 1
        )
    }
}
