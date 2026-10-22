package com.quietshore.control.ui

import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.quietshore.control.ControlViewModel
import com.quietshore.control.ble.BlePhase
import java.io.File

@Composable
fun ControlApp(viewModel: ControlViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
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

    // Cold start with a known headset: skip the scan step. A failed attempt
    // still lands on pairing with the quick-connect card and a scan button.
    var autoConnectAttempted by remember { mutableStateOf(false) }
    LaunchedEffect(permissionsGranted, bluetoothEnabled, state.phase, state.scanAttempted) {
        val address = state.lastDeviceAddress
        if (!autoConnectAttempted &&
            permissionsGranted &&
            bluetoothEnabled &&
            address != null &&
            state.phase == BlePhase.IDLE &&
            !state.scanAttempted
        ) {
            autoConnectAttempted = true
            viewModel.connect(address)
        }
    }

    val onScan: () -> Unit = {
        if (permissionsGranted) {
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

    if (state.showControls) {
        ControlScreen(
            state = state,
            actions = ControlActions(
                onViewModeChange = viewModel::setViewMode,
                onSceneSelect = viewModel::selectScene,
                onEnterTraining = viewModel::enterTraining,
                onEnd = viewModel::endSession,
                onRecalibrate = viewModel::recalibrate,
                onToggleAudio = viewModel::toggleAudio,
                onPreview = viewModel::preview,
                onSusOpen = viewModel::openSus,
                onSusClose = viewModel::closeSus,
                onSusPrev = viewModel::susPrev,
                onSusNext = viewModel::susNext,
                onSusAnswer = viewModel::susAnswer,
                onPostureRise = viewModel::postureRise,
                onPostureLower = viewModel::postureLower,
                onPostureStop = viewModel::postureStop,
                onEyeHeightChange = viewModel::setEyeHeight,
                onPitchChange = viewModel::setViewPitch,
                onYawChange = viewModel::setViewYaw,
                onViewAnim = viewModel::playViewAnim,
                onViewPitchStop = viewModel::stopViewPitch,
                onDisconnect = viewModel::disconnect,
                onReconnect = viewModel::reconnect,
                onLeave = viewModel::leaveControl,
                onFullscreenChange = viewModel::setFullscreen,
                onStartRecording = viewModel::startRecording,
                onStopRecording = viewModel::stopRecording,
                onShareRecording = { shareRecording(context, state.recordingPath) },
                onDismissRecording = viewModel::dismissRecordingNotice
            ),
            viewport = { modifier ->
                ControllerViewport(
                    viewModel = viewModel,
                    onFullscreen = viewModel::setFullscreen,
                    modifier = modifier
                )
            }
        )
    } else {
        PairingScreen(
            state = state,
            bluetoothEnabled = bluetoothEnabled,
            permissionsGranted = permissionsGranted,
            permissionRequested = permissionRequested,
            onScan = onScan,
            onStopScan = viewModel::stopScan,
            onCancelConnect = viewModel::cancelConnect,
            onEnableBluetooth = onEnableBluetooth,
            onOpenSettings = onOpenSettings
        )
    }
}

/** Hands a finished patient-view clip to the system share sheet. */
private fun shareRecording(context: Context, path: String?) {
    if (path == null) {
        Toast.makeText(context, "还没有可分享的录像", Toast.LENGTH_SHORT).show()
        return
    }
    val file = File(path)
    if (!file.exists()) {
        Toast.makeText(context, "找不到录像文件", Toast.LENGTH_SHORT).show()
        return
    }
    try {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.recordings",
            file
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "video/*"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "分享患者视角录像"))
    } catch (error: Exception) {
        Toast.makeText(context, "无法分享录像", Toast.LENGTH_SHORT).show()
    }
}
