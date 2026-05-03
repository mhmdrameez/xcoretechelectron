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

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, Notification } = require("electron");
const fs   = require("fs");
const { exec }  = require("child_process");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const os = require("os");

const { safeStorage } = require("electron");

// Lazy-load heavy modules — not needed until the user clicks something.
let _scanner  = null; const scanner  = () => (_scanner  ||= require(path.join(__dirname, "scanner.js")));
let _cleaner  = null; const cleaner  = () => (_cleaner  ||= require(path.join(__dirname, "cleaner.js")));
let _updater  = null; const updater  = () => (_updater  ||= require(path.join(__dirname, "updater.js")));


const { getSystemInfo }  = require(path.join(__dirname, "systemInfo.js"));
const { initAnalytics, sendEvent, getUserCounts } = require(path.join(__dirname, "analytics.js"));
const { installCrashHandler }  = require(path.join(__dirname, "crashHandler.js"));
const { primeLocation, getLocation } = require(path.join(__dirname, "location.js"));
const { getAutoStartEnabled, setAutoStartEnabled, formatBytes, debounceMs } = require(path.join(__dirname, "utils.js"));
const { shouldShowFreeProReminder, markFreeProReminderShown } = require(path.join(__dirname, "engagement.js"));

installCrashHandler(sendEvent);

const AUTO_START_NAME = "XCoreTechOptimizer"; // Consistent name across all versions


// ── globals ───────────────────────────────────────────────────────────────────
let mainWindow       = null;
let tray             = null;
let isQuitting       = false;
let currentScanCancel = null;
let lastScanResult   = { files: [], directories: [], totalBytes: 0 };
let autoCleanRunning = false;
let cleanRunning     = false;
// ── persistence ───────────────────────────────────────────────────────────────
const statsPath   = path.join(app.getPath("userData"), "stats.json");
const licensePath = path.join(app.getPath("userData"), "license", "identity.bin");
const engagementPath = path.join(app.getPath("userData"), "engagement.json");

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
const engagementState = loadJson(engagementPath, { lastFreeProReminderDate: "", lastFreeProReminderAt: 0 });

// ── high-encryption license persistence ───────────────────────────────────────
function loadLicense() {
  try {
    if (fs.existsSync(licensePath)) {
      const encrypted = fs.readFileSync(licensePath);
      if (!encrypted || encrypted.length === 0) return { isPro: false, key: "", activatedAt: null, deviceId: null };

      if (safeStorage.isEncryptionAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(encrypted);
          const parsed = JSON.parse(decrypted);
          if (parsed && typeof parsed === "object") return parsed;
        } catch (e) {
          // If decryption fails, it might be due to user change or OS lock
          console.error("[License] Decryption failed:", e);
          sendEvent("activity", { name: "System Boot", junk: `license_load_error | ${e.message || "decryption_failed"}` }, { force: true, immediate: true });
          
          // Last resort: check if it's plain text (rare but possible if safeStorage was unavailable during save)
          try {
            return JSON.parse(encrypted.toString("utf8"));
          } catch (_) {}
        }
      } else {
        try {
          return JSON.parse(encrypted.toString("utf8"));
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error("[License] Load error:", err);
  }
  return { isPro: false, key: "", activatedAt: null, deviceId: null };
}

function saveLicense(data) {
  try {
    const dir = path.dirname(licensePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const str = JSON.stringify(data);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(str);
      fs.writeFileSync(licensePath, encrypted);
    } else {
      fs.writeFileSync(licensePath, str, "utf8");
    }
  } catch (_) {}
}

let licenseState = { isPro: false, key: "", activatedAt: null, deviceId: null };

// ── unique device identification ──────────────────────────────────────────────
async function getSystemId() {
  return new Promise((resolve) => {
    // Basic hardware-bound hash for device linking
    const raw = os.hostname() + os.cpus()[0]?.model + os.totalmem() + os.arch();
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    resolve(hash);
  });
}

// ── supabase connection (High Encryption Transport) ──────────────────────────
const { SB_URL, SB_KEY } = require(path.join(__dirname, "config.js"));

async function verifySupabaseLicense(key, deviceId) {
  return new Promise((resolve) => {
    const options = {
      method: "GET",
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json"
      }
    };

    // Query for the license key
    const url = `${SB_URL}/rest/v1/licenses?key=eq.${encodeURIComponent(key)}&select=*`;
    
    const req = https.get(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", async () => {
        try {
          const list = JSON.parse(data);
          
          if (!list || list.length === 0) {
            // If the key is visibly in the DB but returns empty, RLS is blocking it.
            return resolve({ ok: false, error: "License key not found." });
          }
          
          const entry = list[0];

          // Device Linking Logic
          if (!entry.used || !entry.device_id) {
            // First time activation - link to this device and mark as used
            const updateOk = await updateSupabaseDevice(key, deviceId);
            if (updateOk) {
              return resolve({ ok: true, key: entry.key });
            } else {
              return resolve({ ok: false, error: "Failed to link device to license." });
            }
          } else if (entry.device_id !== deviceId) {
            return resolve({ ok: false, error: "License already in use on another device." });
          }

          resolve({ ok: true, key: entry.key });
        } catch (e) {
          resolve({ ok: false, error: "Encrypted communication failure." });
        }
      });
    });

    req.on("error", () => resolve({ ok: false, error: "Network security timeout." }));
  });
}

