package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase

/**
 * Where calibration stands, in the only words the console is allowed to use.
 *
 * Four surfaces print this one state — the scene strip, the scene page's own
 * note, the preparation chain and the key that performs it — and they used to
 * each phrase it themselves. That is how one screen came to say 标定中 while
 * another said 校准中 and a third said 记录中 for the same second of the same
 * session, and how a key stayed dead because a different surface had decided
 * the session was not running yet.
 *
 * So the wording and the enablement are decided once, here, from the phase and
 * the page's orientation verdict; every surface renders [CalibrationView].
 */
data class CalibrationView(
    /** Name of the one key that performs the next step. */
    val keyLabel: String,
    val keyEnabled: Boolean,
    /** The preparation chain's row for this step. */
    val stepValue: String,
    val stepDone: Boolean,
    /** The page-wide headline while the capture phase owns the session. */
    val headline: String,
    /** One sentence under the key: what to tell the patient right now. */
    val hint: String,
    /** Why the scene cards are closed, when they are. */
    val unlockNote: String
)

/**
 * The capture has two moments and one verb: in the preparation room it makes
 * the first record, during a run it repeats it. The orientation gate only ever
 * applies to the first, because a recalibration mid-session happens on a body
 * that has been in the room for minutes.
 */
fun calibrationView(state: ControlUiState, phase: SessionPhase, ready: Boolean): CalibrationView {
    val capturing = phase == SessionPhase.Calibrating
    val locked = capturing && !state.adaptationDone
    return CalibrationView(
        keyLabel = when {
            locked -> "适应中"
            capturing -> "记录体位"
            else -> "重新校准"
        },
        keyEnabled = ready && (
            (capturing && state.adaptationDone) || phase == SessionPhase.Running
            ),
        stepValue = when {
            locked -> "适应中"
            capturing -> "可记录"
            phase == SessionPhase.Running -> "已记录"
            else -> "未开始"
        },
        stepDone = (capturing && state.adaptationDone) || phase == SessionPhase.Running,
        headline = when {
            locked -> "适应中"
            capturing -> "校准中"
            phase == SessionPhase.Running -> "训练中"
            phase == SessionPhase.Stopping -> "正在结束"
            phase == SessionPhase.Entry -> "已启动，等待按压"
            else -> "准备本次训练"
        },
        hint = when {
            !ready -> "头显未连接。返回配对页重连。"
            locked -> "患者先熟悉画面；现在还不能记录。"
            capturing -> "校准中，患者保持不动。"
            phase == SessionPhase.Entry -> "等待患者按下确认键。"
            phase == SessionPhase.Running -> "会话在会话页调整。"
            else -> "尚未启动。"
        },
        unlockNote = when {
            locked || capturing -> "标定未完成"
            phase == SessionPhase.Stopping -> "正在结束"
            phase == SessionPhase.Running -> "可切换"
            else -> "未进入 VR"
        }
    )
}

/** The calibration key, shared by every surface that performs the verb. */
@Composable
fun CalibrationKey(
    view: CalibrationView,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = TouchTarget
) {
    Key(
        label = view.keyLabel,
        onClick = onClick,
        enabled = view.keyEnabled,
        height = height,
        modifier = modifier.fillMaxWidth()
    )
}
