package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
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
 * the first record, during a run it repeats it. The room is available at once;
 * no orientation countdown gates the key.
 */
fun calibrationView(
    phase: SessionPhase,
    ready: Boolean,
    requested: Boolean = false
): CalibrationView {
    val capturing = phase == SessionPhase.Calibrating
    return CalibrationView(
        keyLabel = when {
            requested -> "已提交…"
            capturing -> "记录中…"
            else -> "重新校准"
        },
        keyEnabled = ready && phase == SessionPhase.Running && !requested,
        stepValue = when {
            capturing -> "可记录"
            phase == SessionPhase.Running -> "已记录"
            else -> "未开始"
        },
        stepDone = capturing || phase == SessionPhase.Running,
        headline = when {
            capturing -> "校准中"
            phase == SessionPhase.Running -> "训练中"
            phase == SessionPhase.Stopping -> "正在结束"
            phase == SessionPhase.Entry -> "已启动，等待进入"
            else -> "准备本次训练"
        },
        hint = when {
            !ready -> "头显未连接。返回配对页重连。"
            capturing -> "校准中，患者保持不动。"
            phase == SessionPhase.Entry -> "等待患者按一次进入画面。"
            phase == SessionPhase.Running -> "会话在会话页调整。"
            else -> "尚未启动。"
        },
        unlockNote = when {
            capturing -> "标定未完成"
            phase == SessionPhase.Stopping -> "正在结束"
            phase == SessionPhase.Running -> "可切换"
            else -> "未进入 VR"
        }
    )
}

/**
 * The calibration key, shared by every surface that performs the verb.
 *
 * It takes the accent outline rather than a plain hairline: re-aiming the world
 * is the one correction the operator performs mid-session, and on the strip
 * under the picture it sits beside read-only numbers, where it has to be
 * visible as an action at a glance.
 */
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
        kind = KeyKind.Selected,
        enabled = view.keyEnabled,
        height = height,
        modifier = modifier
    )
}