async function updateSupabaseDevice(key, deviceId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ device_id: deviceId, used: true });
    const options = {
      method: "PATCH",
      hostname: new URL(SB_URL).hostname,
      path: `/rest/v1/licenses?key=eq.${encodeURIComponent(key)}`,
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      }
    };

    const req = https.request(options, (res) => {
      resolve(res.statusCode === 204 || res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.write(body);
    req.end();
  });
}


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
    tray.setToolTip("XCoreTech PC Optimizer");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Optimizer", click: showMainWindow },
      { label: "Exit", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on("click", showMainWindow);
  } catch (_) { tray = null; }
}

function showFreeProReminder(reason) {
  if (licenseState.isPro) return false;
  if (!shouldShowFreeProReminder(engagementState)) return false;

  Object.assign(engagementState, markFreeProReminderShown(engagementState));
  saveJson(engagementPath, engagementState);

  const title = "Keep your PC clean automatically";
  const body = "XCoreTech is running quietly. Upgrade to Pro to unlock safe boot-time auto-clean and startup optimization.";

  try {
    if (Notification && Notification.isSupported()) {
      const notice = new Notification({
        title,
        body,
        silent: false,
        icon: resolveIconPath(),
      });
      notice.on("click", () => {
        showMainWindow();
        sendStatus("Pro unlocks automatic background cleaning on startup.");
      });
      notice.show();
    } else {
      sendStatus(`${title}: ${body}`);
    }
  } catch (_) {
    sendStatus(`${title}: ${body}`);
  }

  sendEvent("activity", { name: "Free User Reminder", junk: reason || "daily_pro_reminder" }, { force: true, immediate: true });
  return true;
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
      enableWebSQL:      false,
      backgroundThrottling: true,
      autoplayPolicy:    "user-gesture-required",
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

  ipcMain.handle("app:openExternal", async (_e, url) => {
    try {
      const target = String(url || "").trim();
      if (!/^(https:\/\/|mailto:|upi:\/\/)/i.test(target)) return { ok: false, error: "Unsupported link." };
      await shell.openExternal(target);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

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
    try { return { ok: true, items: await listStartupPrograms() }; }
    catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
  });
  ipcMain.handle("startup:setEnabled", async (_e, { name, approvedKey, regFlag, enable }) => {
    try { return await setStartupItemEnabled(name, approvedKey, regFlag, !!enable); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // license
  ipcMain.handle("license:get", async () => ({ ok: true, license: licenseState }));
  ipcMain.handle("license:verify", async (_e, key) => {
    try {
      const k = String(key || "").trim();
      if (!k) return { ok: false, error: "Please enter a valid key." };

      const deviceId = await getSystemId();
      
      // Perform Supabase Online Verification
      const result = await verifySupabaseLicense(k, deviceId);
      
      if (result.ok) {
        licenseState = { 
          isPro: true, 
          key: k, 
          activatedAt: Date.now(),
          deviceId: deviceId
        };
        saveLicense(licenseState);
        return { ok: true, msg: "Pro Version Activated via Supabase!" };
      }
      
      return { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: "High-level encryption verification failed." };
    }
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
    if (!licenseState.isPro) return { ok: false, error: "Pro feature locked." };
    try {
      sendStatus("Running Internet Fix…");
      const res = await require("./technician.js").internetFix((msg) => send("tech:progress", { id: "techInternetProg", msg }));
      sendStatus(res.ok ? "Internet Fix complete." : "Internet Fix partially failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle("tech:ramBoost", async () => {
    if (!licenseState.isPro) return { ok: false, error: "Pro feature locked." };
    try {
      sendStatus("Optimizing RAM…");
      const res = await require("./technician.js").ramBoost((msg) => send("tech:progress", { id: "techRamProg", msg }));
      sendStatus(res.ok ? "RAM Boost complete." : "RAM Boost failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle("tech:autoFix", async () => {
    if (!licenseState.isPro) return { ok: false, error: "Pro feature locked." };
    try {
      sendStatus("Running Auto Fix…");
      const res = await require("./technician.js").autoFix((msg) => send("tech:progress", { id: "techAutoProg", msg }));
      sendStatus(res.ok ? "Auto Fix complete." : "Auto Fix failed.");
      return res;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
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
  app.on("second-instance", () => { try { showMainWindow(); } catch (_) {} });

  app.whenReady().then(async () => {
    const endpoint = String(
      process.env.TRACKING_SHEET_URL ||
      "https://script.google.com/macros/s/AKfycbyrao1GQrhzYsO9PE3yzdzgj7T3QbaiT8V06fELWqGFWkIqEqwwqKTbgIT3khlmP0n0/exec"
    ).trim();

    initAnalytics({ endpoint, getSystemInfo, getLocation });
    primeLocation(path.join(app.getPath("userData"), "location-cache.json"));

    // Load license after app is ready to ensure safeStorage is available
    licenseState = loadLicense();
    if (process.env.PLAYWRIGHT_TEST) {
      licenseState.isPro = true;
    }

    createWindow();
    createTray();
    setupIpc();

    // Keep background startup available for all users.
    // Pro users can auto-clean; Free users only receive a daily upgrade reminder.
    setTimeout(async () => {
      try {
        await setAutoStartEnabled(AUTO_START_NAME, true);
      } catch (_) {}
    }, 5000); // 5s delay for registry stability

    // Identify boot-time launch and log to sheet
    const isHidden = process.argv.some((a) => a.toLowerCase() === "--hidden");
    const isAutoClean = process.argv.some((a) => a.toLowerCase() === "--autoclean");
    
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
      if (licenseState.isPro) {
        // Delay auto-clean to let the system stabilize
        setTimeout(() => {
          runAutoClean({ sendStatus, send });
        }, 12000); // 12s delay for background runs
      } else {
        sendStatus("Background mode active. Auto-clean is a Pro feature.");
        setTimeout(() => {
          showFreeProReminder("boot_background_free");
        }, 12000);
      }
    } else if (isHidden && !licenseState.isPro) {
      setTimeout(() => {
        showFreeProReminder("hidden_background_free");
      }, 12000);
    }
  });

  app.on("window-all-closed", () => { if (process.platform === "darwin") app.quit(); });
  app.on("activate",          () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("before-quit",       () => { isQuitting = true; });
}
