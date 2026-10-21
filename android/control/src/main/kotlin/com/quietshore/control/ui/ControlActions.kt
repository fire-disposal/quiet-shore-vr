package com.quietshore.control.ui

import com.quietshore.control.model.ViewMode
import com.quietshore.control.protocol.ViewPreset

/** Callbacks the control screen needs; keeps screens free of the ViewModel. */
data class ControlActions(
    val onViewModeChange: (ViewMode) -> Unit,
    val onSceneSelect: (String) -> Unit,
    val onEnterTraining: () -> Unit,
    val onEnd: () -> Unit,
    val onRecalibrate: () -> Unit,
    val onToggleAudio: () -> Unit,
    val onPreview: () -> Unit,
    val onSusOpen: () -> Unit,
    val onSusClose: () -> Unit,
    val onSusPrev: () -> Unit,
    val onSusNext: () -> Unit,
    val onSusAnswer: (Int) -> Unit,
    val onPostureRise: () -> Unit,
    val onPostureLower: () -> Unit,
    val onPostureStop: () -> Unit,
    val onEyeHeightChange: (Float) -> Unit,
    /** Absolute pitch target from the slider, in whole degrees (-20..20). */
    val onPitchChange: (Float) -> Unit,
    /** Discrete page animation preset (`view:anim:<name>`). */
    val onViewAnim: (ViewPreset) -> Unit,
    /** `停止`: freeze the view where it is (`view:stop`, holds pitch). */
    val onViewPitchStop: () -> Unit,
    val onDisconnect: () -> Unit,
    val onReconnect: () -> Unit,
    val onLeave: () -> Unit,
    val onFullscreenChange: (Boolean) -> Unit
)
