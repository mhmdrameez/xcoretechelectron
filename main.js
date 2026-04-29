"use strict";
// ── V8 / Chromium tuning — set BEFORE anything else ──────────────────────────
// Works both in dev and packaged (electron-builder doesn't strip commandLine).
try {
  const { app: _a } = require("electron");
  // Keep the renderer heap small; GC more aggressively.
  _a.commandLine.appendSwitch("js-flags",
    "--max-old-space-size=96 --optimize-for-size --gc-interval=100");
  // No GPU needed — saves ~30 MB VRAM + one extra process.
  _a.disableHardwareAcceleration();
  // Reduce IPC serialisation overhead.
  _a.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
  // Disable unused Chromium services in the renderer.
  _a.commandLine.appendSwitch("disable-features",
    "TranslateUI,MediaRouter,AutofillServerCommunication,Translate," +
    "CalculateNativeWinOcclusion,OptimizationHints,NetworkPrediction," +
    "HeavyAdIntervention,InterestFeedContentSuggestions,PrivacySandboxSettings4," +
    "SafeBrowsing,SafeBrowsingEnhancedProtection");
  _a.commandLine.appendSwitch("disable-dev-shm-usage");
  _a.commandLine.appendSwitch("disable-renderer-backgrounding");
  _a.commandLine.appendSwitch("disable-background-timer-throttling");
  _a.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  _a.commandLine.appendSwitch("disable-software-rasterizer");
  _a.commandLine.appendSwitch("disable-dev-tools");
} catch (_) {}

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require("electron");
const fs   = require("fs");
const { exec }  = require("child_process");
const path = require("path");

// Lazy-load heavy modules — not needed until the user clicks something.
let _scanner  = null; const scanner  = () => (_scanner  ||= require("./scanner"));
let _cleaner  = null; const cleaner  = () => (_cleaner  ||= require("./cleaner"));
let _updater  = null; const updater  = () => (_updater  ||= require("./updater"));
let _automation = null; const automation = () => (_automation ||= require("./automation"));

const { getSystemInfo }  = require("./systemInfo");
const { initAnalytics, sendEvent, getUserCounts } = require("./analytics");
const { installCrashHandler }  = require("./crashHandler");
const { primeLocation, getLocation } = require("./location");
const { getAutoStartEnabled, setAutoStartEnabled, formatBytes, debounceMs } = require("./utils");

installCrashHandler(sendEvent);

// ── globals ───────────────────────────────────────────────────────────────────
let mainWindow       = null;
let tray             = null;
let isQuitting       = false;
let currentScanCancel = null;
let lastScanResult   = { files: [], directories: [], totalBytes: 0 };
let autoCleanRunning = false;
let cleanRunning     = false;
const cleanStats = { totalRuns: 0, totalDeletedItems: 0, totalBytesFreed: 0, totalDurationMs: 0, lastRunAt: null };

// ── stats snapshot ────────────────────────────────────────────────────────────
function getStatsSnapshot() {
  const runs = cleanStats.totalRuns || 0;
  const gbFreed = cleanStats.totalBytesFreed / (1024 ** 3);
  return {
    totalRuns:       runs,
    totalDeletedItems: cleanStats.totalDeletedItems,
    totalBytesFreed: cleanStats.totalBytesFreed,
    totalDurationMs: cleanStats.totalDurationMs,
    lastRunAt:       cleanStats.lastRunAt,
    avgDurationMs:   runs > 0 ? Math.round(cleanStats.totalDurationMs / runs) : 0,
    estimatedSpeedBoostPercent:
      Math.min(45, Math.round(gbFreed * 2.5 + Math.log10(gbFreed + 1) * 6)) || 0,
  };
}

// ── icon — resolved once, cached ─────────────────────────────────────────────
let _iconPath = null;
function resolveIconPath() {
  if (_iconPath !== null) return _iconPath;
  const ico = path.join(__dirname, "assets", "app-icon.ico");
  const png = path.join(__dirname, "assets", "app-icon.png");
  _iconPath = fs.existsSync(ico) ? ico : fs.existsSync(png) ? png : "";
  return _iconPath || undefined;
}

