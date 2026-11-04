package com.srk.meet

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import com.srk.meet.ui.CallScreen
import com.srk.meet.ui.HomeScreen
import com.srk.meet.ui.SrkTheme

class MainActivity : ComponentActivity() {

    private val vm: CallViewModel by viewModels()
    private var afterPermissions: (() -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            applyMediaChoices(result)
            val action = afterPermissions
            afterPermissions = null
            action?.invoke()
        }

    private val screenShareLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) vm.startScreenShare(data)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleLink(intent)
        setContent {
            SrkTheme {
                if (vm.state == CallState.Idle) {
                    HomeScreen(vm, withMedia = ::withMedia)
                } else {
                    CallScreen(vm, requestScreenShare = ::requestScreenShare)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** srkmeet://join/abc-defg-hij opens the Join dialog with the code filled in. */
    private fun handleLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "srkmeet") return
        val code = normalizeCode(uri.toString()) ?: return
        if (vm.state == CallState.Idle) vm.pendingJoinCode = code
        else Toast.makeText(this, "Leave this meeting first to join $code", Toast.LENGTH_LONG).show()
    }

    /** Asks for camera, microphone and notification permission, then runs [action]. */
    private fun withMedia(action: () -> Unit) {
        val wanted = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = wanted.filter { !granted(it) }
        if (missing.isEmpty()) {
            applyMediaChoices(emptyMap())
            action()
        } else {
            afterPermissions = action
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun applyMediaChoices(result: Map<String, Boolean>) {
        val mic = result[Manifest.permission.RECORD_AUDIO] ?: granted(Manifest.permission.RECORD_AUDIO)
        val cam = result[Manifest.permission.CAMERA] ?: granted(Manifest.permission.CAMERA)
        vm.micOn = mic && vm.prefs.startWithMic
        vm.camOn = cam && vm.prefs.startWithCamera
        if (!mic) Toast.makeText(this, "Microphone is off: permission not given", Toast.LENGTH_LONG).show()
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun requestScreenShare() {
        val mpm = getSystemService(MediaProjectionManager::class.java) ?: return
        screenShareLauncher.launch(mpm.createScreenCaptureIntent())
    }
}
