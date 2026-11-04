// SRK Meet for Windows — the app page.
// Uses the same meeting server and the same LiveKit messages as the Android app,
// so Windows and Android people can be in the same meeting.
import {
  Room, RoomEvent, Track, createLocalVideoTrack,
} from "livekit-client";

const DEFAULT_SERVER = "https://srkmeet.rajkumarsurgeon34.workers.dev";
const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

// ================= Local settings =================

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const prefs = {
  get name() { return store.get("name", ""); },
  set name(v) { store.set("name", String(v || "").trim().slice(0, 40)); },
  get server() { return (store.get("server", "") || DEFAULT_SERVER).trim().replace(/\/+$/, ""); },
  set server(v) { store.set("server", String(v || "").trim().replace(/\/+$/, "")); },
  get startMic() { return store.get("startMic", true); },
  set startMic(v) { store.set("startMic", !!v); },
  get startCam() { return store.get("startCam", true); },
  set startCam(v) { store.set("startCam", !!v); },
  get camId() { return store.get("camId", ""); },
  set camId(v) { store.set("camId", v || ""); },
  get micId() { return store.get("micId", ""); },
  set micId(v) { store.set("micId", v || ""); },
  get spkId() { return store.get("spkId", ""); },
  set spkId(v) { store.set("spkId", v || ""); },
  hostKey(code) { return store.get("hostKeys", {})[code] || null; },
  saveHostKey(code, key) { const all = store.get("hostKeys", {}); all[code] = key; store.set("hostKeys", all); },
  meetings() { return store.get("meetings", []).sort((a, b) => a.start - b.start); },
  saveMeeting(m) { store.set("meetings", [...this.meetings().filter((x) => x.code !== m.code), m]); this.saveHostKey(m.code, m.hostKey); },
  deleteMeeting(code) { store.set("meetings", this.meetings().filter((x) => x.code !== code)); },
};

/** Accepts "abc-defg-hij", "abcdefghij", a srkmeet:// link or an invite web link. */
function normalizeCode(input) {
  let s = String(input || "").trim().toLowerCase();
  const q = s.match(/[?&]c=([a-z-]+)/);
  if (q) s = q[1];
  const letters = s.split("/").pop().replace(/[^a-z]/g, "");
  if (letters.length !== 10) return null;
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

// ================= Server =================

async function api(path, body) {
  const r = await window.srk.api(prefs.server, path, body);
  if (!r.ok) throw new Error(r.error || "Server error");
  return r.data;
}

const inviteLink = (code) => `${prefs.server}/join.html?c=${code}`;

function inviteText(code, title, whenText) {
  const name = prefs.name || "Someone";
  let t = `${name} is inviting you to an SRK Meet meeting${title ? `: ${title}` : ""}\n`;
  if (whenText) t += `\nWhen: ${whenText}`;
  t += `\nMeeting code: ${code}`;
  if (prefs.server) t += `\nJoin link: ${inviteLink(code)}`;
  t += "\n\nOpen SRK Meet → Join → enter the code.";
  return t;
}

// ================= Little UI helpers =================

function toast(text, ms = 3500) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
  while ($("toasts").children.length > 4) $("toasts").firstChild.remove();
}

function show(screenId) {
  for (const id of ["home", "status", "call"]) $(id).classList.toggle("hidden", id !== screenId);
}

