"use strict";
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require("electron");
const fs = require("fs");
const { execFile, exec } = require("child_process");
const path = require("path");
const { scanDefaultTargets } = require("./scanner");
const { cleanFiles } = require("./cleaner");
const { getSystemInfo } = require("./systemInfo");
const { initAnalytics, sendEvent, getUserCounts } = require("./analytics");
const { installCrashHandler } = require("./crashHandler");
const { primeLocation, getLocation } = require("./location");
const { getAutoStartEnabled, setAutoStartEnabled, formatBytes, debounceMs } = require("./utils");
const { initUpdater } = require("./updater");

// ── process-level V8 tuning (call before anything else) ────────────────────
// Prefer smaller heap, run GC more aggressively when idle.
// These flags are ignored on packaged builds where Electron sets its own.
if (process.env.NODE_ENV !== "production") {
  try { app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128 --optimize-for-size"); } catch (_) { }
}
// Disable GPU for a headless-style main process (saves ~30 MB VRAM).
app.disableHardwareAcceleration();

// ── globals ─────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentScanCancel = null;
let lastScanResult = { files: [], directories: [], totalBytes: 0 };
let autoCleanRunning = false;
let cleanRunning = false;
let cleanStats = {
  totalRuns: 0, totalDeletedItems: 0, totalBytesFreed: 0,
  totalDurationMs: 0, lastRunAt: null,
};

installCrashHandler(sendEvent);

// ── stats (in-memory only — resets each launch, no file I/O) ─────────────────

function getStatsSnapshot() {
  const runs = cleanStats.totalRuns || 0;
  const gbFreed = (cleanStats.totalBytesFreed || 0) / (1024 ** 3);
  return {
    ...cleanStats,
    avgDurationMs: runs > 0 ? Math.round((cleanStats.totalDurationMs || 0) / runs) : 0,
    estimatedSpeedBoostPercent: Math.min(45, Math.round(gbFreed * 2.5 + Math.log10(gbFreed + 1) * 6)) || 0,
  };
}

// ── icon resolution ──────────────────────────────────────────────────────────
let _iconPath = null;   // cached after first call
function resolveIconPath() {
  if (_iconPath !== null) return _iconPath;
  const ico = path.join(__dirname, "assets", "app-icon.ico");
  const png = path.join(__dirname, "assets", "app-icon.png");
  _iconPath = fs.existsSync(ico) ? ico : fs.existsSync(png) ? png : "";
  return _iconPath || undefined;
}

// ── window helpers ───────────────────────────────────────────────────────────
function showMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (_) { }
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Disable spell check and other heavy subsystems
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) return;
    mainWindow.show();
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform === "darwin") return;
    event.preventDefault();
    mainWindow.hide();
    sendStatus("Running in background. Click tray icon to reopen.");
  });
}

// ── IPC send helpers ─────────────────────────────────────────────────────────
function send(channel, payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  } catch (_) { }
}

const sendStatus = (text) => send("status", { text: String(text || "") });

// ── path de-duplication ───────────────────────────────────────────────────────
function toUniquePathList(input) {
  if (!Array.isArray(input) || !input.length) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const p = String(input[i] || "").trim();
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ── post-clean remaining-files recalculation ─────────────────────────────────
// Runs parallel batches of stat calls instead of sequential await-per-file.
const STAT_BATCH = 64;   // concurrent stats per round

async function statBatch(paths) {
  const results = [];
  for (let start = 0; start < paths.length; start += STAT_BATCH) {
    const slice = paths.slice(start, start + STAT_BATCH);
    const batch = await Promise.allSettled(slice.map(p => fs.promises.stat(p)));
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].status === "fulfilled") results.push({ path: slice[i], stat: batch[i].value });
    }
    await new Promise(setImmediate);   // yield between batches
  }
  return results;
}

async function recalculate(files, directories) {
  const inputFiles = Array.isArray(files) ? files : [];
  const inputDirs = Array.isArray(directories) ? directories : [];

  // stat files in parallel batches
  const fileStats = await statBatch(inputFiles);
  const remainingFiles = [];
  let remainingBytes = 0;
  for (let i = 0; i < fileStats.length; i++) {
    if (fileStats[i].stat.isFile()) {
      remainingFiles.push(fileStats[i].path);
      remainingBytes += fileStats[i].stat.size;
    }
  }

  // stat dirs in parallel batches
  const dirStats = await statBatch(inputDirs);
  const remainingDirectories = [];
  for (let i = 0; i < dirStats.length; i++) {
    if (dirStats[i].stat.isDirectory()) remainingDirectories.push(dirStats[i].path);
  }
  remainingDirectories.sort((a, b) => b.length - a.length);

  return { files: remainingFiles, directories: remainingDirectories, totalBytes: remainingBytes };
}

