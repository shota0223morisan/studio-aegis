// Bridge exposed to the web UI as window.aegisDesktop.
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, cb) {
  const listener = (_e, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("aegisDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** Left pane (Spotify / Splice web views). */
  getPaneState: () => ipcRenderer.invoke("pane:get"),
  setPaneTab: (tab) => ipcRenderer.invoke("pane:setTab", tab),
  togglePane: (open) => ipcRenderer.invoke("pane:toggle", open),
  openInPane: (tab, url) => ipcRenderer.invoke("pane:open", tab, url),
  paneNav: (action) => ipcRenderer.invoke("pane:nav", action),
  webGo: (input) => ipcRenderer.invoke("pane:webGo", input),
  paneDrag: (screenX) => ipcRenderer.send("pane:drag", screenX),
  paneDragEnd: () => ipcRenderer.send("pane:dragEnd"),
  onPaneState: (cb) => subscribe("pane-state", cb),
  getInfo: () => ipcRenderer.invoke("app:info"),
  openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
  exportBackup: () => ipcRenderer.invoke("app:exportBackup"),
  checkForUpdate: () => ipcRenderer.invoke("app:checkForUpdate"),
  onUpdateAvailable: (cb) => subscribe("update-available", cb),
  /** Download, verify and install the latest version, then relaunch. */
  updateNow: () => ipcRenderer.invoke("app:updateNow"),
  onUpdateProgress: (cb) => subscribe("update-progress", cb),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
});
