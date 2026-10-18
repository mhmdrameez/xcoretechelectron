"use strict";
// Everything that differs between Windows, macOS and Linux: where caches
// live, which folders must never be touched, and what each OS supports.
// createPlatform() takes overrides so tests can simulate any OS.

const os   = require("os");
const path = require("path");

const NAMES = { win32: "Windows", darwin: "macOS", linux: "Linux" };

// ── protected locations ──────────────────────────────────────────────────────
const MAC_PROTECTED = [
  "/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/etc",
  "/private", "/dev", "/cores", "/opt", "/var",
];
const LINUX_PROTECTED = [
  "/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/opt",
  "/proc", "/run", "/sbin", "/snap", "/srv", "/sys", "/usr", "/var",
];

// folders directly under "/" that a whole-disk search skips: system folders,
// plus places where other drives are mounted (searched on their own instead)
const MAC_SKIP_AT_ROOT = new Set([
  "system", "library", "applications", "private", "usr", "bin", "sbin", "dev",
  "cores", "opt", "etc", "var", "tmp", "volumes", "network",
]);
const LINUX_SKIP_AT_ROOT = new Set([
  "proc", "sys", "dev", "run", "boot", "usr", "bin", "sbin", "lib", "lib32",
  "lib64", "libx32", "etc", "var", "snap", "opt", "srv", "lost+found", "tmp",
  "root", "media", "mnt",
]);
const LINUX_SKIP_FILES_AT_ROOT = new Set(["swapfile", "swap.img"]);

const WIN_SKIP_AT_DRIVE_ROOT = new Set([
  "windows", "program files", "program files (x86)", "programdata",
  "$recycle.bin", "system volume information", "recovery", "$winreagent",
  "config.msi", "$windows.~bt", "$windows.~ws", "$sysreset", "msocache",
  "perflogs", "boot", "documents and settings",
]);
const WIN_SKIP_FILES_AT_DRIVE_ROOT = new Set([
  "pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log", "dumpstack.log.tmp",
  "bootmgr", "bootnxt",
]);

function isWinDriveRoot(p) {
  return /^[a-z]:\\?$/i.test(String(p || ""));
}

function underAny(p, prefixes) {
  const s = String(p || "");
  return prefixes.some((pre) => s === pre || s.startsWith(pre + "/"));
}

// darwin kernel major version -> macOS version (20 = Big Sur 11 … 25 = Tahoe 26)
function macVersionFromDarwin(release) {
  const major = parseInt(String(release || ""), 10);
  if (!major) return "";
  if (major >= 25) return String(26 + (major - 25));
  if (major >= 20) return String(major - 9);
  if (major >= 4) return `10.${major - 4}`;
  return "";
}

