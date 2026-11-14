package com.quietshore.control.ui

import com.quietshore.control.model.MirrorMode

/**
 * The eight 0–10 rows of the 体验 form, in sheet order.
 *
 * The enum exists so the form, the state update and the CSV cannot disagree
 * about which scale is which: a field is identified by this name, never by its
 * position in a row of strings.
 */
enum class ExperienceField(val label: String) {
    FloatStrength("失重强度"),
    Disorientation("方向感错乱"),
    SceneRealism("场景真实感"),
    BodyAlignment("身体对齐"),
    Comfort("舒适度"),
    Dizziness("头晕"),
    Nausea("恶心"),
    RepeatWish("再次体验意愿")
}

/** Callbacks the control screen needs; keeps screens free of the ViewModel. */
data class ControlActions(
    /** Opens the training page on the headset (the patient still enters once). */
    val onStartTraining: () -> Unit,
    /** Switches the product face; the top bar follows the headset's report. */
    val onAppSelect: (String) -> Unit,
    /** Marks a scene as the operator's next choice; nothing is sent yet. */
    val onSceneSelect: (String) -> Unit,
    /**
     * The way back to the neutral room. It switches immediately: leaving a
     * performance is not the two-step a scene entry is.
     */
    val onScenePrep: () -> Unit,
    /** Applies the marked scene: the only way content changes mid-session. */
    val onSceneApply: () -> Unit,
    /** Sit-up ramp length in milliseconds (4000..20000). */
    val onAnimDuration: (Int) -> Unit,
    /**
     * Correction slider target, whole percent. Sending it is the manual
     * override: the page freezes whatever the correction was doing.
     */
    val onPostureMix: (Int) -> Unit,
    /** Gaze dwell selection (questionnaire answers and spatial targets). Default on. */
    val onGazeDwellChange: (Boolean) -> Unit,
    /** Auto read-out of the question as it appears. Default on. */
    val onQuestionnaireVoiceChange: (Boolean) -> Unit,
    val onSubtitlesChange: (Boolean) -> Unit,
    val onMirrorModeChange: (MirrorMode) -> Unit,
    /** Opens the questionnaire sheet in the headset; it is answered by gaze. */
    val onQuestionnaireOpen: () -> Unit,
    val onQuestionnaireClose: () -> Unit,
    val onEnterTraining: () -> Unit,
    /**
     * Launches the questionnaire face on the headset.
     *
     * Separate from [onEnterTraining] because it is a separate launch: the
     * questionnaire has no posture to record, so its launch skips the
     * preparation room and the calibration capture entirely.
     */
    val onEnterQuestionnaire: () -> Unit,
    /**
     * Withdraws a launch the patient has not opened yet. Local + the page's
     * own `exit`; never a session stop and never a link drop.
     */
    val onCancelLaunch: () -> Unit,
    val onEnd: () -> Unit,
    val onRecalibrate: () -> Unit,
    val onToggleAudio: () -> Unit,
    /** Buoyancy as a whole percent of the envelope, 0–100. */
    val onFloatAmount: (Int) -> Unit,
    /** The heave's breathing switch; the page eases it, never steps it. */
    val onBreathChange: (Boolean) -> Unit,
    /** One discrete view preset: up / down / recenter / breathe. */
    val onViewAnim: (String) -> Unit,
    /** Hold the current view angles; only `recenter` returns to level. */
    val onViewStop: () -> Unit,
    /** Posture correction: lower, rise, or hold the current angle. */
    val onPostureLower: () -> Unit,
    val onPostureRise: () -> Unit,
    val onPostureStop: () -> Unit,
    val onDisconnect: () -> Unit,
    val onReconnect: () -> Unit,
    val onLeave: () -> Unit,
    /** Opens the voice panel; the quick row's 语音 key is a door, not a player. */
    val onVoiceOpen: () -> Unit,
    /** Plays one guidance cue; questionnaire items are scheduled by the sheet. */
    val onVoicePlay: (String) -> Unit,
    /** start | imagine | relax | close */
    val onVoiceSequence: (String) -> Unit,
    /** Plays a whole sequence: start / imagine / relax / close. */
    val onVoiceStop: () -> Unit,
    val onVoiceVolume: (Int) -> Unit,
    /** Scene bed level 0–100; the water is not the voice. */
    val onAudioVolume: (Int) -> Unit,
    /** How far the scene bed is pulled down while a cue speaks, in dB. */
    val onVoiceDuck: (Int) -> Unit,
    val onVoiceSet: (String) -> Unit,
    /** Show question [index] (1-based) on the headset. */
    val onQuestionnaireShow: (Int) -> Unit,
    /** Record the operator's answer, one of the instrument's option values. */
    val onQuestionnaireAnswer: (Int) -> Unit,
    /** Load an instrument from the announced catalogue; resets local answers. */
    val onQuestionnaireSelect: (String) -> Unit,
    /** Re-read the current question aloud without advancing. */
    val onQuestionnaireReplay: () -> Unit,
    /** Share every local record — sheets, sessions, behaviour — as one JSON. */
    val onExportRecords: () -> Unit,
    val onQuestionnaireFilter: () -> Unit,
    val onQuestionnaireFilterDays: () -> Unit,
    /** Bedside answer: "attempt" | "success", yes/no. */
    val onOutcome: (String, Boolean) -> Unit,

    // ---- 体验 (experience observation) -------------------------------------

    /**
     * Opens a fresh 体验 form, stamped with the session that just ran.
     *
     * The capture belongs to the *press*: a scene or a length that changes while
     * the operator is typing must not be rewritten underneath the sheet.
     */
    val onExperienceOpen: () -> Unit,
    /** Abandons the open form; nothing is filed. */
    val onExperienceCancel: () -> Unit,
    /** 受试者编号; free text, may be blank. */
    val onExperienceParticipant: (String) -> Unit,
    /**
     * One 0–10 rating, addressed by [ExperienceField].
     *
     * A single callback per field keeps the form a list of rows in one column
     * instead of eight near-identical function types on this class.
     */
    val onExperienceRating: (ExperienceField, Int) -> Unit,
    /** 漂浮方向: one of `up` / `down` / `float` / `none`. */
    val onExperienceDirection: (String) -> Unit,
    /** 备注; free text, may be blank. */
    val onExperienceNotes: (String) -> Unit,
    /** Files the open draft; the record appears in the list immediately. */
    val onExperienceSave: () -> Unit,
    /** Removes one filed observation by its stable id. */
    val onExperienceDelete: (Long) -> Unit,
    /** Clears every filed observation. */
    val onExperienceClear: () -> Unit,
    /**
     * Shares every filed 体验 record as a CSV attachment.
     *
     * This is the 体验 page's only export: a spreadsheet the operator can open,
     * not a JSON blob. The JSON export still exists for the whole local ledger,
     * but it is reached from the guides.
     */
    val onExperienceExportCsv: () -> Unit,
)