// ── IPC send helpers ──────────────────────────────────────────────────────────
function send(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(channel, payload);
  } catch (_) {}
}
const sendStatus = (text) => send("status", { text: String(text || "") });

// ── window ────────────────────────────────────────────────────────────────────
function showMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (_) {}
}

function createTray() {
  if (tray) return;
  const iconPath = resolveIconPath();
  if (!iconPath) return;
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip("XCoreTech Disk Cleaner");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Cleaner", click: showMainWindow },
      { label: "Exit", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on("click", showMainWindow);
  } catch (_) { tray = null; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820, height: 620, minWidth: 760, minHeight: 520,
    show: false,
    backgroundColor: "#0b0f14",
    icon: resolveIconPath(),
    webPreferences: {
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
      spellcheck:        false,
      // v8 cache — persist compiled bytecode across launches (faster load)
      v8CacheOptions:    "bypassHeatCheck",
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  const isHidden = process.argv.some((a) => a.toLowerCase() === "--hidden");
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !isHidden) mainWindow.show();
  });
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform === "darwin") return;
    event.preventDefault();
    mainWindow.hide();
    // Release renderer memory when window is hidden
    try { mainWindow.webContents.setBackgroundThrottling(true); } catch (_) {}
    sendStatus("Running in background. Click tray icon to reopen.");
  });

  // Free renderer heap when window goes to background
  mainWindow.on("hide", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setBackgroundThrottling(true);
      }
    } catch (_) {}
  });
  mainWindow.on("show", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setBackgroundThrottling(false);
      }
    } catch (_) {}
  });
}

// ── path de-duplication ───────────────────────────────────────────────────────
function toUniquePathList(input) {
  if (!Array.isArray(input) || !input.length) return [];
  const seen = new Set();
  const out  = [];
  for (let i = 0; i < input.length; i++) {
    const p = String(input[i] || "").trim();
    if (!p) continue;
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

// ── post-clean stat recalculation — batched parallel stat calls ───────────────
const STAT_BATCH = 64;
async function statBatch(paths) {
  const results = [];
  for (let start = 0; start < paths.length; start += STAT_BATCH) {
    const slice = paths.slice(start, start + STAT_BATCH);
    const batch = await Promise.allSettled(slice.map(p => fs.promises.stat(p)));
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].status === "fulfilled") results.push({ path: slice[i], stat: batch[i].value });
    }
    await new Promise(setImmediate);
  }
  return results;
}

async function recalculate(files, directories) {
  const inputFiles = Array.isArray(files) ? files : [];
  const inputDirs  = Array.isArray(directories) ? directories : [];
  const [fileStats, dirStats] = await Promise.all([
    statBatch(inputFiles), statBatch(inputDirs),
  ]);
  const remainingFiles = [];
  let   remainingBytes = 0;
  for (let i = 0; i < fileStats.length; i++) {
    if (fileStats[i].stat.isFile()) {
      remainingFiles.push(fileStats[i].path);
      remainingBytes += fileStats[i].stat.size;
    }
  }
  const remainingDirectories = [];
  for (let i = 0; i < dirStats.length; i++) {
    if (dirStats[i].stat.isDirectory()) remainingDirectories.push(dirStats[i].path);
  }
  remainingDirectories.sort((a, b) => b.length - a.length);
  return { files: remainingFiles, directories: remainingDirectories, totalBytes: remainingBytes };
}

