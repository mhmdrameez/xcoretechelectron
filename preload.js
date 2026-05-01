// preload.js — minimal, zero-cost bridge. No logic here — just safe IPC relay.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Single reusable on() helper — auto-wraps handler to swallow errors
function on(channel, handler) {
  const wrapped = (_event, payload) => {
    try { handler(payload); } catch (_) {}
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    try { ipcRenderer.removeListener(channel, wrapped); } catch (_) {}
  };
}

contextBridge.exposeInMainWorld("api", {
  // ── commands ─────────────────────────────────────────────────────────────
  scanStart:          ()            => ipcRenderer.invoke("scan:start"),
  scanCancel:         ()            => ipcRenderer.invoke("scan:cancel"),
  cleanStart:         (targets)     => ipcRenderer.invoke("clean:start", targets),
  getAutoStart:       ()            => ipcRenderer.invoke("autostart:get"),
  setAutoStart:       (en)          => ipcRenderer.invoke("autostart:set", !!en),
  getStats:           ()            => ipcRenderer.invoke("stats:get"),
  getSystemInfo:      ()            => ipcRenderer.invoke("system:get"),
  getCounts:          ()            => ipcRenderer.invoke("analytics:getCounts"),
  trackEvent:         (p)           => ipcRenderer.invoke("analytics:track", p || {}),

  updateInstall:      ()            => ipcRenderer.invoke("update:install"),
  updateCheck:        ()            => ipcRenderer.invoke("update:check"),
  getStartupList:     ()            => ipcRenderer.invoke("startup:list"),
  setStartupEnabled:  (name, approvedKey, regFlag, enable) =>
    ipcRenderer.invoke("startup:setEnabled", { name, approvedKey, regFlag, enable }),

  // ── push events ──────────────────────────────────────────────────────────
  onScanReset:        (fn) => on("scan:reset",       fn),
  onScanProgress:     (fn) => on("scan:progress",    fn),
  onScanDone:         (fn) => on("scan:done",        fn),
  onCleanProgress:    (fn) => on("clean:progress",   fn),
  onCleanDone:        (fn) => on("clean:done",       fn),
  onStatsUpdate:      (fn) => on("stats:update",     fn),
  onStatus:           (fn) => on("status",           fn),
  onLog:              (fn) => on("log",              fn),
  onUpdateAvailable:  (fn) => on("update:available", fn),
  onUpdateProgress:   (fn) => on("update:progress",  fn),
  onUpdateDownloaded: (fn) => on("update:downloaded",fn),
  onUpdateStatus:     (fn) => on("update:status",    fn),
});
