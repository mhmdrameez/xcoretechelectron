"use strict";
const { autoUpdater } = require("electron-updater");
const { ipcMain }     = require("electron");

let _send = null;
let _downloadComplete = false;
let _updateChecking = false;

function safeSend(channel, payload) {
  try { if (_send) _send(channel, payload); } catch (_) {}
}

function initUpdater(sendFn) {
  _send = sendFn;

  // ── Core Settings ──────────────────────────────────────────────────────────
  autoUpdater.autoDownload         = true;   // Download silently in background
  autoUpdater.autoInstallOnAppQuit = true;   // Install when user closes the app
  autoUpdater.forceDevUpdateConfig = false;

  // CRITICAL: Skip code-signing / signature verification entirely.
  // Without a paid code-signing certificate, electron-updater will reject
  // every downloaded .exe and fire an "error" event, causing "update failed".
  autoUpdater.verifyUpdateCodeSignature = false;

  // Disable differential/delta downloads — they cause ENOENT on Windows
  autoUpdater.disableDifferentialDownload = true;

  // Silence logs in production
  autoUpdater.logger = null;

  // ── Events ─────────────────────────────────────────────────────────────────
  autoUpdater.on("checking-for-update", () => {
    safeSend("update:status", { phase: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    _downloadComplete = false;
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
    _downloadComplete = true;
    safeSend("update:downloaded", { version: info.version });

    // ── AUTO-RESTART: silently quit and install after a short delay ──
    // Give the renderer 3 seconds to show "Restarting…" then force install
    setTimeout(() => {
      try { autoUpdater.quitAndInstall(true, true); } catch (_) {}
    }, 3000);
  });

  autoUpdater.on("error", (err) => {
    // If the download already completed, ignore any post-download errors
    // (stale signature checks, ENOENT race conditions, etc.)
    if (_downloadComplete) return;

    const msg = String(err && err.message ? err.message : err || "Unknown error");
    safeSend("update:status", { phase: "error", error: msg });
  });

  // ── IPC: manual install (fallback if auto-restart didn't fire) ─────────
  ipcMain.handle("update:install", () => {
    try {
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 1500);
    } catch (_) {}
    return { ok: true };
  });

  // ── IPC: manual check ──────────────────────────────────────────────────
  ipcMain.handle("update:check", async () => {
    if (_updateChecking) return { ok: false, error: "Already checking." };
    _updateChecking = true;
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    } finally {
      _updateChecking = false;
    }
  });

  // ── Auto-check 5s after launch ─────────────────────────────────────────
  setTimeout(() => {
    _updateChecking = true;
    autoUpdater.checkForUpdates()
      .catch(() => {})
      .finally(() => { _updateChecking = false; });
  }, 5000);
}

module.exports = { initUpdater };
