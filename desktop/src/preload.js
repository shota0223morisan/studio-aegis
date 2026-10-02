// Bridge exposed to the web app (and the local setup/error pages) as window.aegisDesktop.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aegisDesktop", {
  isDesktop: true,
  platform: process.platform,
  openSplice: (url) => ipcRenderer.invoke("splice:open", url),
  closeSplice: () => ipcRenderer.invoke("splice:close"),
  isSpliceOpen: () => ipcRenderer.invoke("splice:state"),
  /** Subscribe to the Splice side panel opening/closing. Returns an unsubscribe function. */
  onSplicePanel: (cb) => {
    const listener = (_e, open) => cb(Boolean(open));
    ipcRenderer.on("splice-panel", listener);
    return () => ipcRenderer.removeListener("splice-panel", listener);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  setServerUrl: (url) => ipcRenderer.invoke("config:setServerUrl", url),
  retry: () => ipcRenderer.invoke("app:retry"),
  showSetup: () => ipcRenderer.invoke("app:showSetup"),
});
