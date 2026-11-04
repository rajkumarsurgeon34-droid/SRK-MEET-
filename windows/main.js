// SRK Meet for Windows — main process.
// Opens the app window, talks to the SRK Meet server (no CORS issues from here),
// handles srkmeet:// invite links and lets the user pick a screen to share.
const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, clipboard, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;
let pendingLink = null;
let chosenSourceId = null;

// ---------- Invite links (srkmeet://join/abc-defg-hij) ----------

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("srkmeet", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("srkmeet");
}

function linkFrom(argv) {
  return argv.find((a) => typeof a === "string" && a.toLowerCase().startsWith("srkmeet://")) || null;
}

function sendLink(link) {
  if (!link) return;
  if (win && !win.webContents.isLoading()) win.webContents.send("invite-link", link);
  else pendingLink = link;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    sendLink(linkFrom(argv));
  });
}

// ---------- Window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1220",
    title: "SRK Meet",
    icon: path.join(__dirname, "renderer", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.webContents.on("did-finish-load", () => {
    const link = pendingLink || linkFrom(process.argv);
    pendingLink = null;
    if (link) win.webContents.send("invite-link", link);
  });

  // Links open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Ask before closing during a call.
  win.on("close", (e) => {
    if (win.__inCall) {
      const choice = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["Leave meeting", "Stay"],
        defaultId: 1,
        cancelId: 1,
        title: "SRK Meet",
        message: "You're in a meeting. Leave and close SRK Meet?",
      });
      if (choice !== 0) e.preventDefault();
    }
  });
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.srk.meet");

  // Camera, microphone and screen are allowed for the app's own page.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(["media", "display-capture", "clipboard-sanitized-write", "notifications", "fullscreen"].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Screen sharing: share whatever the user picked in the app's picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const source = sources.find((s) => s.id === chosenSourceId) || sources.find((s) => s.id.startsWith("screen:"));
      chosenSourceId = null;
      if (!source) return callback({});
      callback({ video: source, audio: source.id.startsWith("screen:") ? "loopback" : undefined });
    } catch {
      callback({});
    }
  });

  createWindow();
});

app.on("window-all-closed", () => app.quit());

// ---------- Calls from the app page ----------

ipcMain.handle("api", async (_e, { baseUrl, path: p, body }) => {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, error: "Set your meeting server address in Settings first." };
  let url;
  try { url = new URL(base + p); } catch { return { ok: false, error: "Server address looks wrong. Check it in Settings." }; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !data) return { ok: false, error: (data && data.error) || `Server error (${res.status})` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Can't reach the meeting server. Check your internet." };
  }
});

ipcMain.handle("screen-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((s) => !/^SRK Meet$/.test(s.name))
    .map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.toDataURL() }));
});

ipcMain.handle("choose-source", (_e, id) => { chosenSourceId = id; return true; });
ipcMain.handle("copy", (_e, text) => { clipboard.writeText(String(text || "")); return true; });
ipcMain.handle("open-external", (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle("set-in-call", (_e, on) => {
  if (win) win.__inCall = !!on;
  return true;
});
ipcMain.handle("notify", (_e, { title, body }) => {
  if (win && win.isFocused()) return false;
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || "SRK Meet"), body: String(body || "") });
  n.on("click", () => { if (win) { win.show(); win.focus(); } });
  n.show();
  if (win) win.flashFrame(true);
  return true;
});
ipcMain.handle("save-ics", async (_e, { filename, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save calendar invite",
    defaultPath: path.join(app.getPath("downloads"), filename || "srk-meet.ics"),
    filters: [{ name: "Calendar invite", extensions: ["ics"] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, "utf8");
  shell.openPath(filePath);
  return true;
});
