package com.srk.meet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class Created(val code: String, val hostKey: String, val waitingRoom: Boolean)
data class Joined(val url: String, val token: String, val identity: String, val role: String)

class ApiException(message: String) : Exception(message)

/** Talks to the SRK Meet server (server/worker.js). */
class Api(private val baseUrl: String) {

    suspend fun create(waitingRoom: Boolean): Created {
        val o = post("/api/create", JSONObject().put("waitingRoom", waitingRoom))
        return Created(o.getString("code"), o.getString("hostKey"), o.optBoolean("waitingRoom"))
    }

    suspend fun token(code: String, name: String, hostKey: String?, identity: String?): Joined {
        val body = JSONObject().put("code", code).put("name", name)
        if (hostKey != null) body.put("hostKey", hostKey)
        if (identity != null) body.put("identity", identity)
        val o = post("/api/token", body)
        return Joined(o.getString("url"), o.getString("token"), o.getString("identity"), o.getString("role"))
    }

    suspend fun admit(code: String, hostKey: String, identity: String) = hostAction("/api/admit", code, hostKey, identity)
    suspend fun remove(code: String, hostKey: String, identity: String) = hostAction("/api/remove", code, hostKey, identity)
    suspend fun mute(code: String, hostKey: String, identity: String) = hostAction("/api/mute", code, hostKey, identity)
    suspend fun end(code: String, hostKey: String) = hostAction("/api/end", code, hostKey, null)

    fun inviteLink(code: String) = "$baseUrl/join.html?c=$code"

    private suspend fun hostAction(path: String, code: String, hostKey: String, identity: String?) {
        val body = JSONObject().put("code", code).put("hostKey", hostKey)
        if (identity != null) body.put("identity", identity)
        post(path, body)
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        if (baseUrl.isBlank()) throw ApiException("Set your meeting server address in Settings first.")
        val conn = try {
            URL(baseUrl + path).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw ApiException("Server address looks wrong. Check it in Settings.")
        }
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (code !in 200..299 || json == null) {
                throw ApiException(json?.optString("error")?.takeIf { it.isNotBlank() } ?: "Server error ($code)")
            }
            json
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException("Can't reach the meeting server. Check your internet.")
        } finally {
            conn.disconnect()
        }
    }
}
