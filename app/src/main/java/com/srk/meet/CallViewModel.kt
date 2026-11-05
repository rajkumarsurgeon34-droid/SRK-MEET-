package com.srk.meet

import android.app.Application
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.LocalParticipant
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.participant.RemoteParticipant
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

sealed interface CallState {
    data object Idle : CallState
    data object Connecting : CallState
    data object Waiting : CallState
    data object InCall : CallState
    data class Ended(val message: String) : CallState
}

data class ChatMessage(val from: String, val text: String, val mine: Boolean, val time: Long)
data class FloatingReaction(val id: Long, val emoji: String, val from: String)

class CallViewModel(app: Application) : AndroidViewModel(app) {

    private val appCtx: Application = app

    val prefs = Prefs(app)
    private val api get() = Api(prefs.serverUrl)

    var state by mutableStateOf<CallState>(CallState.Idle); private set
    var room by mutableStateOf<Room?>(null); private set
    /** Bumped on every room event so the UI re-reads participants. */
    var tick by mutableIntStateOf(0); private set
    var code by mutableStateOf(""); private set
    var title by mutableStateOf(""); private set
    var role by mutableStateOf("guest"); private set
    var joinedAt by mutableLongStateOf(0L); private set
    var busy by mutableStateOf(false); private set

    /** Pre-join choices (also updated after permission results). */
    var micOn by mutableStateOf(true)
    var camOn by mutableStateOf(true)
    var frontCamera by mutableStateOf(true); private set

    /** A code opened from an invite link, waiting for the Join dialog. */
    var pendingJoinCode by mutableStateOf<String?>(null)

    val chat = mutableStateListOf<ChatMessage>()
    var unreadChat by mutableIntStateOf(0); private set
    private var chatVisible = false
    val reactions = mutableStateListOf<FloatingReaction>()
    val notices = MutableSharedFlow<String>(extraBufferCapacity = 16)

    val isHost get() = role == "host"
    private var hostKey: String? = null
    private var identity: String? = null
    private var eventsJob: Job? = null
    private var rejoining = false
    private val raisedHands = mutableSetOf<String>()

    // ---------- Starting and joining ----------

