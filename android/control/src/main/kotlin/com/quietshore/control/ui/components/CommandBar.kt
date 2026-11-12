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
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import com.quietshore.control.ui.theme.QuietPalette

/** Bar height: one row — app name, link, the two doors, the stop. */
val CommandBarHeight = 72.dp

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
    onOpenInfo: () -> Unit,
    onAppSelect: (String) -> Unit,
    onDisconnect: () -> Unit,
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
                .height(CommandBarHeight)
                .padding(start = 20.dp, end = 20.dp),
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
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 32.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                BatteryField(
                    label = "头显",
                    level = state.battery?.level,
                    charging = state.battery?.charging ?: false
                )
                BatteryField(
                    label = "平板",
                    level = pad?.level,
                    charging = pad?.charging ?: false
                )
            }

            AppSelector(
                app = state.app,
                enabled = connected && !state.control.session,
                onSelect = onAppSelect
            )

            Spacer(Modifier.width(8.dp))

            GuideKey(onClick = onOpenInfo)

            Spacer(Modifier.width(16.dp))
            // The bar's right end is the way out of the link: 断开连接. The
            // emergency stop is gone from the product; a session ends through
            // 结束 on the console, which is the same planned stop it always was.
            // Warning, not deletion: ending the link is reversible but it does
            // interrupt a session, so it takes the amber block the skill asks
            // for (red stays for delete). Disabled keeps a hairline + ink, so
            // the key never disappears.
            Box(
                modifier = Modifier
                    .height(48.dp)
                    .clip(androidx.compose.foundation.shape.CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp))
                    .background(if (connected) QuietPalette.Warning else QuietPalette.Board)
                    .then(
                        if (connected) {
                            Modifier
                        } else {
                            Modifier.border(1.dp, QuietPalette.Hairline, androidx.compose.foundation.shape.CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp))
                        }
                    )
                    .clickable(
                        enabled = connected,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Button,
                        onClick = onDisconnect
                    )
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "断开连接",
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
                    color = if (connected) QuietPalette.Ink else QuietPalette.InkSecondary,
                    maxLines = 1
                )
            }
        }

    }
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
                .width(232.dp)
                .height(44.dp)
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
@Composable
private fun GuideKey(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CutCornerShape(0.dp, 0.dp, 10.dp, 0.dp))
            .background(QuietPalette.Ice)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Button,
                onClick = onClick
            )
            .semantics { contentDescription = "当前应用说明" },
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.Description,
            contentDescription = "当前应用说明",
            tint = QuietPalette.Ink,
            modifier = Modifier.size(22.dp)
        )
    }
}

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
