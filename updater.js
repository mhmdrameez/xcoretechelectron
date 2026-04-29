"use strict";
const { autoUpdater } = require("electron-updater");
const { ipcMain }     = require("electron");

let _send = null;   // set by initUpdater

function safeSend(channel, payload) {
  try { if (_send) _send(channel, payload); } catch (_) {}
}

function initUpdater(sendFn) {
  _send = sendFn;

  // Silent background download — user is asked only when ready to install
  autoUpdater.autoDownload        = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Disable dev-mode update check noise
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    safeSend("update:status", { phase: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    safeSend("update:available", {
      version:     info.version,
      releaseDate: info.releaseDate || null,
      releaseNotes: info.releaseNotes || null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    safeSend("update:status", { phase: "latest" });
  });

  autoUpdater.on("download-progress", (p) => {
    safeSend("update:progress", {
      percent:         Math.round(p.percent || 0),
      transferred:     p.transferred || 0,
      total:           p.total || 0,
      bytesPerSecond:  p.bytesPerSecond || 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    safeSend("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    // Silently ignore errors in production — updates are best-effort
    safeSend("update:status", { phase: "error", message: String(err && err.message ? err.message : err) });
  });

  // IPC: renderer requests install now
  ipcMain.handle("update:install", () => {
    try { autoUpdater.quitAndInstall(true, true); } catch (_) {}
    return { ok: true };
  });

  // IPC: renderer requests manual check
  ipcMain.handle("update:check", async () => {
    try { await autoUpdater.checkForUpdates(); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // Check 5 seconds after launch so it doesn't compete with startup I/O
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

module.exports = { initUpdater };
