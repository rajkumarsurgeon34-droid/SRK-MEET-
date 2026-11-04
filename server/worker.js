// SRK Meet server — issues LiveKit tokens and runs host controls (waiting room,
// admit, mute, remove, end meeting). Stateless: no database needed.
//
// Runs as a Cloudflare Worker (paste this file) or with Node 18+ (server.js).
// Required environment variables / secrets:
//   LIVEKIT_URL         e.g. wss://your-project.livekit.cloud
//   LIVEKIT_API_KEY     from LiveKit Cloud → Settings → Keys
//   LIVEKIT_API_SECRET  from the same page

const enc = new TextEncoder();
const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const ID_RE = /^[a-z0-9-]{3,64}$/;

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function signJwt(env, claims) {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(env.LIVEKIT_API_SECRET, `${header}.${body}`));
  return `${header}.${body}.${sig}`;
}

function now() { return Math.floor(Date.now() / 1000); }

function randomLetters(n, alphabet = "abcdefghijklmnopqrstuvwxyz") {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, (x) => alphabet[x % alphabet.length]).join("");
}

// First letter a–m = open meeting, n–z = waiting room on. The setting is part of
// the code itself, so it can never be changed or lost.
function newCode(waitingRoom) {
  const first = randomLetters(1, waitingRoom ? "nopqrstuvwxyz" : "abcdefghijklm");
  const rest = first + randomLetters(9);
  return `${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
}

function hasWaitingRoom(code) { return code[0] >= "n"; }

async function hostKeyFor(env, code) {
  return b64url(await hmac(env.LIVEKIT_API_SECRET, `host:${code}`)).slice(0, 22);
}

async function isHost(env, code, hostKey) {
  if (!hostKey) return false;
  const expected = await hostKeyFor(env, code);
  if (expected.length !== hostKey.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hostKey.charCodeAt(i);
  return diff === 0;
}

function apiBase(env) {
  return env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function roomService(env, method, body, room) {
  const token = await signJwt(env, {
    iss: env.LIVEKIT_API_KEY, sub: "srk-meet-server", nbf: now() - 10, exp: now() + 600,
    video: { room, roomAdmin: true, roomCreate: true, roomList: true },
  });
  const res = await fetch(`${apiBase(env)}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `LiveKit ${method}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function getParticipant(env, room, identity) {
  try { return await roomService(env, "GetParticipant", { room, identity }, room); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

function roleOf(info) {
  try { return JSON.parse(info?.metadata || "{}").role || "guest"; } catch { return "guest"; }
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "guest";
}

async function issueToken(env, { code, name, identity, role }) {
  const full = role !== "waiting";
  const video = {
    room: code, roomJoin: true,
    canPublish: full, canSubscribe: full, canPublishData: full, canUpdateOwnMetadata: full,
  };
  return signJwt(env, {
    iss: env.LIVEKIT_API_KEY, sub: identity, jti: identity, name,
    metadata: JSON.stringify({ role }),
    nbf: now() - 10, exp: now() + 6 * 3600, video,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function joinPage(code) {
  const link = `srkmeet://join/${code}`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Join SRK Meet</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#e8eefc;font-family:system-ui,sans-serif;text-align:center;padding:16px}
.c{max-width:360px}h1{font-size:22px;margin:0 0 8px}code{font-size:20px;letter-spacing:2px;color:#5eead4}
a{display:block;margin-top:24px;padding:14px;border-radius:14px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
p{color:#9fb0d0;font-size:14px}</style></head><body><div class="c">
<h1>You're invited to an SRK Meet meeting</h1><p>Meeting code</p><code>${code}</code>
<a href="${link}">Open in SRK Meet</a>
<p>Don't have the app? Open SRK Meet, tap <b>Join</b> and enter the code above.</p>
</div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET") {
    if (path === "/") return json({ ok: true, service: "srk-meet", configured: !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) });
    const m = path.match(/^\/j\/([a-z-]+)$/);
    if (m && CODE_RE.test(m[1])) return joinPage(m[1]);
    const c = (url.searchParams.get("c") || "").toLowerCase();
    if ((path === "/join.html" || path === "/join") && CODE_RE.test(c)) return joinPage(c);
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new HttpError(500, "Server is missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET");
  }

  let body = {};
  try { body = await request.json(); } catch { throw new HttpError(400, "Invalid JSON"); }

  if (path === "/api/create") {
    const code = newCode(!!body.waitingRoom);
    return json({ code, hostKey: await hostKeyFor(env, code), waitingRoom: hasWaitingRoom(code) });
  }

  const code = String(body.code || "").toLowerCase();
  if (!CODE_RE.test(code)) throw new HttpError(400, "Invalid meeting code");

  if (path === "/api/token") {
    const name = String(body.name || "").trim().slice(0, 40) || "Guest";
    const host = await isHost(env, code, body.hostKey);
    let identity = typeof body.identity === "string" && ID_RE.test(body.identity)
      ? body.identity : `${slug(name)}-${randomLetters(5, "abcdefghijkmnpqrstuvwxyz23456789")}`;
    let role = "guest";
    if (host) role = "host";
    else if (hasWaitingRoom(code)) {
      role = "waiting";
      // Re-joining after the host admitted you: the host's admit set your role to guest.
      if (body.identity) {
        const info = await getParticipant(env, code, identity);
        if (info && roleOf(info) === "guest") role = "guest";
      }
    }
    const token = await issueToken(env, { code, name, identity, role });
    return json({ url: env.LIVEKIT_URL, token, identity, role, waitingRoom: hasWaitingRoom(code) });
  }

  // Everything below is host-only.
  if (!(await isHost(env, code, body.hostKey))) throw new HttpError(403, "Only the host can do that");
  const identity = String(body.identity || "");

  switch (path) {
    case "/api/admit": {
      if (!ID_RE.test(identity)) throw new HttpError(400, "Invalid participant");
      await roomService(env, "UpdateParticipant", { room: code, identity, metadata: JSON.stringify({ role: "guest" }) }, code);
      return json({ ok: true });
    }
    case "/api/remove": {
      if (!ID_RE.test(identity)) throw new HttpError(400, "Invalid participant");
      await roomService(env, "RemoveParticipant", { room: code, identity }, code);
      return json({ ok: true });
    }
    case "/api/mute": {
      if (!ID_RE.test(identity)) throw new HttpError(400, "Invalid participant");
      const info = await getParticipant(env, code, identity);
      const tracks = (info?.tracks || []).filter((t) =>
        t.type === "AUDIO" || t.type === 0 || t.source === "MICROPHONE" || t.source === 2);
      for (const t of tracks) {
        if (t.muted) continue;
        await roomService(env, "MutePublishedTrack", { room: code, identity, track_sid: t.sid, muted: true }, code);
      }
      return json({ ok: true, muted: tracks.length });
    }
    case "/api/end": {
      await roomService(env, "DeleteRoom", { room: code }, code);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return json({ error: e.message || "Server error" }, e.status || 500); }
  },
};

// Exported for tests.
export { signJwt, hostKeyFor, newCode, hasWaitingRoom, issueToken };