// ── Startup program helpers (Windows registry) ───────────────────────────────

// All registry Run hives — queried with /reg:64 to force 64-bit view regardless of process arch
const STARTUP_REG_SOURCES = [
  { label: "HKCU Run",      hive: "HKCU", approvedHive: "HKCU",   regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" },
  { label: "HKCU RunOnce", hive: "HKCU", approvedHive: "HKCU",   regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    approvedKey: null },
  { label: "HKLM Run",      hive: "HKLM", approvedHive: "HKLM",   regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" },
  { label: "HKLM RunOnce", hive: "HKLM", approvedHive: "HKLM",   regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    approvedKey: null },
  { label: "HKLM32 Run",   hive: "HKLM32", approvedHive: "HKLM32", regFlag: "/reg:32",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    approvedKey: "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32" },
  { label: "HKCU Policies",hive: "HKCU", approvedHive: null, regFlag: "/reg:64",
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run",
    approvedKey: null },
  { label: "HKLM Policies",hive: "HKLM", approvedHive: null, regFlag: "/reg:64",
    key: "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\Run",
    approvedKey: null },
];

// Parse reg query output — reg.exe uses TAB separators between name/type/data
function parseRegOutput(stdout) {
  const entries = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("HKEY_") || trimmed.startsWith("!")) continue;
    // Matches:  <whitespace>Name<TAB>Type<TAB>Data
    // Also handles when multiple spaces are used instead of a tab
    const m = trimmed.match(/^(.+?)\s{2,}(REG_SZ|REG_EXPAND_SZ)\s{2,}(.+)$/);
    if (m) {
      entries.push({ name: m[1].trim(), value: m[3].trim() });
      continue;
    }
    // Fallback: tab-separated
    const parts = trimmed.split(/\t/);
    if (parts.length >= 3 && (parts[1].trim() === "REG_SZ" || parts[1].trim() === "REG_EXPAND_SZ")) {
      entries.push({ name: parts[0].trim(), value: parts.slice(2).join("\t").trim() });
    }
  }
  return entries;
}

function parseRegBinaryDisabled(stdout) {
  const map = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("HKEY_")) continue;
    const m = trimmed.match(/^(.+?)\s{2,}REG_BINARY\s{2,}([0-9A-Fa-f]+)/);
    if (m) {
      const firstByte = parseInt(m[2].slice(0, 2), 16);
      map[m[1].trim()] = firstByte === 3; // 03 = disabled
      continue;
    }
    const parts = trimmed.split(/\t/);
    if (parts.length >= 3 && parts[1].trim() === "REG_BINARY") {
      const firstByte = parseInt((parts[2] || "").slice(0, 2), 16);
      map[parts[0].trim()] = firstByte === 3;
    }
  }
  return map;
}

function regQuery(key, regFlag) {
  return new Promise((resolve) => {
    const flagArg = regFlag || "";
    exec(`reg query "${key}" ${flagArg}`, { windowsHide: true }, (err, stdout) => {
      resolve(err ? [] : parseRegOutput(stdout || ""));
    });
  });
}

function regQueryDisabled(key, regFlag) {
  return new Promise((resolve) => {
    const flagArg = regFlag || "";
    exec(`reg query "${key}" ${flagArg}`, { windowsHide: true }, (err, stdout) => {
      resolve(err ? {} : parseRegBinaryDisabled(stdout || ""));
    });
  });
}

// Scan shell startup folders
function scanStartupFolder(folderPath, hiveLabel) {
  try {
    if (!fs.existsSync(folderPath)) return [];
    return fs.readdirSync(folderPath)
      .filter(f => !f.startsWith("."))
      .map(f => ({
        id: `${hiveLabel}|folder|${f}`,
        name: f.replace(/\.[^.]+$/, ""),
        command: path.join(folderPath, f),
        hive: hiveLabel,
        registryKey: null,
        approvedKey: null,
        source: "Startup Folder",
        enabled: true,  // folder items are always considered enabled
        canToggle: false,
      }));
  } catch (_) { return []; }
}

