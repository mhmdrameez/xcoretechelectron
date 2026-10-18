"use strict";
// Programs that start when the user signs in, and switching them on or off.
// Windows: registry Run keys + Startup folders. macOS: LaunchAgents.
// Linux: XDG autostart .desktop files.

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { exec, execFile } = require("child_process");

// Electron's app (for the Startup folder path); absent when unit-tested in Node
let app = null;
try { ({ app } = require("electron")); } catch (_) {}

function appDataDir() {
  try { if (app && app.getPath) return app.getPath("appData"); } catch (_) {}
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
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
    const userStartup   = path.join(appDataDir(), "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
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


// ── macOS: LaunchAgents ───────────────────────────────────────────────────────
// Per-user agents can be switched off with `launchctl disable`, which macOS
// remembers across restarts. Agents for all users are listed but read-only.
function execFileP(file, args, timeout) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: timeout || 10000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""),
          error: err ? String(err.message || err) : "" }));
    } catch (e) { resolve({ ok: false, stdout: "", stderr: "", error: String(e.message || e) }); }
  });
}

// `launchctl print-disabled gui/<uid>` lines look like:  "com.foo.agent" => disabled
function parseLaunchctlDisabled(stdout) {
  const map = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const m = /"([^"]+)"\s*=>\s*(\w+)/.exec(line);
    if (m) map[m[1]] = m[2] === "disabled" || m[2] === "true";
  }
  return map;
}

async function readPlist(file) {
  const r = await execFileP("plutil", ["-convert", "json", "-o", "-", file]);
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); } catch (_) { return null; }
}

async function listMacStartup() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const disabled = parseLaunchctlDisabled((await execFileP("launchctl", ["print-disabled", `gui/${uid}`])).stdout);
  const sources = [
    { dir: path.join(os.homedir(), "Library", "LaunchAgents"), label: "This user", canToggle: true },
    { dir: "/Library/LaunchAgents", label: "All users", canToggle: false },
  ];
  const items = [];
  for (const src of sources) {
    let files = [];
    try { files = fs.readdirSync(src.dir).filter((f) => f.endsWith(".plist")); } catch (_) { continue; }
    for (const f of files) {
      const plist = await readPlist(path.join(src.dir, f));
      if (!plist) continue;
      const label = String(plist.Label || f.replace(/\.plist$/, ""));
      const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments : [];
      const command = [plist.Program || args[0] || ""].concat(plist.Program ? args.slice(1) : args.slice(1)).join(" ").trim();
      if (command.includes("--autoclean")) continue; // our own entry, managed by the checkbox
      items.push({
        id: `${src.label}|${label}`, name: label, command, source: src.label,
        enabled: !(disabled[label] === true || plist.Disabled === true),
        canToggle: src.canToggle, label,
      });
    }
  }
  return items;
}

async function setMacStartupEnabled(item, enable) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const r = await execFileP("launchctl", [enable ? "enable" : "disable", `gui/${uid}/${item.label}`]);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim() || r.error };
}

// ── Linux: XDG autostart .desktop files ──────────────────────────────────────
// A file in ~/.config/autostart overrides one with the same name in
// /etc/xdg/autostart, so switching off a system entry writes a user copy
// with Hidden=true.
function parseDesktopEntry(text) {
  const out = {};
  let inMain = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) { inMain = line === "[Desktop Entry]"; continue; }
    if (!inMain || !line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      if (!(key in out)) out[key] = line.slice(i + 1).trim();
    }
  }
  return out;
}

function desktopEnabled(entry) {
  return String(entry.Hidden || "").toLowerCase() !== "true" &&
         String(entry["X-GNOME-Autostart-enabled"] || "").toLowerCase() !== "false";
}

// sets Hidden= in the [Desktop Entry] group, adding the key if needed
function setDesktopHidden(text, hidden) {
  const lines = String(text || "").split(/\r?\n/);
  const value = `Hidden=${hidden ? "true" : "false"}`;
  let start = lines.findIndex((l) => l.trim() === "[Desktop Entry]");
  if (start < 0) { lines.unshift("[Desktop Entry]"); start = 0; }
  let end = lines.findIndex((l, i) => i > start && l.trim().startsWith("["));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && /^\s*Hidden\s*=/.test(l));
  if (at >= 0) lines[at] = value; else { lines.splice(start + 1, 0, value); end++; }
  // GNOME also honours this key; keep it consistent
  const g = lines.findIndex((l, i) => i > start && i < end && /^\s*X-GNOME-Autostart-enabled\s*=/.test(l));
  if (g >= 0) lines[g] = `X-GNOME-Autostart-enabled=${hidden ? "false" : "true"}`;
  return lines.join("\n");
}

function linuxAutostartDirs() {
  const { getPlatform } = require(path.join(__dirname, "platform.js"));
  const userDir = path.join(getPlatform().xdgConfig, "autostart");
  const sysDirs = String(process.env.XDG_CONFIG_DIRS || "/etc/xdg").split(":").filter(Boolean)
    .map((d) => path.join(d, "autostart"));
  return { userDir, sysDirs };
}

function listLinuxStartup() {
  const { userDir, sysDirs } = linuxAutostartDirs();
  const byFile = new Map();
  const read = (dir, source) => {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".desktop")); } catch (_) { return; }
    for (const f of files) {
      if (byFile.has(f)) continue; // user copy wins
      let text = "";
      try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch (_) { continue; }
      byFile.set(f, { file: f, dir, source, entry: parseDesktopEntry(text) });
    }
  };
  read(userDir, "This user");
  for (const d of sysDirs) read(d, "All users");

  const items = [];
  for (const { file, dir, source, entry } of byFile.values()) {
    const command = entry.Exec || "";
    if (command.includes("--autoclean")) continue; // our own entry
    items.push({
      id: `autostart|${file}`, name: entry.Name || file.replace(/\.desktop$/, ""), command,
      source, enabled: desktopEnabled(entry), canToggle: true, file, dir,
    });
  }
  return items;
}

function setLinuxStartupEnabled(item, enable) {
  const { userDir } = linuxAutostartDirs();
  try {
    const src = fs.existsSync(path.join(userDir, item.file)) ? path.join(userDir, item.file) : path.join(item.dir, item.file);
    const text = fs.readFileSync(src, "utf8");
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, item.file), setDesktopHidden(text, !enable), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ── public API ───────────────────────────────────────────────────────────────
async function listStartupItems() {
  if (process.platform === "darwin") return listMacStartup();
  if (process.platform !== "win32") return listLinuxStartup();
  return listStartupPrograms();
}

async function setStartupEnabled(item, enable) {
  if (!item || !item.canToggle) return { ok: false, error: "Cannot toggle this entry." };
  if (process.platform === "darwin") return setMacStartupEnabled(item, enable);
  if (process.platform !== "win32") return setLinuxStartupEnabled(item, enable);
  return setStartupItemEnabled(item.name, item.approvedKey, item.regFlag, enable);
}

module.exports = {
  listStartupItems,
  setStartupEnabled,
  parseRegEntries,
  parseRegDisabled,
  parseLaunchctlDisabled,
  parseDesktopEntry,
  desktopEnabled,
  setDesktopHidden,
};
