package com.srk.meet.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.srk.meet.CallViewModel
import com.srk.meet.ScheduledMeeting
import com.srk.meet.normalizeCode
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private enum class HomeDialog { None, New, Join, Schedule, Settings }

@Composable
fun HomeScreen(vm: CallViewModel, withMedia: (() -> Unit) -> Unit) {
    val context = LocalContext.current
    val prefs = vm.prefs
    val snackbar = remember { SnackbarHostState() }
    var dialog by remember { mutableStateOf(HomeDialog.None) }
    var refresh by remember { mutableIntStateOf(0) }
    var name by remember { mutableStateOf(prefs.name) }
    val meetings = remember(refresh) { prefs.meetings().filter { it.startMillis + it.durationMin * 60_000L > System.currentTimeMillis() - 3_600_000L } }

    LaunchedEffect(Unit) { vm.notices.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm.pendingJoinCode) { if (vm.pendingJoinCode != null) dialog = HomeDialog.Join }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = Palette.Bg,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).systemBarsPadding().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(36.dp).background(Palette.Blue, RoundedCornerShape(10.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Videocam, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                    Spacer(Modifier.width(10.dp))
                    Text("SRK Meet", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = { dialog = HomeDialog.Settings }) { Icon(Icons.Filled.Settings, "Settings") }
                }
            }
            item {
                Text(
                    if (name.isBlank()) "Welcome! Add your name to get started." else "Hi, ${name.substringBefore(' ')} 👋",
                    color = Palette.Muted, fontSize = 15.sp,
                )
            }
            if (name.isBlank()) {
                item {
                    var draft by remember { mutableStateOf("") }
                    Column(Modifier.fillMaxWidth().background(Palette.Card, RoundedCornerShape(18.dp)).padding(16.dp)) {
                        Text("Your name", fontWeight = FontWeight.SemiBold)
                        Text("Shown to others in meetings", color = Palette.Muted, fontSize = 13.sp)
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(draft, { draft = it.take(40) }, singleLine = true, placeholder = { Text("e.g. Dr. M. Rajkumar") }, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(10.dp))
                        Button(onClick = { prefs.name = draft; name = prefs.name }, enabled = draft.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Save") }
                    }
                }
            }
            if (prefs.serverUrl.isBlank()) {
                item {
                    Column(
                        Modifier.fillMaxWidth().background(Palette.Amber.copy(alpha = 0.12f), RoundedCornerShape(18.dp))
                            .clickable { dialog = HomeDialog.Settings }.padding(16.dp)
                    ) {
                        Text("One-time setup: meeting server", fontWeight = FontWeight.SemiBold, color = Palette.Amber)
                        Text("Tap to paste your SRK Meet server address (see the README).", color = Palette.Muted, fontSize = 13.sp)
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ActionTile(
                        "New meeting", "Start now", Icons.Filled.Videocam,
                        Brush.linearGradient(listOf(Palette.Blue, Color(0xFF1D4ED8))),
                        Modifier.weight(1f),
                    ) { dialog = HomeDialog.New }
                    ActionTile(
                        "Join", "With a code", Icons.AutoMirrored.Filled.Login,
                        Brush.linearGradient(listOf(Color(0xFF0F766E), Color(0xFF115E59))),
                        Modifier.weight(1f),
                    ) { dialog = HomeDialog.Join }
                }
            }
            item {
                ActionTile(
                    "Schedule", "Plan a meeting and send invites", Icons.Filled.CalendarMonth,
                    Brush.linearGradient(listOf(Palette.CardHigh, Palette.Card)),
                    Modifier.fillMaxWidth(), tall = false,
                ) { dialog = HomeDialog.Schedule }
            }
            item {
                Text("Upcoming", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.padding(top = 8.dp))
            }
            if (meetings.isEmpty()) {
                item {
                    Text("No scheduled meetings. Tap Schedule to plan one.", color = Palette.Muted, fontSize = 14.sp)
                }
            }
            items(meetings, key = { it.code }) { m ->
                MeetingCard(
                    m,
                    onStart = { withMedia { vm.join(m.code, m.title) } },
                    onShare = { shareText(context, vm.inviteText(m.code, m.title, formatWhen(m.startMillis))) },
                    onCalendar = { addToCalendar(context, m, vm.inviteText(m.code, m.title, formatWhen(m.startMillis))) },
                    onDelete = { prefs.deleteMeeting(m.code); refresh++ },
                )
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    when (dialog) {
        HomeDialog.New -> NewMeetingDialog(
            busy = vm.busy,
            onDismiss = { dialog = HomeDialog.None },
            onStart = { title, waiting ->
                if (requireName(prefs.name, vm)) {
                    dialog = HomeDialog.None
                    withMedia { vm.startNew(title, waiting) }
                }
            },
        )
        HomeDialog.Join -> JoinDialog(
            initial = vm.pendingJoinCode.orEmpty(),
            askName = prefs.name.isBlank(),
            onDismiss = { dialog = HomeDialog.None; vm.pendingJoinCode = null },
            onJoin = { code, enteredName ->
                if (enteredName != null) { prefs.name = enteredName; name = prefs.name }
                dialog = HomeDialog.None
                vm.pendingJoinCode = null
                withMedia { vm.join(code) }
            },
        )
        HomeDialog.Schedule -> ScheduleDialog(
            busy = vm.busy,
            onDismiss = { dialog = HomeDialog.None },
            onSchedule = { title, start, duration, waiting ->
                if (requireName(prefs.name, vm)) {
                    vm.schedule(title, start, duration, waiting) { m ->
                        dialog = HomeDialog.None
                        refresh++
                        shareText(context, vm.inviteText(m.code, m.title, formatWhen(m.startMillis)))
                    }
                }
            },
        )
        HomeDialog.Settings -> SettingsDialog(vm, onDismiss = { dialog = HomeDialog.None; name = prefs.name; refresh++ })
        HomeDialog.None -> Unit
    }
}

private fun requireName(name: String, vm: CallViewModel): Boolean {
    if (name.isBlank()) vm.notices.tryEmit("Add your name first")
    return name.isNotBlank()
}

@Composable
private fun ActionTile(
    title: String, subtitle: String, icon: ImageVector, brush: Brush,
    modifier: Modifier, tall: Boolean = true, onClick: () -> Unit,
) {
    Column(
        modifier.background(brush, RoundedCornerShape(20.dp)).clickable(onClick = onClick)
            .padding(16.dp).height(if (tall) 104.dp else 56.dp),
        verticalArrangement = if (tall) Arrangement.SpaceBetween else Arrangement.Center,
    ) {
        if (tall) {
            Box(Modifier.size(40.dp).background(Color.White.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = Color.White)
            }
            Column {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Color.White)
                Text(subtitle, fontSize = 13.sp, color = Color.White.copy(alpha = 0.8f))
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = Palette.Teal)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(subtitle, fontSize = 13.sp, color = Palette.Muted)
                }
            }
        }
    }
}

