package com.quietshore.control.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.quietshore.control.model.ViewPresets
import com.quietshore.control.protocol.ControlProtocol
import com.quietshore.control.protocol.ViewAnim
import com.quietshore.control.protocol.ViewPreset
import com.quietshore.control.ui.theme.QuietPalette
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

private val MAX_PITCH = ControlProtocol.VIEW_PITCH_MAX_DEG.roundToInt()
private val MAX_YAW = ControlProtocol.VIEW_YAW_MAX_DEG.roundToInt()

/** 1° per tick across the full range. */
private val PITCH_STEPS = (MAX_PITCH * 2) - 1
private val YAW_STEPS = (MAX_YAW * 2) - 1

/**
 * Absolute virtual-view orientation plus the system-level animation presets.
 *
 * Two independent sliders: yaw (−180°..+180°, + = the patient's view turns
 * left) and up-gaze (−90°..+90°, + = the patient sees more sky). The four
 * preset buttons play fixed page curves and send no amplitude or timing;
 * `recenter` returns both axes to 0°. The thumbs follow the in-flight request
 * while dragging and the headset readback otherwise.
 */
@Composable
fun ViewOrientationControls(
    yawDegrees: Float,
    yawTarget: Float,
    pitchDegrees: Float,
    pitchTarget: Float,
    anim: ViewAnim,
    preset: ViewPreset,
    enabled: Boolean,
    onYawChange: (Float) -> Unit,
    onPitchChange: (Float) -> Unit,
    onAnim: (ViewPreset) -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    val yaw = yawDegrees.roundToInt().coerceIn(-MAX_YAW, MAX_YAW)
    val pitch = pitchDegrees.roundToInt().coerceIn(-MAX_PITCH, MAX_PITCH)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${yawLabel(yaw)} · ${pitchLabel(pitch)}",
                style = MaterialTheme.typography.titleMedium,
                color = if (enabled) QuietPalette.TextPrimary else QuietPalette.TextSecondary
            )
            Text(
                text = String.format(
                    Locale.US,
                    "头显当前 %+d° / %+d°",
                    yawTarget.roundToInt(),
                    pitchTarget.roundToInt()
                ),
                style = MaterialTheme.typography.bodySmall,
                color = QuietPalette.TextSecondary
            )
        }
        OrientationSlider(
            label = "偏航",
            value = yaw,
            max = MAX_YAW,
            steps = YAW_STEPS,
            enabled = enabled,
            startHint = "左转 $MAX_YAW°",
            centerHint = "正前",
            endHint = "右转 $MAX_YAW°",
            onChange = onYawChange
        )
        OrientationSlider(
            label = "俯仰",
            value = pitch,
            max = MAX_PITCH,
            steps = PITCH_STEPS,
            enabled = enabled,
            startHint = "下俯 $MAX_PITCH°",
            centerHint = "平视",
            endHint = "上仰 $MAX_PITCH°",
            onChange = onPitchChange
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PresetButton(
                preset = ViewPreset.UP,
                icon = Icons.Rounded.ArrowUpward,
                enabled = enabled,
                onPlay = onAnim,
                modifier = Modifier.weight(1f)
            )
            PresetButton(
                preset = ViewPreset.DOWN,
                icon = Icons.Rounded.ArrowDownward,
                enabled = enabled,
                onPlay = onAnim,
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PresetButton(
                preset = ViewPreset.RECENTER,
                icon = Icons.Rounded.MyLocation,
                enabled = enabled,
                onPlay = onAnim,
                modifier = Modifier.weight(1f)
            )
            PresetButton(
                preset = ViewPreset.BREATHE,
                icon = Icons.Rounded.Air,
                enabled = enabled,
                onPlay = onAnim,
                modifier = Modifier.weight(1f)
            )
        }
        FilledTonalButton(
            onClick = onStop,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            enabled = enabled,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = QuietPalette.SurfaceRaised,
                contentColor = QuietPalette.TextPrimary,
                disabledContainerColor = QuietPalette.SurfaceRaised.copy(alpha = 0.4f),
                disabledContentColor = QuietPalette.TextSecondary.copy(alpha = 0.5f)
            )
        ) {
            Icon(Icons.Rounded.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("停止（保持）", style = MaterialTheme.typography.titleSmall)
        }
        Text(
            text = "预设：" + ViewPresets.label(preset) + " · " + animLabel(anim) +
                " · 当前 " + String.format(Locale.US, "%d° / %d°", yawTarget.roundToInt(), pitchTarget.roundToInt()),
            style = MaterialTheme.typography.bodySmall,
            color = when (anim) {
                ViewAnim.PLAYING -> QuietPalette.Primary
                ViewAnim.HELD -> QuietPalette.TextPrimary
                ViewAnim.IDLE -> QuietPalette.TextSecondary
            }
        )
    }
}

/**
 * One absolute axis: −[max]..+[max] with 1° ticks. `value` is the applied or
 * requested angle; the caller owns which one it shows.
 */
@Composable
private fun OrientationSlider(
    label: String,
    value: Int,
    max: Int,
    steps: Int,
    enabled: Boolean,
    startHint: String,
    centerHint: String,
    endHint: String,
    onChange: (Float) -> Unit
) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = QuietPalette.TextSecondary
    )
    Slider(
        value = value.toFloat(),
        onValueChange = onChange,
        enabled = enabled,
        valueRange = -max.toFloat()..max.toFloat(),
        steps = steps,
        colors = SliderDefaults.colors(
            thumbColor = QuietPalette.Primary,
            activeTrackColor = QuietPalette.Primary,
            inactiveTrackColor = QuietPalette.Outline,
            disabledThumbColor = QuietPalette.TextSecondary.copy(alpha = 0.5f),
            disabledActiveTrackColor = QuietPalette.Outline,
            disabledInactiveTrackColor = QuietPalette.Outline.copy(alpha = 0.6f)
        )
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(startHint, style = MaterialTheme.typography.bodySmall, color = QuietPalette.TextSecondary)
        Text(centerHint, style = MaterialTheme.typography.bodySmall, color = QuietPalette.TextSecondary)
        Text(endHint, style = MaterialTheme.typography.bodySmall, color = QuietPalette.TextSecondary)
    }
}

@Composable
private fun PresetButton(
    preset: ViewPreset,
    icon: ImageVector,
    enabled: Boolean,
    onPlay: (ViewPreset) -> Unit,
    modifier: Modifier = Modifier
) {
    FilledTonalButton(
        onClick = { onPlay(preset) },
        modifier = modifier.height(48.dp),
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = QuietPalette.SurfaceRaised,
            contentColor = QuietPalette.TextPrimary,
            disabledContainerColor = QuietPalette.SurfaceRaised.copy(alpha = 0.4f),
            disabledContentColor = QuietPalette.TextSecondary.copy(alpha = 0.5f)
        )
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            text = ViewPresets.label(preset),
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1
        )
    }
}

private fun yawLabel(degrees: Int): String = when {
    degrees < 0 -> "右转 ${abs(degrees)}°"
    degrees > 0 -> "左转 $degrees°"
    else -> "正前"
}

private fun pitchLabel(degrees: Int): String = when {
    degrees > 0 -> "上仰 $degrees°"
    degrees < 0 -> "下俯 ${abs(degrees)}°"
    else -> "平视"
}

private fun animLabel(anim: ViewAnim): String = when (anim) {
    ViewAnim.PLAYING -> "播放中"
    ViewAnim.HELD -> "已保持"
    ViewAnim.IDLE -> "空闲"
}
