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
  getPlatform:        ()            => ipcRenderer.invoke("platform:get"),
  getCounts:          ()            => ipcRenderer.invoke("analytics:getCounts"),
  trackEvent:         (p)           => ipcRenderer.invoke("analytics:track", p || {}),
  updateInstall:      ()            => ipcRenderer.invoke("update:install"),
  updateCheck:        ()            => ipcRenderer.invoke("update:check"),
  getStartupList:     ()            => ipcRenderer.invoke("startup:list"),
  setStartupEnabled:  (id, enable)  => ipcRenderer.invoke("startup:setEnabled", { id, enable: !!enable }),

  // ── large files ──────────────────────────────────────────────────────────
  largeRoots:         ()            => ipcRenderer.invoke("large:roots"),
  largeScan:          (rootId, minBytes) => ipcRenderer.invoke("large:scan", { rootId, minBytes }),
  largeCancel:        ()            => ipcRenderer.invoke("large:cancel"),
  largeReveal:        (filePath)    => ipcRenderer.invoke("large:reveal", filePath),
  largeDelete:        (paths, permanent) => ipcRenderer.invoke("large:delete", { paths, permanent: !!permanent }),

  // ── developer caches ─────────────────────────────────────────────────────
  devDetect:          ()            => ipcRenderer.invoke("dev:detect"),
  devClean:           (ids)         => ipcRenderer.invoke("dev:clean", ids),

  // ── technician ───────────────────────────────────────────────────────────
  techInternetFix:    ()            => ipcRenderer.invoke("tech:internetFix"),
  techRamBoost:       ()            => ipcRenderer.invoke("tech:ramBoost"),
  techAutoFix:        ()            => ipcRenderer.invoke("tech:autoFix"),

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
  onTechProgress:     (fn) => on("tech:progress",    fn),
  onLargeProgress:    (fn) => on("large:progress",   fn),
  onDevProgress:      (fn) => on("dev:progress",     fn),
});