function createPlatform(opts = {}) {
  const id   = opts.platform || process.platform;
  const env  = opts.env || process.env;
  const home = opts.home || env.USERPROFILE || env.HOME || os.homedir();
  const isWin = id === "win32";
  const isMac = id === "darwin";
  const isLinux = !isWin && !isMac;

  const localAppData = opts.localAppData || env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const xdgCache  = env.XDG_CACHE_HOME  || path.join(home, ".cache");
  const xdgData   = env.XDG_DATA_HOME   || path.join(home, ".local", "share");
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const tempDir   = opts.tmp || (isWin ? (env.TEMP || env.TMP) : env.TMPDIR) || os.tmpdir();

  // Windows and default macOS file systems ignore letter case
  const caseInsensitive = isWin || isMac;
  const pathKey = (p) => (caseInsensitive ? String(p || "").toLowerCase() : String(p || ""));

  function junkTargets() {
    if (isWin) {
      const win = env.WINDIR || "C:\\Windows";
      const t = [];
      if (tempDir) t.push(tempDir);
      t.push("C:\\Windows\\Temp");
      t.push(path.join(win, "Prefetch"));
      t.push(path.join(localAppData, "Google", "Chrome", "User Data", "Default", "Cache"));
      t.push(path.join(localAppData, "Microsoft", "Edge", "User Data", "Default", "Cache"));
      return t;
    }
    if (isMac) {
      const caches = path.join(home, "Library", "Caches");
      return [
        path.join(caches, "Google", "Chrome", "Default", "Cache"),
        path.join(caches, "Microsoft Edge", "Default", "Cache"),
        path.join(caches, "BraveSoftware", "Brave-Browser", "Default", "Cache"),
        path.join(home, "Library", "Logs", "DiagnosticReports"),
      ];
    }
    return [
      path.join(xdgCache, "thumbnails"),
      path.join(xdgCache, "google-chrome", "Default", "Cache"),
      path.join(xdgCache, "chromium", "Default", "Cache"),
      path.join(xdgCache, "microsoft-edge", "Default", "Cache"),
      path.join(xdgCache, "BraveSoftware", "Brave-Browser", "Default", "Cache"),
    ];
  }

  function isUnsafePath(p) {
    const s = String(p || "");
    if (!s) return true;
    if (isWin) {
      const l = s.toLowerCase();
      return l.includes("\\windows\\system32\\") || l.endsWith("\\windows\\system32") ||
        l.includes("\\program files\\") || l.includes("\\program files (x86)\\") ||
        l.includes("\\windows\\winsxs\\");
    }
    if (s === "/") return true;
    if (isMac) {
      // ~/Library is the user's own; only the system-level folders are protected
      // except each user's own temp area, which lives under /var/folders
      if (underAny(s, ["/var/folders", "/private/var/folders"])) return false;
      return underAny(s, MAC_PROTECTED);
    }
    return underAny(s, LINUX_PROTECTED);
  }

  function isSkippedDir(parent, name) {
    const n = String(name || "").toLowerCase();
    if (isWinDriveRoot(parent)) return WIN_SKIP_AT_DRIVE_ROOT.has(n);
    if (parent === "/") return (isMac ? MAC_SKIP_AT_ROOT : LINUX_SKIP_AT_ROOT).has(n);
    return false;
  }

  function isSkippedFile(parent, name) {
    const n = String(name || "").toLowerCase();
    if (isWinDriveRoot(parent)) return WIN_SKIP_FILES_AT_DRIVE_ROOT.has(n);
    if (parent === "/" && isLinux) return LINUX_SKIP_FILES_AT_ROOT.has(n);
    return false;
  }

  // default cache locations; tools can report their own (see devCaches.js)
  const dev = isWin ? {
    npmCache:   path.join(localAppData, "npm-cache"),
    uvCache:    path.join(localAppData, "uv", "cache"),
    pnpmStore:  path.join(localAppData, "pnpm", "store"),
    pipCache:   path.join(localAppData, "pip", "Cache"),
    playwright: path.join(localAppData, "ms-playwright"),
    condaBases: ["anaconda3", "miniconda3", "miniforge3", "mambaforge"].map((b) => path.join(home, b)),
    condaExtraPkgs: [path.join(home, ".conda", "pkgs"), path.join(localAppData, "conda", "conda", "pkgs")],
    condaExes:  [["Scripts", "conda.exe"], ["condabin", "conda.bat"]],
  } : {
    npmCache:   path.join(home, ".npm"),
    uvCache:    path.join(xdgCache, "uv"),
    pnpmStore:  isMac ? path.join(home, "Library", "pnpm", "store") : path.join(xdgData, "pnpm", "store"),
    pipCache:   isMac ? path.join(home, "Library", "Caches", "pip") : path.join(xdgCache, "pip"),
    playwright: isMac ? path.join(home, "Library", "Caches", "ms-playwright") : path.join(xdgCache, "ms-playwright"),
    condaBases: ["anaconda3", "miniconda3", "miniforge3", "mambaforge"]
      .flatMap((b) => (isMac ? [path.join(home, b), path.join(home, "opt", b)] : [path.join(home, b)])),
    condaExtraPkgs: [path.join(home, ".conda", "pkgs")],
    condaExes:  [["bin", "conda"], ["condabin", "conda"]],
  };

  return {
    id,
    name: NAMES[id] || id,
    isWin, isMac, isLinux,
    home, tempDir, localAppData, xdgCache, xdgData, xdgConfig,
    caseInsensitive, pathKey,
    junkTargets, isUnsafePath, isSkippedDir, isSkippedFile,
    dev,
    // which Quick fixes do something useful on this OS
    techTools: isWin ? ["internet", "ram", "autofix"] : ["internet"],
    macVersionFromDarwin,
  };
}

let current = null;
function getPlatform() {
  if (!current) current = createPlatform();
  return current;
}

module.exports = { createPlatform, getPlatform, macVersionFromDarwin, isWinDriveRoot };
