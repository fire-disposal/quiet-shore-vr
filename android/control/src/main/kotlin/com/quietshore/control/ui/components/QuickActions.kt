package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.SessionPhase
import com.quietshore.control.model.sessionPhaseOf
import com.quietshore.control.ui.ControlActions
import com.quietshore.control.ui.theme.QuietPalette

/**
 * The one row that stays usable during training: scene, strength, voice, end.
 *
 * ```text
 *   场景  [洁净立便间][仰望湖面][光井][病房]  │  强度 − 2 +  │  语音 …  │  [结束]
 * ```
 *
 * It is a shortcut, not a second console: every entry lands on the action a
 * band already exposes, and every mark is read back from the headset — pressing
 * a scene key sends and then waits for `state.control.scene`, so the ice block
 * can only ever mean "the page is showing this".
 *
 * The row follows the trigger table in `docs/ux-tree.md` §2 and nothing else:
 * scene and strength are live in `idle` / `entry` / `running`, refused in
 * `stopping` with a sentence instead of silence, and the stop never lives here
 * — it is in the bar, outside every scroll container.
 */
@Composable
fun QuickActions(
    state: ControlUiState,
    actions: ControlActions,
    modifier: Modifier = Modifier,
    /** The 语音 key's job: bring the voice panel into view, never play. */
    onOpenVoice: () -> Unit = {}
) {
    val phase = sessionPhaseOf(state.control, state.phase, state.startPending, state.stopRequested)
    val ready = state.phase == BlePhase.READY
    val level = state.control.floatLevel.coerceIn(0, 3)
    val changes = ready && phase.acceptsChanges

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(QuietPalette.Surface)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        StepperLabel("场景")
        SceneStrip(
            current = state.control.scene,
            enabled = changes,
            onSelect = actions.onSceneSelect
        )

        if (phase == SessionPhase.Running || phase == SessionPhase.Stopping) {
            Hairline()
            StepperLabel("强度")
            Stepper(
                value = "$level",
                description = "强度 $level 级",
                canDecrement = changes && level > 0,
                // The ceiling is the loaded scene's, not the global maximum.
                canIncrement = changes && level < state.caps.floatMax,
                onDecrement = { actions.onFloatLevel(level - 1) },
                onIncrement = { actions.onFloatLevel(level + 1) }
            )
            Hairline()
            // Voice is the third thing an operator reaches for mid-session, so
            // the row names what is speaking and opens the panel that drives
            // it. It never plays anything itself: a cue the operator cannot see
            // the text of is a cue they cannot have chosen on purpose.
            Column {
                StepperLabel("语音")
                Spacer(Modifier.height(4.dp))
                Text(
                    text = state.voiceLine?.let { if (it.text.length > 18) it.text.take(17) + "…" else it.text }
                        ?: "未播放",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state.voiceLine != null) {
                        QuietPalette.TextPrimary
                    } else {
                        QuietPalette.TextSecondary
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 220.dp)
                )
            }
            ActionKey(
                label = "语音",
                onClick = onOpenVoice,
                enabled = ready,
                minWidth = 72.dp
            )
            Hairline()
            ActionKey(
                label = "结束",
                onClick = actions.onEnd,
                tone = ActionTone.Danger,
                enabled = ready && phase == SessionPhase.Running,
                minWidth = 88.dp
            )
        }

        // A refused key is worse than an absent one: while the fade runs the
        // row says so, in one sentence, where the keys are.
        if (phase == SessionPhase.Stopping) {
            Text(
                text = "正在结束，稍后再切",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary,
                maxLines = 1
            )
        }
    }
}

/** The row's only division: 1 dp, short, never a box. */
@Composable
private fun Hairline() {
    Box(
        Modifier
            .width(1.dp)
            .height(28.dp)
            .background(QuietPalette.Hairline)
    )
}
