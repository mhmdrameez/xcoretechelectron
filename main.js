"use strict";
// ── V8 / Chromium tuning — set BEFORE anything else ──────────────────────────
// Works both in dev and packaged (electron-builder doesn't strip commandLine).
try {
  const { app: _a } = require("electron");
  // Aggressive JS optimizations: low heap, force GC, optimize for size
  _a.commandLine.appendSwitch("js-flags",
    "--max-old-space-size=64 --max-semi-space-size=2 --optimize-for-size --gc-interval=100 --expose-gc");
  
  // Completely disable GPU and hardware acceleration
  _a.disableHardwareAcceleration();
  _a.commandLine.appendSwitch("disable-gpu");
  _a.commandLine.appendSwitch("disable-gpu-compositing");
  _a.commandLine.appendSwitch("disable-software-rasterizer");

  // Reduce IPC serialisation overhead
  _a.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

  // Disable bloated features, services, and extensions to save memory
  _a.commandLine.appendSwitch("disable-features",
    "TranslateUI,MediaRouter,AutofillServerCommunication,Translate," +
    "CalculateNativeWinOcclusion,OptimizationHints,NetworkPrediction," +
    "HeavyAdIntervention,InterestFeedContentSuggestions,PrivacySandboxSettings4," +
    "SafeBrowsing,SafeBrowsingEnhancedProtection,AudioServiceOutOfProcess," +
    "Extensions");

  // Disable multi-process overhead for single-page apps
  _a.commandLine.appendSwitch("disable-site-isolation-trials");
  _a.commandLine.appendSwitch("disable-dev-shm-usage");
  
  // Disable logging and dev tools for production performance
  if (!process.env.PLAYWRIGHT_TEST) {
    _a.commandLine.appendSwitch("disable-dev-tools");
  }
  _a.commandLine.appendSwitch("disable-logging");
  _a.commandLine.appendSwitch("v", "0");
} catch (_) {}

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, nativeTheme, shell } = require("electron");
const fs   = require("fs");
const { exec }  = require("child_process");
const path = require("path");

// Lazy-load heavy modules — not needed until the user clicks something.
let _scanner  = null; const scanner  = () => (_scanner  ||= require(path.join(__dirname, "scanner.js")));
let _cleaner  = null; const cleaner  = () => (_cleaner  ||= require(path.join(__dirname, "cleaner.js")));
const { getPlatform } = require(path.join(__dirname, "platform.js"));
const startupItems = require(path.join(__dirname, "startupItems.js"));
let lastStartupItems = new Map(); // id -> item from the last list, so toggles can't be forged
let _largeFiles = null; const largeFiles = () => (_largeFiles ||= require(path.join(__dirname, "largeFiles.js")));
// one instance so clean() only touches what detect() found; test runs use a fixture
let _devCaches = null;
const devCaches = () => {
  if (_devCaches) return _devCaches;
  const mod = require(path.join(__dirname, "devCaches.js"));
  if (process.env.PLAYWRIGHT_TEST) {
    const fx = mod.getDevFixturePath();
    _devCaches = mod.createDevCaches({
      env: {}, localAppData: path.join(fx, "local"), userProfile: path.join(fx, "home"),
      tempDir: path.join(fx, "temp"),
      which: async () => null, run: async () => ({ ok: false, stdout: "", stderr: "", error: "disabled in tests" }),
    });
  } else {
    _devCaches = mod.createDevCaches();
  }
  return _devCaches;
};
let _updater  = null; const updater  = () => (_updater  ||= require(path.join(__dirname, "updater.js")));


const { getSystemInfo }  = require(path.join(__dirname, "systemInfo.js"));
const { initAnalytics, sendEvent, getUserCounts } = require(path.join(__dirname, "analytics.js"));
const { installCrashHandler }  = require(path.join(__dirname, "crashHandler.js"));
const { primeLocation, getLocation } = require(path.join(__dirname, "location.js"));
const { getAutoStartEnabled, setAutoStartEnabled, formatBytes, debounceMs, isProbablyUnsafeSystemPath } = require(path.join(__dirname, "utils.js"));

installCrashHandler(sendEvent);

const AUTO_START_NAME = "XCoreTechOptimizer"; // Consistent name across all versions


