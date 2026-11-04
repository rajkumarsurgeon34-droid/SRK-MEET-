// Safe bridge between the app page and the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("srk", {
  api: (baseUrl, path, body) => ipcRenderer.invoke("api", { baseUrl, path, body }),
  screenSources: () => ipcRenderer.invoke("screen-sources"),
  chooseSource: (id) => ipcRenderer.invoke("choose-source", id),
  copy: (text) => ipcRenderer.invoke("copy", text),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setInCall: (on) => ipcRenderer.invoke("set-in-call", on),
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  saveIcs: (filename, content) => ipcRenderer.invoke("save-ics", { filename, content }),
  onInviteLink: (fn) => ipcRenderer.on("invite-link", (_e, link) => fn(link)),
});
