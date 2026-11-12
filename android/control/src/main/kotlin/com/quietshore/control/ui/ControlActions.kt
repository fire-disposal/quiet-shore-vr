package com.quietshore.control.ui

import com.quietshore.control.model.MirrorMode

/** Callbacks the control screen needs; keeps screens free of the ViewModel. */
data class ControlActions(
    /** Opens the training page on the headset (the patient still confirms once). */
    val onStartTraining: () -> Unit,
    /** Leaves the browser scene and comes back to the console app. */
    val onExitScene: () -> Unit,
    /** Ends the session and returns the headset to the system launcher. */
    val onExitSystem: () -> Unit,
    /** Marks a scene as the operator's next choice; nothing is sent yet. */
    val onSceneSelect: (String) -> Unit,
    /** Applies the marked scene or the configured program. */
    val onSceneApply: () -> Unit,
    /** Advances a running program to its next segment. */
    val onNextSegment: () -> Unit,
    val onProgramAdd: () -> Unit,
    val onProgramRemove: (Int) -> Unit,
    val onProgramScene: (Int) -> Unit,
    val onProgramDuration: (Int) -> Unit,
    val onProgramVoice: (Int) -> Unit,
    val onProgramCap: (Int) -> Unit,
    val onProgramAuto: (Boolean) -> Unit,
    /** Sit-up ramp length in milliseconds (4000..20000). */
    val onAnimDuration: (Int) -> Unit,
    /** Gaze dwell selection (SUS answers and spatial targets). Default on. */
    val onGazeDwellChange: (Boolean) -> Unit,
    val onSusVoiceChange: (Boolean) -> Unit,
    val onSubtitlesChange: (Boolean) -> Unit,
    val onMirrorModeChange: (MirrorMode) -> Unit,
    /** Opens the SUS scale in the headset; it is answered by gaze. */
    val onSusOpen: () -> Unit,
    val onSusClose: () -> Unit,
    val onEnterTraining: () -> Unit,
    val onEnd: () -> Unit,
    val onRecalibrate: () -> Unit,
    val onToggleAudio: () -> Unit,
    val onFloatLevel: (Int) -> Unit,
    /** One discrete view preset: up / down / recenter / breathe. */
    val onViewAnim: (String) -> Unit,
    /** Hold the current view angles; only `recenter` returns to level. */
    val onViewStop: () -> Unit,
    val onEmergencyStop: () -> Unit,
    /** Posture branch: only meaningful in posture mode. */
    val onPostureLower: () -> Unit,
    val onPostureRise: () -> Unit,
    val onPostureStop: () -> Unit,
    val onDisconnect: () -> Unit,
    val onReconnect: () -> Unit,
    val onLeave: () -> Unit,
    /** Opens the voice panel; the quick row's 语音 key is a door, not a player. */
    val onVoiceOpen: () -> Unit,
    /** Plays one guidance cue; SUS statements are scheduled by the panel. */
    val onVoicePlay: (String) -> Unit,
    /** start | imagine | relax | close */
    val onVoiceSequence: (String) -> Unit,
    /** Plays a whole sequence: start / imagine / relax / close. */
    val onVoiceStop: () -> Unit,
    val onVoiceVolume: (Int) -> Unit,
    /** How far the scene bed is pulled down while a cue speaks, in dB. */
    val onVoiceDuck: (Int) -> Unit,
    val onVoiceSet: (String) -> Unit,
    /** SUS: show question [index] (1-based) on the headset. */
    val onSusShow: (Int) -> Unit,
    /** SUS: record the operator's answer for the current question. */
    val onSusAnswer: (Int) -> Unit,
    /** SUS: share the archived sheets as JSON through the system chooser. */
    val onSusExport: () -> Unit,
    /** Bedside answer: "attempt" | "success", yes/no. */
    val onOutcome: (String, Boolean) -> Unit,
)