async function listStartupPrograms() {
  const seen = new Set();
  const results = [];

  // Registry sources
  for (const src of STARTUP_REG_SOURCES) {
    const [entries, disabledMap] = await Promise.all([
      regQuery(src.key, src.regFlag),
      src.approvedKey ? regQueryDisabled(src.approvedKey, src.regFlag).catch(() => ({})) : Promise.resolve({}),
    ]);
    for (const e of entries) {
      const uid = `${src.label}|${e.name.toLowerCase()}`;
      if (seen.has(uid)) continue;
      seen.add(uid);
      results.push({
        id: uid,
        name: e.name,
        command: e.value,
        hive: src.hive,
        approvedKey: src.approvedKey,
        registryKey: src.key,
        regFlag: src.regFlag,
        source: src.label,
        enabled: !(disabledMap[e.name] === true),
        canToggle: !!src.approvedKey,
      });
    }
  }

  // Shell startup folders
  try {
    const userStartup   = path.join(app.getPath("appData"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
    const commonStartup = "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup";
    for (const item of scanStartupFolder(userStartup, "Startup Folder")) {
      if (!seen.has(item.id)) { seen.add(item.id); results.push(item); }
    }
    for (const item of scanStartupFolder(commonStartup, "Common Startup")) {
      if (!seen.has(item.id)) { seen.add(item.id); results.push(item); }
    }
  } catch (_) {}

  return results;
}

function setStartupItemEnabled(hiveLabel, name, approvedKey, regFlag, enable) {
  return new Promise((resolve) => {
    if (!approvedKey) return resolve({ ok: false, error: "This entry cannot be toggled (no approved key)." });
    // 02 00 00 00 00 00 00 00 00 00 00 00 = enabled
    // 03 00 00 00 00 00 00 00 00 00 00 00 = disabled
    const hexVal = enable ? "0200000000000000000000" : "0300000000000000000000";
    const flag = regFlag || "";
    const cmd = `reg add "${approvedKey}" /v "${name}" /t REG_BINARY /d ${hexVal} /f ${flag}`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true });
    });
  });
}

