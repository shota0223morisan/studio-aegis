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
  openSplice: (url) => ipcRenderer.invoke("splice:open", url),
  closeSplice: () => ipcRenderer.invoke("splice:close"),
  isSpliceOpen: () => ipcRenderer.invoke("splice:state"),
  /** Subscribe to the Splice side panel opening/closing. Returns an unsubscribe function. */
  onSplicePanel: (cb) => subscribe("splice-panel", (open) => cb(Boolean(open))),
  getInfo: () => ipcRenderer.invoke("app:info"),
  openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
  exportBackup: () => ipcRenderer.invoke("app:exportBackup"),
  checkForUpdate: () => ipcRenderer.invoke("app:checkForUpdate"),
  onUpdateAvailable: (cb) => subscribe("update-available", cb),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
});
