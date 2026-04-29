const { execFile } = require("child_process");
const { app } = require("electron");
const path = require("path");

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
  const s = String(p || "").toLowerCase();
  if (!s) return true;
  if (s.includes("\\windows\\system32\\")) return true;
  if (s.endsWith("\\windows\\system32")) return true;
  if (s.includes("\\program files\\")) return true;
  if (s.includes("\\program files (x86)\\")) return true;
  if (s.includes("\\windows\\winsxs\\")) return true;
  return false;
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

  return `"${electronExe}" "${appPath}" --autoclean --hidden`;
}

async function getAutoStartEnabled(entryName) {
  const name = String(entryName || "DiskCleaner");
  const key = getRunKeyPath();
  const r = await execReg(["query", key, "/v", name]);
  return !!(r && r.ok);
}

async function setAutoStartEnabled(entryName, enabled) {
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
};