function initials(name) {
  return String(name || "?").split(/[\s\-_]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function colorFor(id) {
  const colors = ["#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#9333ea"];
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtWhen(ms) {
  return new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ================= Participant info (same rules as Android) =================

function roleOf(p) {
  try { return JSON.parse(p.metadata || "{}").role || "guest"; } catch { return "guest"; }
}
const isWaiting = (p) => roleOf(p) === "waiting";
const displayName = (p) => (p.name && p.name.trim()) || p.identity || "Guest";
const handUp = (p) => (p.attributes || {}).hand === "1";

function videoTrackOf(p, source) {
  const pub = p.getTrackPublication(source);
  if (!pub || pub.isMuted || !pub.track) return null;
  return pub.track;
}

// ================= Home screen =================

let previewTrack = null;
let pvMicOn = prefs.startMic;
let pvCamOn = prefs.startCam;

async function startPreview() {
  stopPreview();
  updatePreviewButtons();
  $("previewAvatar").textContent = initials(prefs.name);
  $("previewAvatar").style.background = colorFor(prefs.name);
  if (!pvCamOn) { $("previewOff").classList.remove("hidden"); return; }
  try {
    previewTrack = await createLocalVideoTrack({ deviceId: prefs.camId || undefined, resolution: { width: 1280, height: 720 } });
    if (!$("home").classList.contains("hidden")) {
      previewTrack.attach($("previewVideo"));
      $("previewOff").classList.add("hidden");
    } else stopPreview();
  } catch (e) {
    $("previewOff").classList.remove("hidden");
    $("previewOff").querySelector("p").textContent = "Camera not available — check Windows privacy settings";
  }
}

function stopPreview() {
  if (previewTrack) { previewTrack.detach(); previewTrack.stop(); previewTrack = null; }
  $("previewOff").classList.remove("hidden");
  $("previewOff").querySelector("p").textContent = "Camera is off";
}

function updatePreviewButtons() {
  $("pvMic").classList.toggle("off", !pvMicOn);
  $("pvMic").textContent = pvMicOn ? "🎤" : "🔇";
  $("pvCam").classList.toggle("off", !pvCamOn);
}

function renderHome() {
  $("hello").textContent = prefs.name ? `Hi, ${prefs.name}` : "";
  $("serverCard").classList.toggle("hidden", !!prefs.server);
  renderUpcoming();
}

function renderUpcoming() {
  const box = $("upcoming");
  box.textContent = "";
  const cutoff = Date.now() - 6 * 3600 * 1000;
  const list = prefs.meetings().filter((m) => m.start + m.duration * 60000 > cutoff);
  if (!list.length) {
    box.appendChild(el("p", "muted small", "No scheduled meetings. Use Schedule to plan one and send the invite."));
    return;
  }
  for (const m of list) {
    const card = el("div", "meeting");
    card.appendChild(el("div", "t", m.title || "Meeting"));
    const soon = m.start - Date.now() < 15 * 60000;
    const w = el("div", "w", `${fmtWhen(m.start)} · ${m.duration} min · ${m.code}${m.waiting ? " · waiting room" : ""}`);
    if (soon) w.classList.add("soon");
    card.appendChild(w);
    const acts = el("div", "acts");
    const start = el("button", "btn small primary", "Start");
    start.onclick = () => joinMeeting(m.code, m.title);
    const share = el("button", "btn small", "Copy invite");
    share.onclick = async () => { await window.srk.copy(inviteText(m.code, m.title, fmtWhen(m.start))); toast("Invite copied"); };
    const cal = el("button", "btn small", "Add to calendar");
    cal.onclick = () => saveIcs(m);
    const del = el("button", "btn small", "Delete");
    del.onclick = () => { prefs.deleteMeeting(m.code); renderUpcoming(); };
    acts.append(start, share, cal, del);
    card.appendChild(acts);
    box.appendChild(card);
  }
}

function saveIcs(m) {
  const z = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SRK Meet//EN", "BEGIN:VEVENT",
    `UID:${m.code}@srkmeet`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(m.start)}`, `DTEND:${z(m.start + m.duration * 60000)}`,
    `SUMMARY:${esc(m.title || "SRK Meet meeting")}`,
    `DESCRIPTION:${esc(inviteText(m.code, m.title, fmtWhen(m.start)))}`,
    `URL:${inviteLink(m.code)}`,
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:SRK Meet meeting", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  window.srk.saveIcs(`srk-meet-${m.code}.ics`, ics);
}

async function startNew() {
  const btn = $("startBtn");
  btn.disabled = true;
  try {
    const c = await api("/api/create", { waitingRoom: $("newWaiting").checked });
    prefs.saveHostKey(c.code, c.hostKey);
    await joinMeeting(c.code, $("newTitle").value.trim());
    $("newTitle").value = "";
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function scheduleMeeting() {
  const title = $("schTitle").value.trim();
  const when = $("schWhen").value;
  if (!when) return toast("Pick a date and time");
  const start = new Date(when).getTime();
  if (start < Date.now() - 60000) return toast("That time has already passed");
  const btn = $("scheduleBtn");
  btn.disabled = true;
  try {
    const c = await api("/api/create", { waitingRoom: $("schWaiting").checked });
    const m = { code: c.code, title, start, duration: Number($("schDur").value), waiting: !!c.waitingRoom, hostKey: c.hostKey };
    prefs.saveMeeting(m);
    $("schTitle").value = "";
    renderUpcoming();
    await window.srk.copy(inviteText(m.code, m.title, fmtWhen(m.start)));
    toast("Scheduled. Invite copied — paste it to the people you're inviting.", 5000);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ================= Settings =================

async function fillDevices() {
  try {
    // Ask once so device names are visible.
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => null);
    if (s) s.getTracks().forEach((t) => t.stop());
  } catch { /* ignore */ }
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const fill = (sel, kind, current) => {
    sel.textContent = "";
    sel.appendChild(new Option("Windows default", ""));
    devs.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .forEach((d, i) => sel.appendChild(new Option(d.label || `${kind} ${i + 1}`, d.deviceId)));
    sel.value = [...sel.options].some((o) => o.value === current) ? current : "";
  };
  fill($("setCam"), "videoinput", prefs.camId);
  fill($("setMic"), "audioinput", prefs.micId);
  fill($("setSpk"), "audiooutput", prefs.spkId);
}

async function openSettings() {
  $("setName").value = prefs.name;
  $("setServer").value = store.get("server", "") || DEFAULT_SERVER;
  $("setStartMic").checked = prefs.startMic;
  $("setStartCam").checked = prefs.startCam;
  $("setCheck").textContent = "";
  $("settingsDlg").showModal();
  fillDevices();
}

async function saveSettings() {
  prefs.name = $("setName").value;
  prefs.server = $("setServer").value;
  prefs.startMic = $("setStartMic").checked;
  prefs.startCam = $("setStartCam").checked;
  prefs.camId = $("setCam").value;
  prefs.micId = $("setMic").value;
  prefs.spkId = $("setSpk").value;
  pvMicOn = prefs.startMic;
  pvCamOn = prefs.startCam;
  renderHome();
  if (call.room) applyDevicesToRoom();
  else startPreview();
  checkServer(true);
}

async function checkServer(quiet) {
  try {
    const r = await fetch(prefs.server + "/", { cache: "no-store" });
    const j = await r.json();
    if (!j.configured) toast("The meeting server is up but missing its LiveKit settings.", 6000);
    else if (!quiet) toast("Meeting server is working ✓");
  } catch {
    toast("Can't reach the meeting server. Check the address in Settings.", 6000);
  }
}

// ================= The call =================

const call = {
  room: null,
  code: "",
  title: "",
  role: "guest",
  identity: null,
  hostKey: null,
  joinedAt: 0,
  rejoining: false,
  leaving: false,
  timer: null,
  panelTab: null,
  unread: 0,
  raised: new Set(),
  tiles: new Map(), // identity -> { el, video, track }
  screenTrack: null,
};
const isHost = () => call.role === "host";

function setStatus({ title, text = "", spinner = true, icon = "", done = false }) {
  show("status");
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
  $("statusSpinner").classList.toggle("hidden", !spinner);
  $("statusIcon").classList.toggle("hidden", !icon);
  $("statusIcon").textContent = icon;
  $("statusCancel").classList.toggle("hidden", done);
  $("statusHome").classList.toggle("hidden", !done);
}

async function joinMeeting(rawCode, title = "") {
  const code = normalizeCode(rawCode);
  if (!code) return toast("That meeting code doesn't look right");
  if (!prefs.name) { await askName(); if (!prefs.name) return; }
  stopPreview();
  call.code = code;
  call.title = title || (prefs.meetings().find((m) => m.code === code) || {}).title || "";
  call.hostKey = prefs.hostKey(code);
  call.unread = 0; call.raised.clear(); call.leaving = false;
  $("chatList").innerHTML = '<p class="muted small center">Messages are only seen by people in the meeting.</p>';
  setStatus({ title: "Connecting…", text: `Meeting ${code}` });
  try {
    const j = await api("/api/token", { code, name: prefs.name || "Guest", hostKey: call.hostKey || undefined });
    if (call.leaving) return;
    await connectWith(j);
  } catch (e) {
    cleanup();
    ended(e.message || "Couldn't join the meeting");
  }
}

async function connectWith(j) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { deviceId: prefs.micId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { deviceId: prefs.camId || undefined, resolution: { width: 1280, height: 720, frameRate: 30 } },
    audioOutput: prefs.spkId ? { deviceId: prefs.spkId } : undefined,
    publishDefaults: { simulcast: true },
  });
  call.room = room;
  call.identity = j.identity;
  call.role = j.role;
  wireRoom(room);
  await room.connect(j.url, j.token);
  if (call.room !== room) return;
  window.srk.setInCall(true);
  if (j.role === "waiting") {
    setStatus({ title: "Waiting for the host", text: "The host will let you in soon. Keep this window open." });
    $("statusIcon").textContent = "⏳";
    return;
  }
  enterCall();
  room.localParticipant.setMicrophoneEnabled(pvMicOn).catch(() => toast("Microphone not available"));
  room.localParticipant.setCameraEnabled(pvCamOn).catch(() => toast("Camera not available"));
}

function enterCall() {
  show("call");
  if (!call.joinedAt) call.joinedAt = Date.now();
  $("callTitle").textContent = call.title || "Meeting";
  $("callCode").textContent = call.code;
  clearInterval(call.timer);
  call.timer = setInterval(updateTimer, 1000);
  updateTimer();
  render();
}

async function rejoinAsGuest() {
  if (call.rejoining) return;
  call.rejoining = true;
  try {
    const j = await api("/api/token", { code: call.code, name: prefs.name || "Guest", identity: call.identity });
    const old = call.room;
    call.room = null;
    if (old) await old.disconnect();
    setStatus({ title: "Joining…" });
    await connectWith(j);
    toast("You're in. The host let you join.");
  } catch (e) {
    leave(`Couldn't join after being admitted: ${e.message}`);
  } finally {
    call.rejoining = false;
  }
}

function wireRoom(room) {
  const mine = (fn) => (...args) => { if (call.room === room) fn(...args); };
  room
    .on(RoomEvent.ParticipantConnected, mine((p) => {
      if (isWaiting(p) && isHost()) { toast(`${displayName(p)} is waiting to join`); window.srk.notify("SRK Meet", `${displayName(p)} is waiting to join`); }
      else if (!isWaiting(p) && call.joinedAt) toast(`${displayName(p)} joined`);
      render();
    }))
    .on(RoomEvent.ParticipantDisconnected, mine((p) => {
      call.raised.delete(p.identity);
      if (!isWaiting(p) && call.joinedAt) toast(`${displayName(p)} left`);
      render();
    }))
    .on(RoomEvent.ParticipantMetadataChanged, mine((_m, p) => {
      if (p === room.localParticipant && call.role === "waiting" && roleOf(p) === "guest") rejoinAsGuest();
      render();
    }))
    .on(RoomEvent.ParticipantAttributesChanged, mine((_c, p) => {
      if (handUp(p)) {
        if (!call.raised.has(p.identity)) {
          call.raised.add(p.identity);
          if (p !== room.localParticipant) toast(`✋ ${displayName(p)} raised their hand`);
        }
      } else call.raised.delete(p.identity);
      render();
    }))
    .on(RoomEvent.TrackSubscribed, mine((track) => {
      if (track.kind === Track.Kind.Audio) {
        const a = track.attach();
        a.dataset.srk = "1";
        if (prefs.spkId && a.setSinkId) a.setSinkId(prefs.spkId).catch(() => {});
        document.body.appendChild(a);
      }
      render();
    }))
    .on(RoomEvent.TrackUnsubscribed, mine((track) => { track.detach().forEach((e) => e.remove()); render(); }))
    .on(RoomEvent.TrackMuted, mine(render))
    .on(RoomEvent.TrackUnmuted, mine(render))
    .on(RoomEvent.LocalTrackPublished, mine(render))
    .on(RoomEvent.LocalTrackUnpublished, mine((pub) => {
      if (pub.source === Track.Source.ScreenShare) updateControls();
      render();
    }))
    .on(RoomEvent.ActiveSpeakersChanged, mine(updateSpeaking))
    .on(RoomEvent.DataReceived, mine((payload, p, _kind, topic) => handleData(payload, p, topic)))
    .on(RoomEvent.Reconnecting, mine(() => toast("Connection lost — reconnecting…")))
    .on(RoomEvent.Reconnected, mine(() => toast("Reconnected")))
    .on(RoomEvent.Disconnected, mine(() => {
      if (call.rejoining || call.leaving) return;
      leave(call.role === "waiting"
        ? "The host didn't let you in, or the meeting ended."
        : "The meeting has ended or you were removed.");
    }));
}

function handleData(payload, from, topic) {
  let o;
  try { o = JSON.parse(dec.decode(payload)); } catch { return; }
  const name = from ? displayName(from) : (o.name || "Someone");
  if (topic === "chat") {
    const text = String(o.text || "").slice(0, 2000);
    if (!text.trim()) return;
    addChat(name, text, false);
    if (call.panelTab !== "chat") {
      call.unread++;
      updateControls();
      toast(`💬 ${name}: ${text.slice(0, 80)}`);
    }
    window.srk.notify(`${name} · SRK Meet`, text.slice(0, 120));
  } else if (topic === "reaction") {
    showReaction(String(o.emoji || "").slice(0, 8), name);
  }
}

function addChat(who, text, mine) {
  const list = $("chatList");
  const m = el("div", "msg" + (mine ? " mine" : ""));
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  m.appendChild(el("div", "who", `${mine ? "You" : who} · ${time}`));
  m.appendChild(el("div", "b", text));
  list.appendChild(m);
  list.scrollTop = list.scrollHeight;
}

function showReaction(emoji, from) {
  if (!emoji) return;
  const f = el("div", "floater");
  f.style.left = `${10 + Math.random() * 75}%`;
  f.appendChild(el("div", "e", emoji));
  f.appendChild(el("div", "f", from));
  $("reactions").appendChild(f);
  setTimeout(() => f.remove(), 3500);
}

// ---------- Drawing the meeting ----------

function visibleParticipants() {
  const r = call.room;
  if (!r) return [];
  const remotes = [...r.remoteParticipants.values()].filter((p) => !isWaiting(p));
  return [r.localParticipant, ...remotes];
}

function render() {
  const r = call.room;
  if (!r || $("call").classList.contains("hidden")) { updatePanels(); return; }
  const people = visibleParticipants();

  // Screen share takes the big area; tiles go to a strip.
  let sharer = null, screen = null;
  for (const p of people) {
    const t = videoTrackOf(p, Track.Source.ScreenShare);
    if (t) { sharer = p; screen = t; if (p !== r.localParticipant) break; }
  }
  $("stage").classList.toggle("sharing", !!screen);
  $("screenArea").classList.toggle("hidden", !screen);
  if (screen !== call.screenTrack) {
    if (call.screenTrack) call.screenTrack.detach($("screenVideo"));
    if (screen) screen.attach($("screenVideo"));
    call.screenTrack = screen;
  }
  if (sharer) $("screenLabel").textContent = sharer === r.localParticipant ? "You're sharing your screen" : `${displayName(sharer)} is sharing`;

  // Tiles
  const box = $("tiles");
  const seen = new Set();
  for (const p of people) {
    seen.add(p.identity);
    let t = call.tiles.get(p.identity);
    if (!t) {
      const tile = el("div", "tile" + (p === r.localParticipant ? " me" : ""));
      const video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.muted = true;
      const ph = el("div", "ph");
      const av = el("div", "avatar big");
      ph.appendChild(av);
      const nm = el("div", "name");
      const mic = el("span", "m");
      const n = el("span", "n");
      nm.append(mic, n);
      const hand = el("div", "hand", "✋");
      tile.append(video, ph, nm, hand);
      box.appendChild(tile);
      t = { el: tile, video, ph, av, mic, n, hand, track: null };
      call.tiles.set(p.identity, t);
    }
    const cam = videoTrackOf(p, Track.Source.Camera);
    if (cam !== t.track) {
      if (t.track) t.track.detach(t.video);
      if (cam) cam.attach(t.video);
      t.track = cam;
    }
    t.video.classList.toggle("hidden", !cam);
    t.ph.classList.toggle("hidden", !!cam);
    const name = displayName(p) + (p === r.localParticipant ? " (You)" : "");
    t.av.textContent = initials(displayName(p));
    t.av.style.background = colorFor(p.identity);
    t.n.textContent = name + (roleOf(p) === "host" ? " · Host" : "");
    t.mic.textContent = p.isMicrophoneEnabled ? "🎤" : "🔇";
    t.hand.classList.toggle("hidden", !handUp(p));
    t.el.classList.toggle("speaking", p.isSpeaking && p.isMicrophoneEnabled);
  }
  for (const [id, t] of call.tiles) {
    if (!seen.has(id)) { if (t.track) t.track.detach(t.video); t.el.remove(); call.tiles.delete(id); }
  }

  // Grid shape
  if (!screen) {
    const n = people.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5;
    const rows = Math.ceil(n / cols);
    box.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    box.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  } else {
    box.style.gridTemplateColumns = "";
    box.style.gridTemplateRows = "";
  }

  $("callCount").textContent = `👥 ${people.length}`;
  updateControls();
  updatePanels();
}

function updateSpeaking() {
  const r = call.room;
  if (!r) return;
  for (const p of visibleParticipants()) {
    const t = call.tiles.get(p.identity);
    if (t) t.el.classList.toggle("speaking", p.isSpeaking && p.isMicrophoneEnabled);
  }
}

function updateTimer() {
  if (!call.joinedAt) return;
  const s = Math.floor((Date.now() - call.joinedAt) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  $("callTimer").textContent = h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function setCtl(id, icon, label, cls) {
  const b = $(id);
  b.querySelector(".i").textContent = icon;
  b.querySelector(".l").textContent = label;
  b.classList.remove("on", "off", "hand-on");
  if (cls) b.classList.add(cls);
}

function updateControls() {
  const lp = call.room && call.room.localParticipant;
  if (!lp) return;
  const mic = lp.isMicrophoneEnabled, cam = lp.isCameraEnabled, share = lp.isScreenShareEnabled, hand = handUp(lp);
  setCtl("micBtn", mic ? "🎤" : "🔇", mic ? "Mute" : "Unmute", mic ? "" : "off");
  setCtl("camBtn", cam ? "📷" : "🚫", cam ? "Stop video" : "Start video", cam ? "" : "off");
  setCtl("shareBtn", "🖥️", share ? "Stop sharing" : "Share screen", share ? "on" : "");
  setCtl("handBtn", "✋", hand ? "Lower hand" : "Raise hand", hand ? "hand-on" : "");
  $("chatBadge").textContent = call.unread;
  $("chatBadge").classList.toggle("hidden", !call.unread);
  const waiting = call.room ? [...call.room.remoteParticipants.values()].filter(isWaiting).length : 0;
  $("waitBadge").textContent = waiting;
  $("waitBadge").classList.toggle("hidden", !(isHost() && waiting));
  $("leaveBtn").querySelector(".l").textContent = isHost() ? "Leave / End" : "Leave";
}

function updatePanels() {
  const r = call.room;
  if (!r) return;
  $("hostTools").classList.toggle("hidden", !isHost());
  const waiting = [...r.remoteParticipants.values()].filter(isWaiting);
  $("admitAllBtn").classList.toggle("hidden", !(isHost() && waiting.length > 1));

  const wl = $("waitingList");
  wl.textContent = "";
  if (isHost() && waiting.length) {
    wl.appendChild(el("div", "section-h", `Waiting to join (${waiting.length})`));
    for (const p of waiting) {
      const row = personRow(p);
      const acts = el("div", "acts");
      const ok = el("button", "green", "Admit");
      ok.onclick = () => hostCall("/api/admit", p.identity);
      const no = el("button", "red", "Deny");
      no.onclick = () => hostCall("/api/remove", p.identity);
      acts.append(ok, no);
      row.appendChild(acts);
      wl.appendChild(row);
    }
  }

  const pl = $("peopleList");
  pl.textContent = "";
  const people = visibleParticipants();
  pl.appendChild(el("div", "section-h", `In the meeting (${people.length})`));
  for (const p of people) {
    const row = personRow(p);
    const acts = el("div", "acts");
    if (handUp(p)) acts.appendChild(el("span", "", "✋"));
    acts.appendChild(el("span", "", p.isMicrophoneEnabled ? "🎤" : "🔇"));
    if (isHost() && p !== r.localParticipant) {
      if (p.isMicrophoneEnabled) {
        const m = el("button", "", "Mute");
        m.onclick = () => hostCall("/api/mute", p.identity);
        acts.appendChild(m);
      }
      const rm = el("button", "red", "Remove");
      rm.onclick = () => {
        if (confirm(`Remove ${displayName(p)} from the meeting?`)) hostCall("/api/remove", p.identity, `${displayName(p)} was removed`);
      };
      acts.appendChild(rm);
    }
    row.appendChild(acts);
    pl.appendChild(row);
  }
}

function personRow(p) {
  const row = el("div", "person");
  const av = el("div", "avatar", initials(displayName(p)));
  av.style.background = colorFor(p.identity);
  const n = el("div", "pn", displayName(p));
  if (p === call.room.localParticipant) n.appendChild(el("small", "", "(You)"));
  if (roleOf(p) === "host") n.appendChild(el("small", "", "Host"));
  row.append(av, n);
  return row;
}

async function hostCall(path, identity, okMessage) {
  if (!call.hostKey) return;
  try {
    await api(path, { code: call.code, hostKey: call.hostKey, identity });
    if (okMessage) toast(okMessage);
  } catch (e) {
    toast(e.message || "That didn't work");
  }
}

// ---------- Your controls ----------

async function toggleMic() {
  const lp = call.room?.localParticipant; if (!lp) return;
  try { await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled); } catch { toast("Microphone not available — check Windows privacy settings"); }
  render();
}

async function toggleCam() {
  const lp = call.room?.localParticipant; if (!lp) return;
  try { await lp.setCameraEnabled(!lp.isCameraEnabled); } catch { toast("Camera not available — check Windows privacy settings"); }
  render();
}

async function toggleShare() {
  const lp = call.room?.localParticipant; if (!lp) return;
  if (lp.isScreenShareEnabled) {
    await lp.setScreenShareEnabled(false).catch(() => {});
    return render();
  }
  const list = $("sourceList");
  list.innerHTML = '<p class="muted small">Loading…</p>';
  $("shareDlg").showModal();
  let sources = [];
  try { sources = await window.srk.screenSources(); } catch { /* ignore */ }
  list.textContent = "";
  if (!sources.length) list.appendChild(el("p", "muted", "Nothing to share was found."));
  sources.sort((a, b) => Number(b.screen) - Number(a.screen));
  for (const s of sources) {
    const b = el("button", "source");
    const img = document.createElement("img");
    img.src = s.thumb;
    b.append(img, el("div", "", s.screen ? `🖥️ ${s.name}` : s.name));
    b.onclick = async () => {
      $("shareDlg").close();
      await window.srk.chooseSource(s.id);
      try {
        await lp.setScreenShareEnabled(true, { audio: s.screen, selfBrowserSurface: "exclude", resolution: { width: 1920, height: 1080, frameRate: 15 } });
      } catch {
        toast("Screen sharing couldn't start");
      }
      render();
    };
    list.appendChild(b);
  }
}

async function toggleHand() {
  const lp = call.room?.localParticipant; if (!lp) return;
  try { await lp.setAttributes({ hand: handUp(lp) ? "0" : "1" }); } catch { toast("Couldn't raise your hand"); }
  render();
}

async function sendChat(text) {
  const lp = call.room?.localParticipant; if (!lp) return;
  const clean = text.trim();
  if (!clean) return;
  try {
    await lp.publishData(enc.encode(JSON.stringify({ text: clean, name: prefs.name })), { reliable: true, topic: "chat" });
    addChat("You", clean, true);
  } catch {
    toast("Message not sent");
  }
}

async function sendReaction(emoji) {
  const lp = call.room?.localParticipant; if (!lp) return;
  lp.publishData(enc.encode(JSON.stringify({ emoji, name: prefs.name })), { reliable: true, topic: "reaction" }).catch(() => {});
  showReaction(emoji, "You");
}

function openPanel(tab) {
  if (call.panelTab === tab) { closePanel(); return; }
  call.panelTab = tab;
  $("panel").classList.remove("hidden");
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b.dataset.tab === tab);
  $("tabChat").classList.toggle("hidden", tab !== "chat");
  $("tabPeople").classList.toggle("hidden", tab !== "people");
  if (tab === "chat") { call.unread = 0; updateControls(); setTimeout(() => $("chatInput").focus(), 0); }
  updatePanels();
}

function closePanel() {
  call.panelTab = null;
  $("panel").classList.add("hidden");
}

async function applyDevicesToRoom() {
  const r = call.room; if (!r) return;
  try { if (prefs.micId) await r.switchActiveDevice("audioinput", prefs.micId); } catch { /* ignore */ }
  try { if (prefs.camId) await r.switchActiveDevice("videoinput", prefs.camId); } catch { /* ignore */ }
  try { if (prefs.spkId) await r.switchActiveDevice("audiooutput", prefs.spkId); } catch { /* ignore */ }
  document.querySelectorAll("audio[data-srk]").forEach((a) => { if (prefs.spkId && a.setSinkId) a.setSinkId(prefs.spkId).catch(() => {}); });
}

// ---------- Leaving ----------

function cleanup() {
  call.leaving = true;
  const r = call.room;
  call.room = null;
  if (r) r.disconnect().catch(() => {});
  for (const [, t] of call.tiles) { if (t.track) t.track.detach(t.video); t.el.remove(); }
  call.tiles.clear();
  if (call.screenTrack) call.screenTrack.detach($("screenVideo"));
  call.screenTrack = null;
  document.querySelectorAll("audio[data-srk]").forEach((a) => a.remove());
  clearInterval(call.timer);
  call.joinedAt = 0;
  call.identity = null;
  call.role = "guest";
  closePanel();
  window.srk.setInCall(false);
}

function leave(message) {
  cleanup();
  if (message) ended(message);
  else goHome();
}

function ended(message) {
  setStatus({ title: "Meeting over", text: message, spinner: false, icon: "👋", done: true });
}

function goHome() {
  show("home");
  renderHome();
  startPreview();
}

async function endForAll() {
  try {
    await api("/api/end", { code: call.code, hostKey: call.hostKey });
    leave("You ended the meeting for everyone.");
  } catch (e) {
    toast(e.message);
  }
}

// ================= Name prompt =================

function askName() {
  return new Promise((resolve) => {
    const d = $("nameDlg");
    $("firstName").value = prefs.name;
    d.onclose = () => {
      const v = $("firstName").value.trim();
      if (v) prefs.name = v;
      renderHome();
      resolve();
    };
    d.showModal();
  });
}

// ================= Wiring =================

function wire() {
  $("openSettings").onclick = openSettings;
  $("bannerSettings").onclick = openSettings;
  $("saveSettings").onclick = () => setTimeout(saveSettings, 0);
  $("startBtn").onclick = startNew;
  $("joinBtn").onclick = () => joinMeeting($("joinCode").value);
  $("joinCode").onkeydown = (e) => { if (e.key === "Enter") joinMeeting($("joinCode").value); };
  $("scheduleBtn").onclick = scheduleMeeting;
  $("pvMic").onclick = () => { pvMicOn = !pvMicOn; updatePreviewButtons(); };
  $("pvCam").onclick = () => { pvCamOn = !pvCamOn; startPreview(); };

  $("statusCancel").onclick = () => leave();
  $("statusHome").onclick = goHome;

  $("micBtn").onclick = toggleMic;
  $("camBtn").onclick = toggleCam;
  $("shareBtn").onclick = toggleShare;
  $("shareCancel").onclick = () => $("shareDlg").close();
  $("handBtn").onclick = toggleHand;
  $("reactBtn").onclick = (e) => { e.stopPropagation(); $("reactMenu").classList.toggle("hidden"); };
  for (const b of $("reactMenu").querySelectorAll("button")) {
    b.onclick = () => { sendReaction(b.textContent); $("reactMenu").classList.add("hidden"); };
  }
  document.addEventListener("click", () => $("reactMenu").classList.add("hidden"));
  $("chatBtn").onclick = () => openPanel("chat");
  $("peopleBtn").onclick = () => openPanel("people");
  $("closePanel").onclick = closePanel;
  for (const b of document.querySelectorAll(".tab")) b.onclick = () => openPanel(b.dataset.tab);
  $("chatForm").onsubmit = (e) => { e.preventDefault(); sendChat($("chatInput").value); $("chatInput").value = ""; };
  $("muteAllBtn").onclick = async () => {
    const r = call.room; if (!r) return;
    for (const p of r.remoteParticipants.values()) if (!isWaiting(p) && p.isMicrophoneEnabled) await hostCall("/api/mute", p.identity);
    toast("Everyone else is muted");
  };
  $("admitAllBtn").onclick = async () => {
    const r = call.room; if (!r) return;
    for (const p of [...r.remoteParticipants.values()].filter(isWaiting)) await hostCall("/api/admit", p.identity);
  };

  $("inviteBtn").onclick = () => { $("inviteText").textContent = inviteText(call.code, call.title); $("inviteDlg").showModal(); };
  $("inviteClose").onclick = () => $("inviteDlg").close();
  $("inviteCopy").onclick = async () => { await window.srk.copy($("inviteText").textContent); $("inviteDlg").close(); toast("Invite copied"); };

  $("leaveBtn").onclick = () => { if (isHost()) $("leaveDlg").showModal(); else leave(); };
  $("leaveCancel").onclick = () => $("leaveDlg").close();
  $("leaveOnly").onclick = () => { $("leaveDlg").close(); leave(); };
  $("endAll").onclick = () => { $("leaveDlg").close(); endForAll(); };

  // Keyboard shortcuts in a call (like Teams/Zoom): Ctrl+D mic, Ctrl+E camera.
  document.addEventListener("keydown", (e) => {
    if ($("call").classList.contains("hidden") || !e.ctrlKey) return;
    if (e.key.toLowerCase() === "d") { e.preventDefault(); toggleMic(); }
    if (e.key.toLowerCase() === "e") { e.preventDefault(); toggleCam(); }
  });

  // Invite links: srkmeet://join/abc-defg-hij
  window.srk.onInviteLink((link) => {
    const code = normalizeCode(link);
    if (!code) return;
    if (call.room) return toast("Leave this meeting first to join another one");
    $("joinCode").value = code;
    joinMeeting(code);
  });

  // Default schedule time: next round half hour.
  const d = new Date(Date.now() + 30 * 60000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (x) => String(x).padStart(2, "0");
  $("schWhen").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

wire();
goHome();
if (!prefs.name) askName().then(startPreview);
// Re-check the upcoming list every minute so "starting soon" stays current.
setInterval(() => { if (!$("home").classList.contains("hidden")) renderUpcoming(); }, 60000);
