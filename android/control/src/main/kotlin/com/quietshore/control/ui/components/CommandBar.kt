package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.ui.theme.QuietPalette

/** Bar height: one row — app name, link, the two doors, the stop. */
val CommandBarHeight = 88.dp

/** Where the stop sits on the bar's second line, and how wide it is. */
val StopWidth = 208.dp

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
    onDisconnect: () -> Unit,
    onExitScene: () -> Unit,
    onExitSystem: () -> Unit,
    onEmergencyStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    val connected = state.phase == BlePhase.READY

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Board)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(CommandBarHeight)
                .padding(start = 32.dp, end = 20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // ---- the app's own row -------------------------------------
            Column(Modifier.weight(1f)) {
                Text(
                    text = "静岸控制台",
                    style = MaterialTheme.typography.titleSmall,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PresenceMark(presenceOf(state.phase, state.stateStale))
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = barLinkLabel(state.phase, state.stateStale),
                        style = MaterialTheme.typography.bodyMedium,
                        color = QuietPalette.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (state.deviceSuffix.isNotEmpty()) {
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = state.deviceSuffix,
                            style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                            color = QuietPalette.InkSecondary,
                            maxLines = 1
                        )
                    }
                    if (state.battery != null) {
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = "电量 ${state.battery.level}%",
                            style = MaterialTheme.typography.bodyMedium.tabularFigures(),
                            color = if (state.battery.low) QuietPalette.Ink else QuietPalette.InkSecondary,
                            maxLines = 1
                        )
                    }
                }
            }

            OverflowMenu(
                connected = connected,
                inSession = state.control.session,
                onOpenInfo = onOpenInfo,
                onDisconnect = onDisconnect,
                onExitScene = onExitScene,
                onExitSystem = onExitSystem
            )

            Spacer(Modifier.width(16.dp))
            StopKey(
                enabled = connected && state.control.session,
                onClick = onEmergencyStop
            )
        }

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
 * The four low-frequency words, behind one key.
 *
 * They are shaped (a hairline box with a cut corner), because the acceptance
 * rule is that a word cannot be a button. 说明 opens the guide; 断开 releases
 * the headset; 退出场景 and 退出系统 are the two doors out.
 */
@Composable
private fun OverflowMenu(
    connected: Boolean,
    inSession: Boolean,
    onOpenInfo: () -> Unit,
    onDisconnect: () -> Unit,
    onExitScene: () -> Unit,
    onExitSystem: () -> Unit
) {
    var open by remember { mutableStateOf(false) }
    // 退出系统 is the one irreversible door: during a session it ends the
    // session first, so it asks once. Idle it just leaves. The stop never
    // takes this path — it is not in this menu.
    var confirmingExit by remember { mutableStateOf(false) }
    Box {
        Key(
            label = "更多",
            onClick = { open = true },
            kind = KeyKind.Outline,
            height = 48.dp
        )
        if (confirmingExit) {
            AlertDialog(
                onDismissRequest = { confirmingExit = false },
                shape = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
                containerColor = QuietPalette.Board,
                title = {
                    Text("退出系统？", style = MaterialTheme.typography.titleLarge)
                },
                text = {
                    Text(
                        text = "会先结束当前会话，再让头显回到桌面。患者仍在佩戴时不要这样做。",
                        style = MaterialTheme.typography.bodyMedium
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirmingExit = false
                        onExitSystem()
                    }) {
                        Text("退出", color = QuietPalette.Danger)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmingExit = false }) {
                        Text("取消", color = QuietPalette.InkSecondary)
                    }
                }
            )
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = QuietPalette.Board
        ) {
            MenuWord("操作说明") { open = false; onOpenInfo() }
            MenuWord("断开", enabled = connected) { open = false; onDisconnect() }
            MenuWord("退出场景") { open = false; onExitScene() }
            MenuWord("退出系统") {
                open = false
                if (inSession) confirmingExit = true else onExitSystem()
            }
        }
    }
}

@Composable
private fun MenuWord(
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    DropdownMenuItem(
        text = {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) QuietPalette.Ink else QuietPalette.Disabled
            )
        },
        enabled = enabled,
        onClick = onClick
    )
}

/**
 * The stop: 184×56, ink on ice, cut corner, top-right corner of the bar.
 *
 * It is the only solid block on any screen. Ice rather than red, because red
 * would make it look like a report of a failure rather than a thing to press;
 * red ink appears only in the confirmation of an irreversible exit, which the
 * stop never passes through. Disabled when there is no session to stop, so it
 * cannot be pressed into silence.
 */
@Composable
private fun StopKey(enabled: Boolean, onClick: () -> Unit) {
    val shape = CutCornerShape(0.dp, 0.dp, 12.dp, 0.dp)
    Box(
        modifier = Modifier
            .width(StopWidth)
            .height(56.dp)
            .clip(shape)
            .background(if (enabled) QuietPalette.Danger else QuietPalette.Board)
            // Disabled keeps its silhouette: a red hairline and second ink, so
            // the operator still sees where the stop lives before a session.
            .then(
                if (enabled) Modifier
                else Modifier.border(1.dp, QuietPalette.Danger.copy(alpha = 0.55f), shape)
            )
            .clickable(
                enabled = enabled,
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClick
            )
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "急停",
            style = MaterialTheme.typography.titleMedium,
            color = if (enabled) QuietPalette.Board else QuietPalette.InkSecondary,
            maxLines = 1
        )
    }
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
