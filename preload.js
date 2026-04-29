const { contextBridge, ipcRenderer } = require("electron");

function on(channel, handler) {
  const wrapped = (_event, payload) => {
    try {
      handler(payload);
    } catch (_) {
      // never break renderer due to handler errors
    }
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    try {
      ipcRenderer.removeListener(channel, wrapped);
    } catch (_) {}
  };
}

contextBridge.exposeInMainWorld("api", {
  scanStart: () => ipcRenderer.invoke("scan:start"),
  scanCancel: () => ipcRenderer.invoke("scan:cancel"),
  cleanStart: (retryTargets) => ipcRenderer.invoke("clean:start", retryTargets),
  getAutoStart: () => ipcRenderer.invoke("autostart:get"),
  setAutoStart: (enabled) => ipcRenderer.invoke("autostart:set", !!enabled),
  getStats: () => ipcRenderer.invoke("stats:get"),
  getSystemInfo: () => ipcRenderer.invoke("system:get"),
  getCounts: () => ipcRenderer.invoke("analytics:getCounts"),
  trackEvent: (payload) => ipcRenderer.invoke("analytics:track", payload || {}),
  updateInstall: () => ipcRenderer.invoke("update:install"),
  updateCheck:   () => ipcRenderer.invoke("update:check"),
  getStartupList:      ()                                          => ipcRenderer.invoke("startup:list"),
  setStartupEnabled:   (hive, name, approvedKey, regFlag, enable) => ipcRenderer.invoke("startup:setEnabled", { hive, name, approvedKey, regFlag, enable }),
  onScanReset: (fn) => on("scan:reset", fn),
  onScanProgress: (fn) => on("scan:progress", fn),
  onScanDone: (fn) => on("scan:done", fn),
  onCleanProgress: (fn) => on("clean:progress", fn),
  onCleanDone: (fn) => on("clean:done", fn),
  onStatsUpdate: (fn) => on("stats:update", fn),
  onStatus: (fn) => on("status", fn),
  onLog: (fn) => on("log", fn),
  onUpdateAvailable:  (fn) => on("update:available",  fn),
  onUpdateProgress:   (fn) => on("update:progress",   fn),
  onUpdateDownloaded: (fn) => on("update:downloaded", fn),
  onUpdateStatus:     (fn) => on("update:status",     fn),
});

