"use strict";

const { sendEvent } = require("./analytics");
const { formatBytes, debounceMs } = require("./utils");

let _scanner = null;
const scanner = () => (_scanner ||= require("./scanner"));
let _cleaner = null;
const cleaner = () => (_cleaner ||= require("./cleaner"));

/**
 * Handles the automatic scan and clean sequence.
 * @param {Object} options 
 * @param {Function} options.sendStatus - Function to update status text.
 * @param {Function} options.send - Function to send IPC messages to renderer.
 */
async function runAutoClean({ sendStatus, send }) {
  try {
    // 1. Initial logs - fire and forget so scan starts immediately
    // app_open is already logged in main.js, so we only log scan_start here.
    sendEvent("activity", { name: "System Boot", junk: "scan_start" }, { force: true, immediate: true });

    sendStatus("Auto-clean: scanning…");
    const cancel = { cancelled: false };
    const progressSend = debounceMs((p) => send("scan:progress", p), 150);
    const logSend = debounceMs((p) => send("log", p), 300);

    const scanResult = await scanner().scanDefaultTargets({
      cancel,
      onProgress: progressSend,
      onLog: logSend,
    });

    sendStatus(`Auto-clean: found ${scanResult.files.length} files (${formatBytes(scanResult.totalBytes)}).`);

    // Update UI with scan results
    send("scan:done", { 
      ok: true, 
      totalFiles: scanResult.files.length, 
      totalBytes: scanResult.totalBytes, 
      allFiles: scanResult.files 
    });

    if (scanResult.files.length === 0) {
      sendStatus("Auto-clean: nothing to clean.");
      return;
    }

    // 3. Log clean_start with file count - don't await so cleaning starts immediately
    sendEvent("activity", { name: "System Boot", junk: `clean_start | ${scanResult.files.length} files` }, { force: true, immediate: true });

    sendStatus("Auto-clean: cleaning…");
    const cleanStartMs = Date.now();
    const cleanResult = await cleaner().cleanFiles(scanResult.files, scanResult.directories, {
      onProgress: progressSend,
      onLog: logSend,
    });
    const durationMs = Date.now() - cleanStartMs;

    // 4. Log cleanup_done with results immediately
    await sendEvent("cleanup_done", { 
      name: "System Boot", 
      junk: `${formatBytes(scanResult.totalBytes)} | ${cleanResult.deleted} deleted` 
    }, { force: true, immediate: true });

    sendStatus(`Auto-clean: completed. Deleted ${cleanResult.deleted} items.`);
    
    // Notify the UI
    send("status", { text: "Auto-clean: completed." });
    
    // Send clean:done to update dashboard stats if UI is open
    // Note: In a real system, we'd recalculate stats properly here.
    // For now, we'll signal completion so the UI can refresh if needed.
    send("clean:done", { 
      ok: true, 
      deleted: cleanResult.deleted, 
      skipped: cleanResult.skipped,
      freedBytes: scanResult.totalBytes, // Rough estimate
      durationMs: durationMs,
      remainingFiles: [],
      remainingBytes: 0
    });

  } catch (err) {
    console.error("[Automation] Auto-clean error:", err);
    await sendEvent("crash", { name: "AutoClean Error", error: String(err.message || err) }, { force: true, immediate: true });
    sendStatus("Auto-clean: failed.");
  }
}

module.exports = { runAutoClean };