    fun startNew(meetingTitle: String, waitingRoom: Boolean) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val c = api.create(waitingRoom)
                prefs.saveHostKey(c.code, c.hostKey)
                join(c.code, meetingTitle)
            } catch (e: Exception) {
                notices.tryEmit(e.message ?: "Couldn't create the meeting")
            } finally {
                busy = false
            }
        }
    }

    fun schedule(
        meetingTitle: String, startMillis: Long, durationMin: Int, waitingRoom: Boolean,
        onDone: (ScheduledMeeting) -> Unit,
    ) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                val c = api.create(waitingRoom)
                val m = ScheduledMeeting(c.code, meetingTitle, startMillis, durationMin, c.waitingRoom, c.hostKey)
                prefs.saveMeeting(m)
                onDone(m)
            } catch (e: Exception) {
                notices.tryEmit(e.message ?: "Couldn't schedule the meeting")
            } finally {
                busy = false
            }
        }
    }

    fun join(meetingCode: String, meetingTitle: String = "") {
        val normalized = normalizeCode(meetingCode)
        if (normalized == null) {
            notices.tryEmit("That meeting code doesn't look right")
            return
        }
        code = normalized
        title = meetingTitle.ifBlank { prefs.meetings().firstOrNull { it.code == normalized }?.title.orEmpty() }
        hostKey = prefs.hostKey(normalized)
        chat.clear(); unreadChat = 0; reactions.clear(); raisedHands.clear()
        state = CallState.Connecting
        viewModelScope.launch {
            try {
                val joined = api.token(normalized, prefs.name.ifBlank { "Guest" }, hostKey, null)
                connectWith(joined)
            } catch (e: Exception) {
                cleanup()
                state = CallState.Ended(e.message ?: "Couldn't join the meeting")
            }
        }
    }

    private suspend fun connectWith(j: Joined) {
        val r = LiveKit.create(appCtx)
        room = r
        identity = j.identity
        role = j.role
        eventsJob?.cancel()
        eventsJob = viewModelScope.launch { r.events.collect { onEvent(r, it) } }
        r.connect(j.url, j.token)
        CallService.start(appCtx)
        if (j.role == "waiting") {
            state = CallState.Waiting
        } else {
            runCatching { r.localParticipant.setMicrophoneEnabled(micOn) }
            runCatching { r.localParticipant.setCameraEnabled(camOn) }
            if (joinedAt == 0L) joinedAt = System.currentTimeMillis()
            state = CallState.InCall
        }
        tick++
    }

    private fun rejoinAsGuest() {
        if (rejoining) return
        rejoining = true
        viewModelScope.launch {
            try {
                // Ask for the full token first, while the server can still see we were admitted.
                val joined = api.token(code, prefs.name.ifBlank { "Guest" }, null, identity)
                val old = room
                eventsJob?.cancel()
                old?.disconnect()
                old?.release()
                room = null
                state = CallState.Connecting
                connectWith(joined)
                notices.tryEmit("You're in. The host let you join.")
            } catch (e: Exception) {
                leave("Couldn't join after being admitted: ${e.message}")
            } finally {
                rejoining = false
            }
        }
    }

    /** Text for the "Connection details" dialog; null = hidden. */
    var diagText by mutableStateOf<String?>(null)
    private val subRequested = mutableSetOf<String>()

    fun showDiagnostics() {
        val r = room ?: return
        diagText = buildString {
            appendLine("SRK Meet ${BuildConfig.VERSION_NAME} · ${r.state}")
            appendLine("Server: ${prefs.serverUrl}")
            val lp = r.localParticipant
            appendLine()
            appendLine("You: $role · can receive=${lp.permissions?.canSubscribe} · can send=${lp.permissions?.canPublish}")
            if (lp.trackPublications.isEmpty()) appendLine("  sending nothing")
            lp.trackPublications.values.forEach { appendLine("  sending ${it.source}${if (it.muted) " (muted)" else ""}") }
            if (r.remoteParticipants.isEmpty()) appendLine("\nNo one else is connected.")
            r.remoteParticipants.values.forEach { p ->
                appendLine()
                appendLine("${p.displayName()} · ${p.role()}")
                if (p.trackPublications.isEmpty()) appendLine("  is not sending anything")
                p.trackPublications.values.forEach { pub ->
                    val got = if (pub.track != null) "receiving" else "NOT receiving"
                    appendLine("  ${pub.source}: $got${if (pub.muted) " (muted)" else ""}")
                }
            }
        }
    }

    /** Ask for every track we're not receiving yet (each one once). */
    private fun ensureSubscribed(r: Room) {
        if (state != CallState.InCall) return
        r.remoteParticipants.values.forEach { p ->
            if (p.isWaiting()) return@forEach
            p.trackPublications.values.forEach { pub ->
                val rp = pub as? RemoteTrackPublication ?: return@forEach
                if (rp.track == null && subRequested.add("${rp.sid}")) runCatching { rp.setSubscribed(true) }
            }
        }
    }

    private var admitting = false

    /**
     * The host let us in. The server gives this same connection permission to
     * send video, so we just turn on mic/camera — no reconnect (reconnecting with
     * the same identity left the host showing a stale, video-less tile).
     * Older servers don't grant permissions; then fall back to reconnecting.
     */
    private fun onAdmitted(r: Room) {
        if (admitting) return
        if (r.localParticipant.permissions?.canPublish == true) {
            admitting = true
            viewModelScope.launch {
                state = CallState.InCall
                if (joinedAt == 0L) joinedAt = System.currentTimeMillis()
                role = "guest"
                runCatching { r.localParticipant.setMicrophoneEnabled(micOn) }
                runCatching { r.localParticipant.setCameraEnabled(camOn) }
                subscribeAll(r)
                notices.tryEmit("You're in. The host let you join.")
                admitting = false
                tick++
            }
            return
        }
        // Wait briefly for the permission update; if it never comes, use the old path.
        viewModelScope.launch {
            delay(4000)
            if (room === r && state == CallState.Waiting && !admitting) rejoinAsGuest()
        }
    }

    /** Make sure we receive everyone's audio and video. */
    private fun subscribeAll(r: Room) {
        r.remoteParticipants.values.forEach { p ->
            p.trackPublications.values.forEach { pub ->
                (pub as? RemoteTrackPublication)?.let { runCatching { it.setSubscribed(true) } }
            }
        }
    }

    // ---------- Room events ----------

    private fun onEvent(r: Room, event: RoomEvent) {
        if (r !== room) return
        when (event) {
            is RoomEvent.DataReceived -> handleData(event.data, event.participant, event.topic)
            is RoomEvent.TrackPublished -> {
                val pub = event.publication
                if (pub is RemoteTrackPublication && state == CallState.InCall && pub.track == null) {
                    runCatching { pub.setSubscribed(true) }
                }
            }
            is RoomEvent.ParticipantConnected -> {
                val p = event.participant
                when {
                    p.isWaiting() && isHost -> notices.tryEmit("${p.displayName()} is waiting to join")
                    !p.isWaiting() && state == CallState.InCall -> notices.tryEmit("${p.displayName()} joined")
                }
            }
            is RoomEvent.ParticipantDisconnected -> {
                val p = event.participant
                raisedHands.remove(p.identityValue())
                if (!p.isWaiting() && state == CallState.InCall) notices.tryEmit("${p.displayName()} left")
            }
            is RoomEvent.ParticipantMetadataChanged -> {
                val p = event.participant
                if (p is LocalParticipant && state == CallState.Waiting && p.role() == "guest") onAdmitted(r)
            }
            is RoomEvent.ParticipantPermissionsChanged -> {
                if (event.participant is LocalParticipant && state == CallState.Waiting &&
                    r.localParticipant.role() == "guest") onAdmitted(r)
            }
            is RoomEvent.ParticipantAttributesChanged -> {
                val p = event.participant
                val id = p.identityValue()
                if (p.handRaised()) {
                    if (raisedHands.add(id) && p !is LocalParticipant) notices.tryEmit("✋ ${p.displayName()} raised their hand")
                } else {
                    raisedHands.remove(id)
                }
            }
            is RoomEvent.Disconnected -> {
                if (!rejoining) {
                    val msg = if (state == CallState.Waiting) "The host didn't let you in, or the meeting ended."
                    else "The meeting has ended or you were removed."
                    leave(msg)
                }
            }
            else -> Unit
        }
        ensureSubscribed(r)
        tick++
    }

    private fun handleData(data: ByteArray, from: RemoteParticipant?, topic: String?) {
        val o = runCatching { JSONObject(String(data, Charsets.UTF_8)) }.getOrNull() ?: return
        val name = from?.displayName() ?: o.optString("name", "Someone")
        when (topic) {
            "chat" -> {
                val text = o.optString("text").take(2000)
                if (text.isBlank()) return
                chat.add(ChatMessage(name, text, false, System.currentTimeMillis()))
                if (!chatVisible) unreadChat++
            }
            "reaction" -> showReaction(o.optString("emoji").take(8), name)
        }
    }

    private fun showReaction(emoji: String, from: String) {
        if (emoji.isBlank()) return
        val r = FloatingReaction(System.nanoTime(), emoji, from)
        reactions.add(r)
        viewModelScope.launch { delay(3500); reactions.remove(r) }
    }

    // ---------- Your own controls ----------

    fun toggleMic() = withRoom { r ->
        val on = !r.localParticipant.isMicrophoneEnabled
        if (r.localParticipant.setMicrophoneEnabled(on)) micOn = on
    }

    fun toggleCamera() = withRoom { r ->
        val on = !r.localParticipant.isCameraEnabled
        if (r.localParticipant.setCameraEnabled(on)) camOn = on
    }

    fun switchCamera() = withRoom { r ->
        val track = r.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack
            ?: return@withRoom
        frontCamera = !frontCamera
        track.switchCamera(position = if (frontCamera) CameraPosition.FRONT else CameraPosition.BACK)
    }

    fun startScreenShare(permissionData: Intent) = withRoom { r ->
        val ok = r.localParticipant.setScreenShareEnabled(
            true, ScreenCaptureParams(permissionData, onStop = { onScreenShareStopped() })
        )
        if (!ok) notices.tryEmit("Screen sharing couldn't start")
    }

    fun stopScreenShare() = withRoom { r -> r.localParticipant.setScreenShareEnabled(false) }

    private fun onScreenShareStopped() {
        tick++
    }

    fun toggleHand() = withRoom { r ->
        val up = !r.localParticipant.handRaised()
        r.localParticipant.updateAttributes(mapOf("hand" to if (up) "1" else "0"))
    }

    fun sendChat(text: String) = withRoom { r ->
        val clean = text.trim()
        if (clean.isEmpty()) return@withRoom
        val payload = JSONObject().put("text", clean).put("name", prefs.name).toString().toByteArray()
        r.localParticipant.publishData(payload, topic = "chat")
            .onSuccess { chat.add(ChatMessage("You", clean, true, System.currentTimeMillis())) }
            .onFailure { notices.tryEmit("Message not sent") }
    }

    fun sendReaction(emoji: String) = withRoom { r ->
        val payload = JSONObject().put("emoji", emoji).put("name", prefs.name).toString().toByteArray()
        r.localParticipant.publishData(payload, topic = "reaction")
        showReaction(emoji, "You")
    }

    fun setChatOpen(open: Boolean) {
        chatVisible = open
        if (open) unreadChat = 0
    }

    // ---------- Host controls ----------

    fun admit(p: Participant) = hostCall { api.admit(code, it, p.identityValue()) }

    fun admitAll() = hostCall { key ->
        room?.remoteParticipants?.values?.filter { it.isWaiting() }?.forEach { api.admit(code, key, it.identityValue()) }
    }

    fun deny(p: Participant) = hostCall { api.remove(code, it, p.identityValue()) }

    fun remove(p: Participant) = hostCall {
        api.remove(code, it, p.identityValue())
        notices.tryEmit("${p.displayName()} was removed")
    }

    fun mute(p: Participant) = hostCall { api.mute(code, it, p.identityValue()) }

    fun muteAll() = hostCall { key ->
        room?.remoteParticipants?.values
            ?.filter { !it.isWaiting() && it.isMicrophoneEnabled }
            ?.forEach { api.mute(code, key, it.identityValue()) }
        notices.tryEmit("Everyone else is muted")
    }

    fun endForAll() = hostCall {
        api.end(code, it)
        leave("You ended the meeting for everyone.")
    }

    fun inviteText(meetingCode: String = code, meetingTitle: String = title, whenText: String? = null): String {
        val name = prefs.name.ifBlank { "Someone" }
        return buildString {
            append("$name is inviting you to an SRK Meet meeting")
            if (meetingTitle.isNotBlank()) append(": $meetingTitle")
            append("\n")
            if (whenText != null) append("\nWhen: $whenText")
            append("\nMeeting code: $meetingCode")
            if (prefs.serverUrl.isNotBlank()) append("\nJoin link: ${api.inviteLink(meetingCode)}")
            append("\n\nOpen SRK Meet → Join → enter the code.")
        }
    }

    // ---------- Leaving ----------

    fun leave(message: String? = null) {
        cleanup()
        state = if (message != null) CallState.Ended(message) else CallState.Idle
    }

    fun backToHome() {
        state = CallState.Idle
    }

    private fun cleanup() {
        eventsJob?.cancel()
        eventsJob = null
        room?.let { r -> runCatching { r.disconnect() }; runCatching { r.release() } }
        room = null
        subRequested.clear()
        diagText = null
        joinedAt = 0L
        identity = null
        frontCamera = true
        CallService.stop(appCtx)
    }

    override fun onCleared() {
        cleanup()
        super.onCleared()
    }

    private fun withRoom(block: suspend (Room) -> Unit) {
        val r = room ?: return
        viewModelScope.launch {
            try { block(r) } catch (e: Exception) { notices.tryEmit(e.message ?: "Something went wrong") }
            tick++
        }
    }

    private fun hostCall(block: suspend (String) -> Unit) {
        val key = hostKey ?: return
        viewModelScope.launch {
            try { block(key) } catch (e: Exception) { notices.tryEmit(e.message ?: "That didn't work") }
            tick++
        }
    }
}
