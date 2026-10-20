package com.quietshore.control.ui

import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
                onAdvancedUnlockChange = viewModel::setAdvancedUnlocked,
                onViewMove = viewModel::moveView,
                onViewStop = viewModel::stopView,
                onDisconnect = viewModel::disconnect,
                onReconnect = viewModel::reconnect,
                onLeave = viewModel::leaveControl,
                onFullscreenChange = viewModel::setFullscreen
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
            onConnect = viewModel::connect,
            onCancelConnect = viewModel::cancelConnect,
            onEnableBluetooth = onEnableBluetooth,
            onOpenSettings = onOpenSettings
        )
    }
}
