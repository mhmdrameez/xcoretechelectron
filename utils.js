const { execFile } = require("child_process");
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { getPlatform } = require(path.join(__dirname, "platform.js"));

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const base = 1024;
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(base)));
  const val = n / Math.pow(base, i);
  const digits = i === 0 ? 0 : val >= 100 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(digits)} ${units[i]}`;
}

function debounceMs(fn, waitMs) {
  let t = null;
  let lastArgs = null;
  return function debounced(...args) {
    lastArgs = args;
    if (t) return;
    t = setTimeout(() => {
      t = null;
      try {
        fn(...(lastArgs || []));
      } catch (_) {}
    }, Math.max(0, Number(waitMs) || 0));
  };
}

function isProbablyUnsafeSystemPath(p) {
  return getPlatform().isUnsafePath(p);
}

function execReg(args) {
  return new Promise((resolve) => {
    try {
      execFile("reg", args, { windowsHide: true }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === "number" ? error.code : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: String(e && e.message ? e.message : e) });
    }
  });
}

function getRunKeyPath() {
  return "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
}

function getAutoStartCommand() {
  // Packaged: process.execPath is the installed exe.
  // Dev: use electron binary + app path.
  try {
    if (app && app.isPackaged) {
      return `"${process.execPath}" --autoclean --hidden`;
    }
  } catch (_) {}

  const electronExe = process.execPath;
  let appPath = "";
  try {
    appPath = app ? app.getAppPath() : "";
  } catch (_) {}
  appPath = appPath || path.resolve(__dirname);

  // In development, we need to pass the app path as the first argument
  return `"${electronExe}" "${appPath}" --autoclean --hidden`;
}

// ── macOS / Linux login start ───────────────────────────────────────────────
const LAUNCH_AGENT_LABEL = "com.xcoretech.diskcleaner";
const AUTOSTART_DESKTOP  = "xcoretech-pc-optimizer.desktop";

// The program and arguments to start this app hidden with an auto-clean.
function getLaunchArgs() {
  let packaged = false;
  try { packaged = !!(app && app.isPackaged); } catch (_) {}
  if (packaged) {
    // an AppImage runs from a temporary mount; start the AppImage file itself
    const exe = (process.platform === "linux" && process.env.APPIMAGE) || process.execPath;
    return [exe, "--autoclean", "--hidden"];
  }
  let appPath = "";
  try { appPath = app ? app.getAppPath() : ""; } catch (_) {}
  return [process.execPath, appPath || path.resolve(__dirname), "--autoclean", "--hidden"];
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildLaunchAgentPlist(args) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((a) => `    <string>${xmlEscape(a)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

// Exec= quoting from the freedesktop Desktop Entry spec
function desktopExecArg(a) {
  const s = String(a);
  if (!/[\s"'\\$`<>~|&;*?#()]/.test(s)) return s;
  return `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
}

function buildAutostartDesktop(args) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=XCoreTech PC Optimizer",
    "Comment=Clean up junk files when you log in",
    `Exec=${args.map(desktopExecArg).join(" ")}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function launchAgentPath() {
  return path.join(getPlatform().home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

function autostartDesktopPath() {
  return path.join(getPlatform().xdgConfig, "autostart", AUTOSTART_DESKTOP);
}

function writeFileSafe(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
    return true;
  } catch (_) { return false; }
}

function removeFileSafe(file) {
  try { fs.rmSync(file, { force: true }); return true; } catch (_) { return false; }
}

async function getAutoStartEnabled(entryName) {
  const plat = getPlatform();
  if (plat.isMac) return fs.existsSync(launchAgentPath());
  if (plat.isLinux) {
    try { return !/^Hidden\s*=\s*true/mi.test(fs.readFileSync(autostartDesktopPath(), "utf8")); }
    catch (_) { return false; }
  }
  const name = String(entryName || "DiskCleaner");
  const key = getRunKeyPath();
  const r = await execReg(["query", key, "/v", name]);
  return !!(r && r.ok);
}

async function setAutoStartEnabled(entryName, enabled) {
  const plat = getPlatform();
  if (plat.isMac) {
    return enabled ? writeFileSafe(launchAgentPath(), buildLaunchAgentPlist(getLaunchArgs()))
                   : removeFileSafe(launchAgentPath());
  }
  if (plat.isLinux) {
    return enabled ? writeFileSafe(autostartDesktopPath(), buildAutostartDesktop(getLaunchArgs()))
                   : removeFileSafe(autostartDesktopPath());
  }
  const name = String(entryName || "DiskCleaner");
  const key = getRunKeyPath();
  if (enabled) {
    const value = getAutoStartCommand();
    const r = await execReg(["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]);
    return !!(r && r.ok);
  }
  const r = await execReg(["delete", key, "/v", name, "/f"]);
  // If the value doesn't exist, reg returns non-zero; treat that as success for "disable".
  return !!(r && (r.ok || r.code !== 0));
}

module.exports = {
  formatBytes,
  debounceMs,
  isProbablyUnsafeSystemPath,
  getAutoStartEnabled,
  setAutoStartEnabled,
  buildLaunchAgentPlist,
  buildAutostartDesktop,
  LAUNCH_AGENT_LABEL,
};