// ── Startup programs — registry + shell folders ───────────────────────────────
const STARTUP_REG_SOURCES = [
  { label: "HKCU Run",     hive: "HKCU",   regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" },
  { label: "HKCU RunOnce",hive: "HKCU",   regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    approvedKey: null },
  { label: "HKLM Run",     hive: "HKLM",   regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" },
  { label: "HKLM RunOnce",hive: "HKLM",   regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    approvedKey: null },
  { label: "HKLM32 Run",  hive: "HKLM32", regFlag: "/reg:32",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32" },
  { label: "HKCU Policies",hive: "HKCU",  regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run",
    approvedKey: null },
  { label: "HKLM Policies",hive: "HKLM",  regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run",
    approvedKey: null },
];

function parseRegEntries(stdout) {
  const entries = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trimStart();
    if (!t || t.startsWith("HKEY_") || t.startsWith("!")) continue;
    const m = t.match(/^(.+?)\s{2,}(REG_SZ|REG_EXPAND_SZ)\s{2,}(.+)$/);
    if (m) { entries.push({ name: m[1].trim(), value: m[3].trim() }); continue; }
    const parts = t.split(/\t/);
    if (parts.length >= 3 &&
        (parts[1].trim() === "REG_SZ" || parts[1].trim() === "REG_EXPAND_SZ")) {
      entries.push({ name: parts[0].trim(), value: parts.slice(2).join("\t").trim() });
    }
  }
  return entries;
}

function parseRegDisabled(stdout) {
  const map = {};
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trimStart();
    if (!t || t.startsWith("HKEY_")) continue;
    const m = t.match(/^(.+?)\s{2,}REG_BINARY\s{2,}([0-9A-Fa-f]+)/);
    if (m) { map[m[1].trim()] = parseInt(m[2].slice(0, 2), 16) === 3; continue; }
    const parts = t.split(/\t/);
    if (parts.length >= 3 && parts[1].trim() === "REG_BINARY")
      map[parts[0].trim()] = parseInt((parts[2] || "").slice(0, 2), 16) === 3;
  }
  return map;
}

function regQuery(key, flag) {
  return new Promise((resolve) => {
    exec(`reg query "${key}" ${flag || ""}`, { windowsHide: true }, (err, out) =>
      resolve(err ? [] : parseRegEntries(out || "")));
  });
}
function regQueryDisabled(key, flag) {
  return new Promise((resolve) => {
    exec(`reg query "${key}" ${flag || ""}`, { windowsHide: true }, (err, out) =>
      resolve(err ? {} : parseRegDisabled(out || "")));
  });
}

function scanStartupFolder(folderPath, label) {
  try {
    if (!fs.existsSync(folderPath)) return [];
    return fs.readdirSync(folderPath).filter(f => !f.startsWith(".")).map(f => ({
      id: `${label}|${f}`, name: f.replace(/\.[^.]+$/, ""),
      command: path.join(folderPath, f),
      hive: label, approvedKey: null, registryKey: null, regFlag: null,
      source: label, enabled: true, canToggle: false,
    }));
  } catch (_) { return []; }
}

async function listStartupPrograms() {
  const seen = new Set();
  const results = [];

  // Query ALL hive sources in PARALLEL — not one-by-one
  const tasks = STARTUP_REG_SOURCES.map(async (src) => {
    const [entries, disabled] = await Promise.all([
      regQuery(src.key, src.regFlag),
      src.approvedKey ? regQueryDisabled(src.approvedKey, src.regFlag).catch(() => ({})) : Promise.resolve({}),
    ]);
    return { src, entries, disabled };
  });
  const all = await Promise.all(tasks);

  for (const { src, entries, disabled } of all) {
    for (const e of entries) {
      // Skip our own auto-clean startup entry — it's managed by the checkbox above
      const cmdLower = String(e.value || "").toLowerCase();
      if (cmdLower.includes("--autoclean")) continue;

      const uid = `${src.label}|${e.name.toLowerCase()}`;
      if (seen.has(uid)) continue;
      seen.add(uid);
      results.push({
        id: uid, name: e.name, command: e.value,
        hive: src.hive, approvedKey: src.approvedKey,
        registryKey: src.key, regFlag: src.regFlag,
        source: src.label,
        enabled: !(disabled[e.name] === true),
        canToggle: !!src.approvedKey,
      });
    }
  }

  // Shell startup folders
  try {
    const userStartup   = path.join(app.getPath("appData"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
    const commonStartup = "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup";
    for (const item of [
      ...scanStartupFolder(userStartup,   "Startup Folder"),
      ...scanStartupFolder(commonStartup, "Common Startup"),
    ]) {
      if (!seen.has(item.id)) { seen.add(item.id); results.push(item); }
    }
  } catch (_) {}

  return results;
}

function setStartupItemEnabled(name, approvedKey, regFlag, enable) {
  return new Promise((resolve) => {
    if (!approvedKey) return resolve({ ok: false, error: "Cannot toggle this entry." });
    const hex = enable ? "0200000000000000000000" : "0300000000000000000000";
    exec(`reg add "${approvedKey}" /v "${name}" /t REG_BINARY /d ${hex} /f ${regFlag || ""}`,
      { windowsHide: true }, (err) =>
        resolve(err ? { ok: false, error: err.message } : { ok: true }));
  });
}

// ── IPC setup ─────────────────────────────────────────────────────────────────
function setupIpc() {

  // autostart
  ipcMain.handle("autostart:get", async () => {
    try { return { enabled: await getAutoStartEnabled(app.getName()) }; }
    catch (e) { return { enabled: false }; }
  });
  ipcMain.handle("autostart:set", async (_e, enabled) => {
    try { return { ok: await setAutoStartEnabled(app.getName(), !!enabled) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // startup manager
  ipcMain.handle("startup:list", async () => {
    try { return { ok: true, items: await listStartupPrograms() }; }
    catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
  });
  ipcMain.handle("startup:setEnabled", async (_e, { name, approvedKey, regFlag, enable }) => {
    try { return await setStartupItemEnabled(name, approvedKey, regFlag, !!enable); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // stats / system
  ipcMain.handle("stats:get",   async () => ({ ok: true, stats: getStatsSnapshot() }));
  ipcMain.handle("system:get",  async () => ({ ok: true, system: getSystemInfo() }));

  // analytics
  ipcMain.handle("analytics:track", async (_e, payload) => {
    try {
      const p = (payload && typeof payload === "object") ? payload : {};
      return await sendEvent(String(p.event || ""),
        { name: p.name, phone: p.phone, junk: p.junk, error: p.error },
        { immediate: false, force: !!p.force });
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle("analytics:getCounts", async () => {
    try { return await getUserCounts(); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // ── scan ────────────────────────────────────────────────────────────────────
  ipcMain.handle("scan:start", async () => {
    if (currentScanCancel) return { ok: false, error: "Scan already running." };
    if (cleanRunning)      return { ok: false, error: "Clean already running." };

    lastScanResult = { files: [], directories: [], totalBytes: 0 };
    send("scan:reset", {});
    sendStatus("Scanning…");

    const progressSend = debounceMs((p) => send("scan:progress", p), 120);
    const logSend      = debounceMs((p) => send("log", p), 300);
    const cancel       = { cancelled: false };
    currentScanCancel  = () => { cancel.cancelled = true; };

    try {
      const result = await scanner().scanDefaultTargets({ cancel, onProgress: progressSend, onLog: logSend });
      lastScanResult = result;
      send("scan:done", { ok: true, totalFiles: result.files.length, totalBytes: result.totalBytes, allFiles: result.files });
      sendStatus(`Scan complete. Found ${result.files.length} files (${formatBytes(result.totalBytes)}).`);
      return { ok: true };
    } catch (e) {
      const msg = String(e.message || e);
      send("scan:done", { ok: false, error: msg });
      sendStatus("Scan failed.");
      return { ok: false, error: msg };
    } finally {
      currentScanCancel = null;
    }
  });

  ipcMain.handle("scan:cancel", () => {
    if (currentScanCancel) currentScanCancel();
    return { ok: true };
  });

  // ── clean ───────────────────────────────────────────────────────────────────
  ipcMain.handle("clean:start", async (_e, retryTargets) => {
    try {
      if (autoCleanRunning) { sendStatus("Auto-clean is running."); return { ok: false, error: "Auto-clean running." }; }
      if (cleanRunning)     { sendStatus("Clean already running."); return { ok: false, error: "Clean running." }; }

      const retry = (retryTargets && typeof retryTargets === "object") ? retryTargets : {};
      const mergedFiles = toUniquePathList((lastScanResult.files || []).concat(Array.isArray(retry.files) ? retry.files : []));
      const mergedDirs  = toUniquePathList((lastScanResult.directories || []).concat(Array.isArray(retry.directories) ? retry.directories : []));
      const totalBytes  = lastScanResult.totalBytes || 0;

      if (!mergedFiles.length && !mergedDirs.length) {
        sendStatus("Nothing to clean. Run Scan first.");
        return { ok: false, error: "No scanned files." };
      }

      const retryCount = (retry.files || []).length + (retry.directories || []).length;
      const res = await dialog.showMessageBox(mainWindow, {
        type: "warning", title: "Confirm Cleaning",
        message: `Delete ${mergedFiles.length} file(s) (${formatBytes(totalBytes)})${retryCount ? ` + retry ${retryCount} locked item(s)` : ""}?`,
        detail:  "Only files found during the last scan will be removed. Locked files will be skipped.",
        buttons: ["Cancel", "Clean"], defaultId: 1, cancelId: 0, noLink: true,
      });

      if (res.response !== 1) { sendStatus("Cleaning cancelled."); return { ok: false, cancelled: true }; }

      sendStatus("Cleaning…");
      cleanRunning = true;

      const progressSend = debounceMs((p) => send("clean:progress", p), 120);
      const logSend      = debounceMs((p) => send("log", p), 300);
      const cleanStart   = Date.now();

      const result    = await cleaner().cleanFiles(mergedFiles, mergedDirs, { onProgress: progressSend, onLog: logSend });
      const refreshed = await recalculate(mergedFiles, mergedDirs);
      lastScanResult  = refreshed;

      const freedBytes  = Math.max(0, totalBytes - refreshed.totalBytes);
      const durationMs  = Math.max(0, Date.now() - cleanStart);

      cleanStats.totalRuns          += 1;
      cleanStats.totalDeletedItems  += result.deleted || 0;
      cleanStats.totalBytesFreed    += freedBytes;
      cleanStats.totalDurationMs    += durationMs;
      cleanStats.lastRunAt           = new Date().toISOString();

      // Nudge GC after large deletes
      if (global.gc) try { global.gc(); } catch (_) {}

      const snapshot = getStatsSnapshot();
      const payload  = {
        ...result, freedBytes, durationMs, stats: snapshot,
        remainingFiles:       refreshed.files,
        remainingBytes:       refreshed.totalBytes,
        remainingDirectories: refreshed.directories.length,
      };

      send("clean:done",   payload);
      send("stats:update", snapshot);
      sendStatus(refreshed.files.length
        ? `Done. Deleted ${result.deleted}, skipped ${result.skipped}, ${refreshed.files.length} remaining.`
        : `Done. Deleted ${result.deleted}, skipped ${result.skipped}.`);
      return { ok: true, ...payload };

    } catch (e) {
      const msg = String(e.message || e);
      send("clean:done", { ok: false, error: msg });
      sendStatus("Cleaning failed.");
      return { ok: false, error: msg };
    } finally {
      cleanRunning = false;
    }
  });
}

// Automation logic moved to automation.js

// ── app lifecycle ─────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { try { showMainWindow(); } catch (_) {} });

  app.whenReady().then(async () => {
    const endpoint = String(
      process.env.TRACKING_SHEET_URL ||
      "https://script.google.com/macros/s/AKfycbyrao1GQrhzYsO9PE3yzdzgj7T3QbaiT8V06fELWqGFWkIqEqwwqKTbgIT3khlmP0n0/exec"
    ).trim();

    initAnalytics({ endpoint, getSystemInfo, getLocation });
    primeLocation(path.join(app.getPath("userData"), "location-cache.json"));

    createWindow();
    createTray();
    setupIpc();

    // Ensure auto-start is enabled so it runs on next boot
    setTimeout(async () => {
      try {
        await setAutoStartEnabled(app.getName(), true);
      } catch (_) {}
    }, 2000);

    // Identify boot-time launch and log to sheet
    const isHidden = process.argv.some((a) => a.toLowerCase() === "--hidden");
    const isAutoClean = process.argv.some((a) => a.toLowerCase() === "--autoclean");
    
    if (isHidden || isAutoClean) {
      sendEvent("app_open", { name: "System Boot", junk: "boot_launch" }, { force: true, immediate: true });
    } else {
      await sendEvent("app_open", { name: "Manual Launch" }, { immediate: true });
    }

    // Stagger heavy async work so it doesn't compete with first paint
    setTimeout(() => updater().initUpdater(send), 5000);  // updater: 5 s delay

    if (isAutoClean) {
      setTimeout(() => {
        automation().runAutoClean({ sendStatus, send });
      }, 2000);
    }
  });

  app.on("window-all-closed", () => { if (process.platform === "darwin") app.quit(); });
  app.on("activate",          () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("before-quit",       () => { isQuitting = true; });
}
