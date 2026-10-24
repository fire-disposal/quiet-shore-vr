package com.quietshore.control.ui

import com.quietshore.control.model.SessionMode

/** Callbacks the control screen needs; keeps screens free of the ViewModel. */
data class ControlActions(
    /** Opens the training page on the headset (the patient still confirms once). */
    val onStartTraining: () -> Unit,
    /** Leaves the browser scene and comes back to the console app. */
    val onExitScene: () -> Unit,
    /** Ends the session and returns the headset to the system launcher. */
    val onExitSystem: () -> Unit,
    val onSceneSelect: (String) -> Unit,
    /** Breathing layer on the buoyancy; default on. */
    val onBreathToggle: (Boolean) -> Unit,
    /** Sit-up ramp length in milliseconds (4000..20000). */
    val onAnimDuration: (Int) -> Unit,
    /** Gaze dwell selection (SUS answers and spatial targets). Default on. */
    val onGazeDwellChange: (Boolean) -> Unit,
    /** Opens the SUS scale in the headset; it is answered by gaze. */
    val onSusOpen: () -> Unit,
    val onSusClose: () -> Unit,
    val onEnterTraining: () -> Unit,
    val onEnd: () -> Unit,
    val onRecalibrate: () -> Unit,
    val onToggleAudio: () -> Unit,
    val onPreview: () -> Unit,
    val onSessionMode: (SessionMode) -> Unit,
    val onFloatLevel: (Int) -> Unit,
    /** Buoyancy character: "a" gentle, "b" standard, "c" immersive. */
    val onFloatProfile: (String) -> Unit,
    val onEmergencyStop: () -> Unit,
    /** Posture branch: only meaningful in posture mode. */
    val onPostureLower: () -> Unit,
    val onPostureRise: () -> Unit,
    val onPostureStop: () -> Unit,
    val onDisconnect: () -> Unit,
    val onReconnect: () -> Unit,
    val onLeave: () -> Unit,
    /** Plays one pre-generated cue; ids come from [com.quietshore.control.voice.VoiceCatalog]. */
    val onVoicePlay: (String) -> Unit,
    /** Plays a whole sequence: start / imagine / relax / close. */
    val onVoiceSequence: (String) -> Unit,
    val onVoiceStop: () -> Unit,
    val onVoiceAuto: (Boolean) -> Unit,
    val onVoiceVolume: (Int) -> Unit,
    /** How far the scene bed is pulled down while a cue speaks, in dB. */
    val onVoiceDuck: (Int) -> Unit,
    val onVoiceSet: (String) -> Unit
)