// ── IPC setup ─────────────────────────────────────────────────────────────────
function setupIpc() {
  ipcMain.handle("autostart:get", async () => {
    try { return { enabled: await getAutoStartEnabled(app.getName()) }; }
    catch (e) { return { enabled: false, error: String(e && e.message ? e.message : e) }; }
  });

  ipcMain.handle("autostart:set", async (_e, enabled) => {
    try { return { ok: await setAutoStartEnabled(app.getName(), !!enabled) }; }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  });

  ipcMain.handle("startup:list", async () => {
    try {
      const items = await listStartupPrograms();
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), items: [] };
    }
  });

  ipcMain.handle("startup:setEnabled", async (_e, { hive, name, approvedKey, regFlag, enable }) => {
    try {
      return await setStartupItemEnabled(hive, name, approvedKey, regFlag, !!enable);
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle("stats:get", async () => ({ ok: true, stats: getStatsSnapshot() }));
  ipcMain.handle("system:get", async () => ({ ok: true, system: getSystemInfo() }));

  ipcMain.handle("analytics:track", async (_e, payload) => {
    try {
      const p = payload && typeof payload === "object" ? payload : {};
      return await sendEvent(String(p.event || ""),
        { name: p.name, phone: p.phone, junk: p.junk, error: p.error },
        { immediate: false, force: !!p.force });
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || "UNKNOWN" };
    }
  });

  ipcMain.handle("analytics:getCounts", async () => {
    try { return await getUserCounts(); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // ── scan ────────────────────────────────────────────────────────────────────
  ipcMain.handle("scan:start", async () => {
    if (currentScanCancel) return { ok: false, error: "Scan already running." };
    if (cleanRunning) return { ok: false, error: "Clean already running." };

    lastScanResult = { files: [], directories: [], totalBytes: 0 };
    send("scan:reset", {});
    sendStatus("Scanning…");

    const progressSend = debounceMs((p) => send("scan:progress", p), 120);
    const logSend = debounceMs((p) => send("log", p), 300);
    const cancel = { cancelled: false };
    currentScanCancel = () => { cancel.cancelled = true; };

    try {
      const result = await scanDefaultTargets({ cancel, onProgress: progressSend, onLog: logSend });
      lastScanResult = result;
      send("scan:done", { ok: true, totalFiles: result.files.length, totalBytes: result.totalBytes, allFiles: result.files });
      sendStatus(`Scan complete. Found ${result.files.length} files (${formatBytes(result.totalBytes)}).`);
      return { ok: true };
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
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
      if (cleanRunning) { sendStatus("Clean already running."); return { ok: false, error: "Clean running." }; }

      const retry = retryTargets && typeof retryTargets === "object" ? retryTargets : {};
      const mergedFiles = toUniquePathList((lastScanResult.files || []).concat(Array.isArray(retry.files) ? retry.files : []));
      const mergedDirs = toUniquePathList((lastScanResult.directories || []).concat(Array.isArray(retry.directories) ? retry.directories : []));
      const totalBytes = Number(lastScanResult.totalBytes || 0);

      if (!mergedFiles.length && !mergedDirs.length) {
        sendStatus("Nothing to clean. Run Scan first.");
        return { ok: false, error: "No scanned files." };
      }

      const retryCount = (retry.files || []).length + (retry.directories || []).length;
      const res = await dialog.showMessageBox(mainWindow, {
        type: "warning", title: "Confirm Cleaning",
        message: `Delete ${mergedFiles.length} file(s) (${formatBytes(totalBytes)})${retryCount ? ` + retry ${retryCount} locked item(s)` : ""}?`,
        detail: "Only files found during the last scan will be removed. Locked files will be skipped.",
        buttons: ["Cancel", "Clean"], defaultId: 1, cancelId: 0, noLink: true,
      });

      if (res.response !== 1) { sendStatus("Cleaning cancelled."); return { ok: false, cancelled: true }; }

      sendStatus("Cleaning…");
      cleanRunning = true;

      const progressSend = debounceMs((p) => send("clean:progress", p), 120);
      const logSend = debounceMs((p) => send("log", p), 300);
      const cleanStart = Date.now();

      const result = await cleanFiles(mergedFiles, mergedDirs, { onProgress: progressSend, onLog: logSend });
      const refreshed = await recalculate(mergedFiles, mergedDirs);
      lastScanResult = refreshed;

      const freedBytes = Math.max(0, totalBytes - refreshed.totalBytes);
      const durationMs = Math.max(0, Date.now() - cleanStart);

      cleanStats.totalRuns += 1;
      cleanStats.totalDeletedItems += result.deleted || 0;
      cleanStats.totalBytesFreed += freedBytes;
      cleanStats.totalDurationMs += durationMs;
      cleanStats.lastRunAt = new Date().toISOString();
      // Stats kept in-memory only — no file write

      const snapshot = getStatsSnapshot();
      const payload = {
        ...result, freedBytes, durationMs, stats: snapshot,
        remainingFiles: refreshed.files,
        remainingBytes: refreshed.totalBytes,
        remainingDirectories: refreshed.directories.length,
      };

      send("clean:done", payload);
      send("stats:update", snapshot);
      sendStatus(refreshed.files.length
        ? `Done. Deleted ${result.deleted}, skipped ${result.skipped}, ${refreshed.files.length} remaining.`
        : `Done. Deleted ${result.deleted}, skipped ${result.skipped}.`);

      return { ok: true, ...payload };
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      send("clean:done", { ok: false, error: msg });
      sendStatus("Cleaning failed.");
      return { ok: false, error: msg };
    } finally {
      cleanRunning = false;
    }
  });
}

// ── auto-clean (--autoclean flag) ────────────────────────────────────────────
async function runAutoClean() {
  const isAuto = process.argv && process.argv.some((a) => String(a || "").toLowerCase() === "--autoclean");
  if (!isAuto || autoCleanRunning) return;
  autoCleanRunning = true;
  try {
    sendStatus("Auto-clean: scanning…");
    const progressSend = debounceMs((p) => send("scan:progress", p), 150);
    const logSend = debounceMs((p) => send("log", p), 300);
    const cancel = { cancelled: false };
    const scan = await scanDefaultTargets({ cancel, onProgress: progressSend, onLog: logSend });
    lastScanResult = scan;
    sendStatus(`Auto-clean: ${scan.files.length} files (${formatBytes(scan.totalBytes)}). Cleaning…`);
    await cleanFiles(scan.files, scan.directories, { onProgress: progressSend, onLog: logSend });
    sendStatus("Auto-clean: completed.");
  } catch (_) {
    sendStatus("Auto-clean: failed.");
  } finally {
    autoCleanRunning = false;
    setTimeout(() => { try { app.quit(); } catch (_) { } }, 700);
  }
}

// ── app lifecycle ─────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { try { showMainWindow(); } catch (_) { } });

  app.whenReady().then(() => {
    const endpoint = String(process.env.TRACKING_SHEET_URL ||
      "https://script.google.com/macros/s/AKfycbyrao1GQrhzYsO9PE3yzdzgj7T3QbaiT8V06fELWqGFWkIqEqwwqKTbgIT3khlmP0n0/exec").trim();
    initAnalytics({ endpoint, getSystemInfo, getLocation });
    primeLocation(path.join(app.getPath("userData"), "location-cache.json"));

    // Stats are in-memory — send initial zero snapshot

    createWindow();
    createTray();
    setupIpc();
    // Init auto-updater after window is ready (5s delayed check inside)
    setTimeout(() => initUpdater(send), 1000);
    setTimeout(runAutoClean, 250);
  });

  app.on("window-all-closed", () => { if (process.platform === "darwin") app.quit(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("before-quit", () => { isQuitting = true; });
}
