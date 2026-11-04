package com.srk.meet

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ScheduledMeeting(
    val code: String,
    val title: String,
    val startMillis: Long,
    val durationMin: Int,
    val waitingRoom: Boolean,
    val hostKey: String,
)

/** Small local store: your name, server address, scheduled meetings and host keys. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("srk_meet", Context.MODE_PRIVATE)

    var name: String
        get() = sp.getString("name", "") ?: ""
        set(v) = sp.edit().putString("name", v.trim()).apply()

    var serverUrl: String
        get() = (sp.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER_URL).trim().trimEnd('/')
        set(v) = sp.edit().putString("server", v.trim().trimEnd('/')).apply()

    var startWithCamera: Boolean
        get() = sp.getBoolean("cam_on", true)
        set(v) = sp.edit().putBoolean("cam_on", v).apply()

    var startWithMic: Boolean
        get() = sp.getBoolean("mic_on", true)
        set(v) = sp.edit().putBoolean("mic_on", v).apply()

    fun hostKey(code: String): String? = sp.getString("hk_$code", null)
    fun saveHostKey(code: String, key: String) = sp.edit().putString("hk_$code", key).apply()

    fun meetings(): List<ScheduledMeeting> {
        val arr = runCatching { JSONArray(sp.getString("meetings", "[]")) }.getOrDefault(JSONArray())
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            ScheduledMeeting(
                code = o.optString("code"),
                title = o.optString("title"),
                startMillis = o.optLong("start"),
                durationMin = o.optInt("duration", 60),
                waitingRoom = o.optBoolean("waiting"),
                hostKey = o.optString("hostKey"),
            )
        }.sortedBy { it.startMillis }
    }

    fun saveMeeting(m: ScheduledMeeting) {
        val list = meetings().filter { it.code != m.code } + m
        writeMeetings(list)
        saveHostKey(m.code, m.hostKey)
    }

    fun deleteMeeting(code: String) = writeMeetings(meetings().filter { it.code != code })

    private fun writeMeetings(list: List<ScheduledMeeting>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().apply {
                put("code", it.code); put("title", it.title); put("start", it.startMillis)
                put("duration", it.durationMin); put("waiting", it.waitingRoom); put("hostKey", it.hostKey)
            })
        }
        sp.edit().putString("meetings", arr.toString()).apply()
    }
}

/** Accepts "abc-defg-hij", "abcdefghij", a srkmeet:// link or an invite web link. */
fun normalizeCode(input: String): String? {
    val letters = input.trim().lowercase().substringAfterLast('/').filter { it in 'a'..'z' }
    if (letters.length != 10) return null
    return "${letters.substring(0, 3)}-${letters.substring(3, 7)}-${letters.substring(7)}"
}