// ── globals ───────────────────────────────────────────────────────────────────
let mainWindow       = null;
let tray             = null;
let isQuitting       = false;
let currentScanCancel = null;
let largeScanCancel  = null;
let devCacheBusy     = false;
let largeSearchRoots = [];
let lastLargeFiles   = new Map(); // lower-case path -> item, from the last large-file scan
let lastScanResult   = { files: [], directories: [], totalBytes: 0 };
let autoCleanRunning = false;
let cleanRunning     = false;

function hasProcessArg(argv, flag) {
  const target = String(flag || "").toLowerCase();
  return Array.isArray(argv) && argv.some((a) => String(a || "").toLowerCase() === target);
}

function isBackgroundLaunch(argv = process.argv) {
  return hasProcessArg(argv, "--hidden") || hasProcessArg(argv, "--autoclean");
}

function isAutoCleanLaunch(argv = process.argv) {
  return hasProcessArg(argv, "--autoclean");
}

// ── persistence ───────────────────────────────────────────────────────────────
const statsPath   = path.join(app.getPath("userData"), "stats.json");

function loadJson(p, def) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {}
  return def;
}

function saveJson(p, data) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data), "utf8");
  } catch (_) {}
}

const cleanStats = loadJson(statsPath, { totalRuns: 0, totalDeletedItems: 0, totalBytesFreed: 0, totalDurationMs: 0, lastRunAt: null });




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
  const order = process.platform === "win32" ? [ico, png] : [png];
  _iconPath = order.find((p) => fs.existsSync(p)) || "";
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
    let img = nativeImage.createFromPath(iconPath);
    // menu-bar / panel icons are small; a 256px image would be shown huge or blurry
    if (process.platform === "darwin") img = img.resize({ width: 18, height: 18 });
    else if (process.platform !== "win32") img = img.resize({ width: 22, height: 22 });
    tray = new Tray(img);
    tray.setToolTip("XCoreTech PC Optimizer");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Optimizer", click: showMainWindow },
      { label: "Exit", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on("click", showMainWindow);
  } catch (_) { tray = null; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820, height: 620, minWidth: 760, minHeight: 520,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202020" : "#f3f3f3",
    icon: resolveIconPath(),
    webPreferences: {
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
      spellcheck:        false,
      // v8 cache — persist compiled bytecode across launches (faster load)
      v8CacheOptions:    "bypassHeatCheck",
      enableWebSQL:      false,
      backgroundThrottling: true,
      autoplayPolicy:    "user-gesture-required",
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  const shouldStayHidden = isBackgroundLaunch();
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !shouldStayHidden) mainWindow.show();
  });
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform === "darwin") return;
    event.preventDefault();
    mainWindow.hide();
    // Release renderer memory when window is hidden
    try { mainWindow.webContents.setBackgroundThrottling(true); } catch (_) {}
    if (global.gc) try { global.gc(); } catch (_) {}
    sendStatus("Running in background. Click tray icon to reopen.");
  });

  // Free renderer heap when window goes to background
  mainWindow.on("hide", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setBackgroundThrottling(true);
      }
      if (global.gc) try { global.gc(); } catch (_) {}
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
    const k = getPlatform().pathKey(p);
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

