package com.quietshore.control.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.quietshore.control.ble.BlePhase
import com.quietshore.control.model.ControlUiState
import com.quietshore.control.model.MirrorMode
import com.quietshore.control.ui.theme.QuietPalette
import com.quietshore.control.ui.theme.QuietSpace

/**
 * The patient's view, on demand, full width.
 *
 * The mirror is the only way the technician can answer "is the patient looking
 * at this scene, right now" — audit, not decoration — so it has to exist. It
 * does not get a permanent half of the screen, though: a WebGL canvas parked
 * below the figures competed with the three facts a session is read for, and
 * with no state frame it was a black rectangle claiming the room the posture
 * readouts need. So it is a cover: opened by one word in the session column,
 * 32 dp inside the page, the page dimmed behind it.
 *
 * What stays put: the app bar. The stop is in it, at the same coordinates, so
 * emergency stop never moves behind an overlay — this cover starts below the
 * bar and never covers it.
 *
 * What the cover may contain: the mirror, the two view modes, and the way out.
 * No other filled block, because the ice fill belongs to the action the session
 * is about, and while this is open there is no such action.
 */
@Composable
fun MirrorCover(
    state: ControlUiState,
    onModeChange: (MirrorMode) -> Unit,
    onClose: () -> Unit
) {
    // The dimmed page is the dismiss target: tapping outside the frame closes
    // it, which is what a cover is expected to do.
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Hairline)
            .clickable(
                role = Role.Button,
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onClose
            )
            .padding(QuietSpace.Page),
        contentAlignment = Alignment.Center
    ) {
        // The frame swallows its own clicks so tapping the mirror does not
        // close it.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(QuietPalette.Board)
                .clickable(
                    role = Role.Button,
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = {}
                )
        ) {
            // ---- header -------------------------------------------------
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(72.dp)
                    .padding(start = 24.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "患者视野",
                    style = MaterialTheme.typography.titleLarge,
                    color = QuietPalette.Ink
                )
                Spacer(Modifier.width(16.dp))
                SceneLine(state)
                Spacer(Modifier.weight(1f))
                // The two view modes are a segmented choice, so the current one
                // is the outlined one, never a fill.
                for (mode in MirrorMode.entries) {
                    Key(
                        label = mode.label,
                        onClick = { onModeChange(mode) },
                        kind = if (state.mirrorMode == mode) KeyKind.Selected else KeyKind.Outline,
                        height = 48.dp
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Spacer(Modifier.width(8.dp))
                Key(label = "返回", onClick = onClose, height = 48.dp)
            }
            Rule()

            // ---- the mirror, or the reason there is none ----------------
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (hasFrame(state)) {
                    MirrorView(state = state, modifier = Modifier.fillMaxSize())
                } else {
                    MirrorEmptyState()
                }
            }
        }
    }
}

/** A frame has arrived and the link is live: only then is there a picture. */
private fun hasFrame(state: ControlUiState): Boolean =
    state.phase == BlePhase.READY && state.pose != null && !state.poseStale

/**
 * What the picture above is actually of.
 *
 * The name on the left is the headset's own report — the scene byte in the
 * state frame — because that is the only thing that describes the picture. The
 * operator's local choice is a different fact and is shown only when it
 * disagrees: `头显：洁净立便间 · 本机：仰望湖面`. Silently printing the local
 * choice over a picture of another room is exactly the mismatch a technician
 * opens this cover to catch.
 */
@Composable
private fun SceneLine(state: ControlUiState) {
    val headset = nameOf(state.control.scene)
    val local = state.sceneIntent
    if (state.sceneIntentDiverges) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "头显：$headset",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.Ink,
                maxLines = 1
            )
            Text(
                text = " · 本机：${nameOf(local)}",
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.InkSecondary,
                maxLines = 1
            )
        }
    } else {
        Text(
            text = headset,
            style = MaterialTheme.typography.bodySmall,
            color = QuietPalette.InkSecondary
        )
    }
}

private fun nameOf(id: String): String =
    com.quietshore.control.model.SceneCatalog.scene(id)?.name ?: id

/**
 * No frame yet. The cover says why in one sentence and offers the one thing to
 * do about it. No illustration, no accent fill: a missing picture is not an
 * action, and the only red on the screen is the stop in the bar above.
 */
@Composable
private fun MirrorEmptyState() {
    // A void state is "there is no content", not an error: second ink, a title,
    // a hairline, one line of cause. No icon, no fill, no button — there is
    // nothing here to press, and the stop lives in the bar above.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QuietPalette.Paper)
            .padding(horizontal = 48.dp, vertical = 40.dp)
    ) {
        Text(
            text = "镜像未连接",
            style = MaterialTheme.typography.headlineSmall,
            color = QuietPalette.Ink
        )
        Spacer(Modifier.height(10.dp))
        Rule()
        Spacer(Modifier.height(12.dp))
        Text(
            text = "头显未连接，或未收到状态帧。",
            style = MaterialTheme.typography.bodyLarge,
            color = QuietPalette.InkSecondary
        )
    }
}
