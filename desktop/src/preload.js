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
  /** Side panes (left / right) with site tabs. */
  getPaneState: () => ipcRenderer.invoke("pane:get"),
  setPaneTab: (tab) => ipcRenderer.invoke("pane:setTab", tab),
  togglePane: (side, open) => ipcRenderer.invoke("pane:toggle", side, open),
  openInPane: (tab, url) => ipcRenderer.invoke("pane:open", tab, url),
  paneNav: (side, action) => ipcRenderer.invoke("pane:nav", side, action),
  webGo: (input) => ipcRenderer.invoke("pane:webGo", input),
  moveTab: (tab) => ipcRenderer.invoke("pane:moveTab", tab),
  swapPanes: () => ipcRenderer.invoke("pane:swap"),
  applyPreset: (name) => ipcRenderer.invoke("pane:preset", name),
  tabMenu: (tab) => ipcRenderer.invoke("pane:tabMenu", tab),
  nowPlaying: () => ipcRenderer.invoke("pane:nowPlaying"),
  /** Play a song in the YT Music tab (position "1:23" optional). */
  playSong: (req) => ipcRenderer.invoke("media:play", req),
  paneDrag: (side, screenX) => ipcRenderer.send("pane:drag", side, screenX),
  paneDragEnd: () => ipcRenderer.send("pane:dragEnd"),
  onPaneState: (cb) => subscribe("pane-state", cb),
  /** Start dragging a MIDI clip's file out of the app (e.g. into Logic / Ableton). */
  dragMidi: (clipId) => ipcRenderer.send("app:dragMidi", clipId),
  copyText: (text) => ipcRenderer.invoke("app:copyText", text),
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