@Composable
private fun MeetingCard(
    m: ScheduledMeeting, onStart: () -> Unit, onShare: () -> Unit, onCalendar: () -> Unit, onDelete: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(Palette.Card, RoundedCornerShape(18.dp)).padding(14.dp)) {
        Text(m.title.ifBlank { "Meeting" }, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text("${formatWhen(m.startMillis)} · ${m.durationMin} min", color = Palette.Muted, fontSize = 13.sp)
        Text(
            "Code ${m.code}" + if (m.waitingRoom) " · Waiting room" else "",
            color = Palette.Teal, fontSize = 13.sp,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onStart) { Text("Start") }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onShare) { Icon(Icons.Filled.Share, "Share invite") }
            IconButton(onClick = onCalendar) { Icon(Icons.Filled.EventAvailable, "Add to calendar") }
            IconButton(onClick = onDelete) { Icon(Icons.Filled.DeleteOutline, "Delete") }
        }
    }
}

@Composable
private fun NewMeetingDialog(busy: Boolean, onDismiss: () -> Unit, onStart: (String, Boolean) -> Unit) {
    var title by remember { mutableStateOf("") }
    var waiting by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New meeting") },
        text = {
            Column {
                OutlinedTextField(title, { title = it.take(60) }, label = { Text("Title (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                SwitchRow("Waiting room", "You let each person in", waiting) { waiting = it }
            }
        },
        confirmButton = {
            Button(onClick = { onStart(title.trim(), waiting) }, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Start")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun JoinDialog(initial: String, askName: Boolean, onDismiss: () -> Unit, onJoin: (String, String?) -> Unit) {
    var code by remember { mutableStateOf(initial) }
    var name by remember { mutableStateOf("") }
    val valid = normalizeCode(code)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join a meeting") },
        text = {
            Column {
                if (askName) {
                    OutlinedTextField(name, { name = it.take(40) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedTextField(
                    code, { code = it.take(80) }, label = { Text("Meeting code or link") },
                    placeholder = { Text("abc-defg-hij") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { valid?.let { onJoin(it, if (askName) name.trim() else null) } },
                enabled = valid != null && (!askName || name.isNotBlank()),
            ) { Text("Join") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ScheduleDialog(busy: Boolean, onDismiss: () -> Unit, onSchedule: (String, Long, Int, Boolean) -> Unit) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var waiting by remember { mutableStateOf(true) }
    var duration by remember { mutableIntStateOf(60) }
    var start by remember {
        mutableLongStateOf(Calendar.getInstance().apply {
            add(Calendar.HOUR_OF_DAY, 1); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Schedule a meeting") },
        text = {
            Column {
                OutlinedTextField(title, { title = it.take(60) }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { pickDate(context, start) { start = it } },
                        modifier = Modifier.weight(1.2f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                    ) {
                        Text(SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(start)), maxLines = 1, softWrap = false)
                    }
                    OutlinedButton(
                        onClick = { pickTime(context, start) { start = it } },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                    ) {
                        Text(SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(start)), maxLines = 1, softWrap = false)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text("Duration", color = Palette.Muted, fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(30, 60, 90, 120).forEach { d ->
                        FilterChip(
                            selected = duration == d,
                            onClick = { duration = d },
                            modifier = Modifier.weight(1f),
                            label = {
                                Text(
                                    if (d < 60) "${d}m" else "${d / 60.0}".removeSuffix(".0") + "h",
                                    maxLines = 1, softWrap = false,
                                    modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                                )
                            },
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                SwitchRow("Waiting room", "You let each person in", waiting) { waiting = it }
            }
        },
        confirmButton = {
            Button(onClick = { onSchedule(title.trim().ifBlank { "Meeting" }, start, duration, waiting) }, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Schedule")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SettingsDialog(vm: CallViewModel, onDismiss: () -> Unit) {
    val prefs = vm.prefs
    var name by remember { mutableStateOf(prefs.name) }
    var server by remember { mutableStateOf(prefs.serverUrl) }
    var cam by remember { mutableStateOf(prefs.startWithCamera) }
    var mic by remember { mutableStateOf(prefs.startWithMic) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Settings") },
        text = {
            Column {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    server, { server = it }, label = { Text("Meeting server address") },
                    placeholder = { Text("https://srk-meet.yourname.workers.dev") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                SwitchRow("Join with camera on", null, cam) { cam = it }
                SwitchRow("Join with microphone on", null, mic) { mic = it }
            }
        },
        confirmButton = {
            Button(onClick = {
                prefs.name = name
                prefs.serverUrl = server.let { if (it.isNotBlank() && !it.startsWith("http")) "https://$it" else it }
                prefs.startWithCamera = cam
                prefs.startWithMic = mic
                onDismiss()
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title)
            if (subtitle != null) Text(subtitle, color = Palette.Muted, fontSize = 12.sp)
        }
        Switch(checked, onChange)
    }
}

fun formatWhen(millis: Long): String =
    SimpleDateFormat("EEE, d MMM · h:mm a", Locale.getDefault()).format(Date(millis))

fun shareText(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, "Share invite"))
}

private fun addToCalendar(context: Context, m: ScheduledMeeting, invite: String) {
    val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, m.startMillis)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, m.startMillis + m.durationMin * 60_000L)
        .putExtra(CalendarContract.Events.TITLE, m.title.ifBlank { "SRK Meet meeting" })
        .putExtra(CalendarContract.Events.DESCRIPTION, invite)
        .putExtra(CalendarContract.Events.EVENT_LOCATION, "SRK Meet · ${m.code}")
    runCatching { context.startActivity(intent) }
}

private fun pickDate(context: Context, current: Long, onPicked: (Long) -> Unit) {
    val c = Calendar.getInstance().apply { timeInMillis = current }
    DatePickerDialog(context, { _, y, mo, d ->
        c.set(Calendar.YEAR, y); c.set(Calendar.MONTH, mo); c.set(Calendar.DAY_OF_MONTH, d)
        onPicked(c.timeInMillis)
    }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).apply {
        datePicker.minDate = System.currentTimeMillis() - 1000
    }.show()
}

private fun pickTime(context: Context, current: Long, onPicked: (Long) -> Unit) {
    val c = Calendar.getInstance().apply { timeInMillis = current }
    TimePickerDialog(context, { _, h, min ->
        c.set(Calendar.HOUR_OF_DAY, h); c.set(Calendar.MINUTE, min)
        onPicked(c.timeInMillis)
    }, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), false).show()
}