// ── post-clean stat recalculation — batched parallel stat calls ───────────────
// original-fs so .asar archives in scanned folders are stat-ed as files, not opened
const rawFs = (() => { try { return require("original-fs"); } catch (_) { return fs; } })();
const STAT_BATCH = 64;
async function statBatch(paths) {
  const results = [];
  for (let start = 0; start < paths.length; start += STAT_BATCH) {
    const slice = paths.slice(start, start + STAT_BATCH);
    const batch = await Promise.allSettled(slice.map(p => rawFs.promises.stat(p)));
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

// ── IPC setup ─────────────────────────────────────────────────────────────────
function setupIpc() {

  // autostart
  ipcMain.handle("autostart:get", async () => {
    try { return { enabled: await getAutoStartEnabled(AUTO_START_NAME) }; }
    catch (e) { return { enabled: false }; }
  });
  ipcMain.handle("autostart:set", async (_e, enabled) => {
    try { return { ok: await setAutoStartEnabled(AUTO_START_NAME, !!enabled) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // startup manager
  ipcMain.handle("startup:list", async () => {
    try {
      const items = await startupItems.listStartupItems();
      lastStartupItems = new Map(items.map((i) => [i.id, i]));
      return { ok: true, items };
    }
    catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
  });
  ipcMain.handle("startup:setEnabled", async (_e, req) => {
    const r = (req && typeof req === "object") ? req : {};
    const item = lastStartupItems.get(String(r.id || ""));
    if (!item) return { ok: false, error: "Unknown startup entry. Refresh the list." };
    try {
      const res = await startupItems.setStartupEnabled(item, !!r.enable);
      if (res && res.ok) item.enabled = !!r.enable;
      return res;
    }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // stats / system
  ipcMain.handle("stats:get",   async () => ({ ok: true, stats: getStatsSnapshot() }));
  ipcMain.handle("system:get",  async () => ({ ok: true, system: getSystemInfo() }));
  ipcMain.handle("platform:get", async () => {
    const p = getPlatform();
    return { ok: true, id: p.id, name: p.name, techTools: p.techTools };
  });

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

    const progressSend = debounceMs((p) => send("scan:progress", p), 250);
    const logSend      = debounceMs((p) => send("log", p), 500);
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

  // ── technician ─────────────────────────────────────────────────────────────
  ipcMain.handle("tech:internetFix", async () => {
    try {
      sendStatus("Running Internet Fix…");
      const res = await require("./technician.js").internetFix((msg) => send("tech:progress", { id: "techInternetProg", msg }));
      sendStatus(res.ok ? "Internet Fix complete." : "Internet Fix partially failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle("tech:ramBoost", async () => {
    try {
      sendStatus("Optimizing RAM…");
      const res = await require("./technician.js").ramBoost((msg) => send("tech:progress", { id: "techRamProg", msg }));
      sendStatus(res.ok ? "RAM Boost complete." : "RAM Boost failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle("tech:autoFix", async () => {
    try {
      sendStatus("Running Auto Fix…");
      const res = await require("./technician.js").autoFix((msg) => send("tech:progress", { id: "techAutoProg", msg }));
      sendStatus(res.ok ? "Auto Fix complete." : "Auto Fix failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── large files ────────────────────────────────────────────────────────────
  ipcMain.handle("large:roots", async () => {
    try {
      largeSearchRoots = await largeFiles().listSearchRoots();
      return { ok: true, roots: largeSearchRoots };
    } catch (e) { return { ok: false, error: String(e.message || e), roots: [] }; }
  });

  ipcMain.handle("large:scan", async (_e, opts) => {
    if (largeScanCancel) return { ok: false, error: "Already searching." };
    const o = (opts && typeof opts === "object") ? opts : {};
    // only search places we offered — never an arbitrary path from the page
    const root = largeSearchRoots.find((r) => r.id === o.rootId);
    if (!root) return { ok: false, error: "Choose where to search first." };
    const minBytes = Math.max(1, Number(o.minBytes) || 0);

    if (root.id === "fixture") {
      try { fs.mkdirSync(root.path, { recursive: true }); } catch (_) {}
    }

    const cancel = { cancelled: false };
    largeScanCancel = () => { cancel.cancelled = true; };
    sendStatus(`Looking for large files in ${root.path}…`);
    try {
      const progressSend = debounceMs((p) => send("large:progress", p), 200);
      const result = await largeFiles().findLargeFiles(root.path, { minBytes, cancel, onProgress: progressSend });
      lastLargeFiles = new Map(result.items.map((i) => [getPlatform().pathKey(i.path), i]));
      sendStatus(result.cancelled
        ? "Large file search stopped."
        : `Found ${result.found} file(s) of ${formatBytes(minBytes)} or more.`);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: String(e.message || e), items: [] };
    } finally {
      largeScanCancel = null;
    }
  });

  ipcMain.handle("large:cancel", () => {
    if (largeScanCancel) largeScanCancel();
    return { ok: true };
  });

  ipcMain.handle("large:reveal", (_e, filePath) => {
    const item = lastLargeFiles.get(getPlatform().pathKey(filePath));
    if (!item) return { ok: false, error: "Unknown file." };
    try { shell.showItemInFolder(item.path); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle("large:delete", async (_e, req) => {
    const r = (req && typeof req === "object") ? req : {};
    const permanent = !!r.permanent;
    // only files that came from our own last scan, and never system locations
    const items = toUniquePathList(Array.isArray(r.paths) ? r.paths : [])
      .map((p) => lastLargeFiles.get(getPlatform().pathKey(p)))
      .filter((i) => i && !isProbablyUnsafeSystemPath(i.path));
    if (!items.length) return { ok: false, error: "No files selected." };

    const total = items.reduce((n, i) => n + i.size, 0);
    if (!process.env.PLAYWRIGHT_TEST) {
      const res = await dialog.showMessageBox(mainWindow, permanent ? {
        type: "warning", title: "Delete permanently",
        message: `Permanently delete ${items.length} file(s) (${formatBytes(total)})?`,
        detail: "They will not go to the Recycle Bin and can't be restored.",
        buttons: ["Cancel", "Delete permanently"], defaultId: 0, cancelId: 0, noLink: true,
      } : {
        type: "question", title: "Move to Recycle Bin",
        message: `Move ${items.length} file(s) (${formatBytes(total)}) to the Recycle Bin?`,
        detail: "You can restore them from the Recycle Bin. The space is freed when you empty it.",
        buttons: ["Cancel", "Move to Recycle Bin"], defaultId: 1, cancelId: 0, noLink: true,
      });
      if (res.response !== 1) return { ok: false, cancelled: true };
    }

    const removed = [];
    const failed  = [];
    for (const item of items) {
      try {
        if (permanent) {
          try { await fs.promises.unlink(item.path); }
          catch (err) {
            if (err && err.code === "EPERM") {     // read-only file
              await fs.promises.chmod(item.path, 0o666);
              await fs.promises.unlink(item.path);
            } else throw err;
          }
        } else {
          await shell.trashItem(item.path);
        }
        removed.push(item.path);
        lastLargeFiles.delete(getPlatform().pathKey(item.path));
      } catch (e) {
        failed.push({ path: item.path, error: e && e.code === "EBUSY" ? "File is in use." : String(e.message || e) });
      }
    }
    const removedBytes = items.filter((i) => removed.includes(i.path)).reduce((n, i) => n + i.size, 0);
    sendStatus(`${permanent ? "Deleted" : "Moved to Recycle Bin"}: ${removed.length} file(s), ${formatBytes(removedBytes)}.` +
      (failed.length ? ` ${failed.length} couldn't be removed.` : ""));
    return { ok: true, permanent, removed, removedBytes, failed };
  });

  // ── developer caches ───────────────────────────────────────────────────────
  ipcMain.handle("dev:detect", async () => {
    if (devCacheBusy) return { ok: false, error: "Already working." };
    devCacheBusy = true;
    sendStatus("Checking developer caches…");
    try {
      const targets = await devCaches().detect();
      const total = targets.filter((t) => t.cleanable).reduce((n, t) => n + t.bytes, 0);
      sendStatus(`Developer caches: ${formatBytes(total)} can be freed.`);
      return { ok: true, targets };
    } catch (e) {
      return { ok: false, error: String(e.message || e), targets: [] };
    } finally {
      devCacheBusy = false;
    }
  });

  ipcMain.handle("dev:clean", async (_e, ids) => {
    if (devCacheBusy) return { ok: false, error: "Already working." };
    const chosen = (Array.isArray(ids) ? ids : [])
      .map((id) => devCaches().planned(String(id)))
      .filter((t) => t && t.cleanable);
    if (!chosen.length) return { ok: false, error: "Nothing selected." };

    const total = chosen.reduce((n, t) => n + t.bytes, 0);
    if (!process.env.PLAYWRIGHT_TEST) {
      const res = await dialog.showMessageBox(mainWindow, {
        type: "question", title: "Clean developer caches",
        message: `Clean ${chosen.length} cache(s), up to ${formatBytes(total)}?`,
        detail: chosen.map((t) => `• ${t.name}`).join("\n") +
          "\n\nThese are downloads and leftovers. Your tools fetch anything they need again.",
        buttons: ["Cancel", "Clean"], defaultId: 1, cancelId: 0, noLink: true,
      });
      if (res.response !== 1) return { ok: false, cancelled: true };
    }

    devCacheBusy = true;
    sendStatus("Cleaning developer caches…");
    try {
      const results = await devCaches().clean(chosen.map((t) => t.id), (p) => send("dev:progress", p));
      const freed = results.reduce((n, r) => n + (r.freedBytes || 0), 0);
      const failed = results.filter((r) => !r.ok).length;
      sendStatus(`Developer caches: freed ${formatBytes(freed)}.` + (failed ? ` ${failed} couldn't be fully cleaned.` : ""));
      return { ok: true, results, freedBytes: freed };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    } finally {
      devCacheBusy = false;
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
      let res = { response: 1 };
      if (!process.env.PLAYWRIGHT_TEST) {
        res = await dialog.showMessageBox(mainWindow, {
          type: "warning", title: "Confirm Cleaning",
          message: `Delete ${mergedFiles.length} file(s) (${formatBytes(totalBytes)})${retryCount ? ` + retry ${retryCount} locked item(s)` : ""}?`,
          detail:  "Only files found during the last scan will be removed. Locked files will be skipped.",
          buttons: ["Cancel", "Clean"], defaultId: 1, cancelId: 0, noLink: true,
        });
      }

      if (res.response !== 1) { sendStatus("Cleaning cancelled."); return { ok: false, cancelled: true }; }

      sendStatus("Cleaning…");
      cleanRunning = true;

      const progressSend = debounceMs((p) => send("clean:progress", p), 250);
      const logSend      = debounceMs((p) => send("log", p), 500);
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

      saveJson(statsPath, cleanStats);

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

// ─── automation ───────────────────────────────────────────────────────────────
async function runAutoClean({ sendStatus, send }) {
  try {
    // 1. Initial logs - fire and forget so scan starts immediately
    sendEvent("activity", { name: "System Boot", junk: "scan_start" }, { force: true, immediate: true });

    sendStatus("Auto-clean: scanning…");
    const cancel = { cancelled: false };
    const progressSend = debounceMs((p) => send("scan:progress", p), 250);
    const logSend = debounceMs((p) => send("log", p), 500);

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

    // 2. Explicitly log scan_ok for background auto-clean to ensure it doesn't get dropped or delayed by renderer
    sendEvent("activity", { name: "System Boot", junk: `scan_ok | ${scanResult.files.length} files` }, { force: true, immediate: true });

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

    // Update stats and persist
    cleanStats.totalRuns += 1;
    cleanStats.totalDeletedItems += cleanResult.deleted || 0;
    cleanStats.totalBytesFreed += scanResult.totalBytes;
    cleanStats.totalDurationMs += durationMs;
    cleanStats.lastRunAt = new Date().toISOString();
    saveJson(statsPath, cleanStats);

    // Notify the UI
    send("status", { text: "Auto-clean: completed." });
    
    // Send clean:done to update dashboard stats if UI is open
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


// ── app lifecycle ─────────────────────────────────────────────────────────────
const gotLock = process.env.PLAYWRIGHT_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    try {
      if (isBackgroundLaunch(argv)) {
        sendStatus("Running in background. Click tray icon to reopen.");
        return;
      }
      showMainWindow();
    } catch (_) {}
  });

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

    // Keep startup enabled so background launches can run auto-clean.
    setTimeout(async () => {
      try {
        await setAutoStartEnabled(AUTO_START_NAME, true);
      } catch (_) {}
    }, 5000); // 5s delay for registry stability

    // Identify boot-time launch and log to sheet
    const isHidden = isBackgroundLaunch();
    const isAutoClean = isAutoCleanLaunch();
    
    if (isHidden || isAutoClean) {
      // Boot reporting: Wait for network to ensure the event is logged
      const reportBoot = async () => {
        let attempts = 0;
        const { net } = require("electron");
        while (!net.isOnline() && attempts < 10) {
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
        }
        await sendEvent("app_open", { name: "System Boot", junk: "boot_launch" }, { force: true, immediate: true });
      };
      reportBoot();
    } else {
      await sendEvent("app_open", { name: "Manual Launch" }, { immediate: true });
    }

    // Stagger heavy async work so it doesn't compete with first paint
    setTimeout(() => updater().initUpdater(send), 8000);  // updater: 8 s delay

    if (isAutoClean) {
      // Delay auto-clean to let the system stabilize
      setTimeout(() => {
        runAutoClean({ sendStatus, send });
      }, 12000); // 12s delay for background runs
    }
  });

  app.on("window-all-closed", () => { if (process.platform === "darwin") app.quit(); });
  app.on("activate",          () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("before-quit",       () => { isQuitting = true; });
}
