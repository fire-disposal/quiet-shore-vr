package com.quietshore.control.ui

import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.quietshore.control.ControlViewModel
import com.quietshore.control.model.UiEvent
import kotlinx.coroutines.delay

/** How long a one-shot message stays in the status panel. */
private const val EVENT_VISIBLE_MS = 6_000L

@Composable
fun ControlApp(viewModel: ControlViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    // One-shot messages: the banner shows the latest and forgets it after a
    // few seconds, so a repeated message still appears.
    var latestEvent by remember { mutableStateOf<UiEvent?>(null) }
    LaunchedEffect(viewModel) {
        viewModel.uiEvents.collect { event ->
            latestEvent = event
            delay(EVENT_VISIBLE_MS)
            if (latestEvent === event) {
                latestEvent = null
            }
        }
    }
    val bluetoothEnabled by viewModel.bluetoothEnabled.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var permissionsGranted by remember { mutableStateOf(hasBlePermissions(context)) }
    var permissionRequested by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        permissionRequested = true
        permissionsGranted = hasBlePermissions(context)
        if (permissionsGranted) {
            android.util.Log.i("QuietShoreBle", "scan from permission grant")
            viewModel.startScan()
        }
    }

    val settingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        permissionsGranted = hasBlePermissions(context)
        viewModel.refreshBluetoothState()
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permissionsGranted = hasBlePermissions(context)
                viewModel.refreshBluetoothState()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // No cold-start search: the operator decides when to look for the headset.
    // An automatic attempt used to park the screen in 连接中 whenever the
    // headset was not yet advertising, and only 取消 followed by 搜索 recovered.
    val onScan: () -> Unit = {
        if (permissionsGranted) {
            android.util.Log.i("QuietShoreBle", "scan from operator")
            viewModel.startScan()
        } else {
            permissionRequested = true
            permissionLauncher.launch(requiredBlePermissions())
        }
    }

    val onEnableBluetooth: () -> Unit = {
        if (!permissionsGranted) {
            permissionRequested = true
            permissionLauncher.launch(requiredBlePermissions())
        } else {
            try {
                settingsLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            } catch (error: Exception) {
                viewModel.reportError("无法打开蓝牙开关")
            }
        }
    }

    val onOpenSettings: () -> Unit = {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", context.packageName, null)
        )
        try {
            settingsLauncher.launch(intent)
        } catch (error: Exception) {
            viewModel.reportError("无法打开应用设置")
        }
    }

    ControlScreen(
        state = state,
        event = latestEvent,
        initialContent = {
            InitialPanel(
                state = state,
                onScan = onScan,
                onStopScan = viewModel::stopScan,
                onConnect = viewModel::connect
            )
        },
        actions = ControlActions(
            onStartTraining = viewModel::enterTraining,
            onAppSelect = viewModel::selectApp,
            onSceneSelect = viewModel::selectScene,
            onScenePrep = viewModel::enterPreparationRoom,
            onSceneApply = viewModel::applyScene,
            onAnimDuration = viewModel::setAnimDuration,
            onPostureMix = viewModel::setPostureMix,
            onGazeDwellChange = viewModel::setGazeDwell,
            onSusVoiceChange = viewModel::setSusVoice,
            onSubtitlesChange = viewModel::setSubtitles,
            onMirrorModeChange = viewModel::setMirrorMode,
            onSusOpen = viewModel::openSus,
            onSusClose = viewModel::closeSus,
            onEnterTraining = viewModel::enterTraining,
            onCancelLaunch = viewModel::cancelLaunch,
            onEnd = viewModel::endSession,
            onRecalibrate = viewModel::recalibrate,
            onToggleAudio = viewModel::toggleAudio,
            onFloatAmount = viewModel::setFloatAmount,
            onBreathChange = viewModel::setBreath,
            onViewAnim = viewModel::playViewAnim,
            onViewStop = viewModel::stopView,
            onPostureLower = viewModel::postureLower,
            onPostureRise = viewModel::postureRise,
            onPostureStop = viewModel::postureStop,
            onVoiceOpen = {},
            onVoicePlay = viewModel::playVoice,
            onVoiceSequence = viewModel::playVoiceSequence,
            onVoiceStop = viewModel::stopVoice,
            onVoiceVolume = viewModel::setVoiceVolume,
            onAudioVolume = viewModel::setAudioVolume,
            onVoiceDuck = viewModel::setVoiceDuck,
            onVoiceSet = viewModel::setVoiceSet,
            onSusShow = viewModel::susShow,
            onSusAnswer = viewModel::susAnswer,
            onExportRecords = viewModel::exportRecords,
            onSusFilterQuestionnaire = viewModel::cycleSusFilterQuestionnaire,
            onSusFilterDays = viewModel::cycleSusFilterDays,
            onOutcome = viewModel::recordOutcome,
            onDisconnect = viewModel::disconnect,
            onReconnect = viewModel::reconnect,
            onLeave = viewModel::leaveControl,
            onExperienceOpen = viewModel::openExperience,
            onExperienceCancel = viewModel::cancelExperience,
            onExperienceParticipant = viewModel::setExperienceParticipant,
            onExperienceRating = viewModel::setExperienceRating,
            onExperienceDirection = viewModel::setExperienceDirection,
            onExperienceNotes = viewModel::setExperienceNotes,
            onExperienceSave = viewModel::saveExperience,
            onExperienceExportCsv = viewModel::exportExperienceCsv
        )
    )
}
