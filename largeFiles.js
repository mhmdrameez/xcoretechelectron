"use strict";
// original-fs treats .asar archives as plain files; Electron's patched fs would
// walk into them and keep them open (locked) while the app runs.
const fs   = (() => { try { return require("original-fs"); } catch (_) { return require("fs"); } })();
const os   = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { getPlatform } = require(path.join(__dirname, "platform.js"));

// ─── constants ────────────────────────────────────────────────────────────────
const WALK_CONCURRENCY = 8;
const REPORT_INTERVAL  = 200;   // ms between progress pushes
const MAX_RESULTS      = 500;   // keep only the biggest N files

// System and program folders are never listed; the rules for each OS are in
// platform.js (e.g. C:\Windows, /System, /usr).
function isSkippedDir(parent, name) {
  return getPlatform().isSkippedDir(parent, name);
}

function isSkippedFile(parent, name) {
  return getPlatform().isSkippedFile(parent, name);
}

// ─── result set — keeps the biggest MAX_RESULTS files ─────────────────────────
function createTopList(limit) {
  let items = [];
  let floor = 0; // smallest size still worth keeping once the list is full
  return {
    add(item) {
      if (items.length >= limit && item.size <= floor) return;
      items.push(item);
      if (items.length >= limit * 2) {
        items.sort((a, b) => b.size - a.size);
        items.length = limit;
        floor = items[limit - 1].size;
      }
    },
    result() {
      items.sort((a, b) => b.size - a.size);
      if (items.length > limit) items.length = limit;
      return items;
    },
    get count() { return items.length; },
  };
}

// ─── parallel walker ──────────────────────────────────────────────────────────
async function findLargeFiles(root, { minBytes, cancel, onProgress, maxResults } = {}) {
  const threshold = Math.max(1, Number(minBytes) || 0);
  const top       = createTopList(Math.max(1, Number(maxResults) || MAX_RESULTS));
  const visited   = new Set();
  const queue     = [];
  let scannedFiles = 0;
  let foundCount   = 0;
  let currentDir   = "";
  let lastReportAt = 0;

  function report(force) {
    const t = Date.now();
    if (!force && t - lastReportAt < REPORT_INTERVAL) return;
    lastReportAt = t;
    try { onProgress && onProgress({ scannedFiles, found: foundCount, currentDir }); } catch (_) {}
  }

  try {
    if (fs.statSync(root).isDirectory()) queue.push(root);
  } catch (_) {
    return { items: [], scannedFiles: 0, cancelled: false, error: "Folder not found." };
  }

  async function processDir(dir) {
    const key = getPlatform().pathKey(dir);
    if (visited.has(key)) return;
    visited.add(key);
    currentDir = dir;

    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; } // no access — skip quietly

    for (const ent of entries) {
      if (cancel && cancel.cancelled) return;
      // junctions and symlinks would make us walk the same data twice (or loop)
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        if (!isSkippedDir(dir, ent.name)) queue.push(full);
        continue;
      }
      if (!ent.isFile() || isSkippedFile(dir, ent.name)) continue;

      let st;
      try { st = await fs.promises.stat(full); } catch (_) { continue; }
      scannedFiles++;
      if (st.size >= threshold) {
        foundCount++;
        top.add({ path: full, name: ent.name, size: st.size, modified: st.mtimeMs });
      }
      if (scannedFiles % 500 === 0) report(false);
    }
    report(false);
  }

  // A worker with an empty queue waits while others are still reading folders,
  // because those folders may add more work.
  let active = 0;
  async function worker() {
    while (!(cancel && cancel.cancelled)) {
      const dir = queue.shift();
      if (!dir) {
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      active++;
      try { await processDir(dir); } finally { active--; }
    }
  }

  await Promise.all(Array.from({ length: WALK_CONCURRENCY }, worker));

  report(true);
  return {
    items: top.result(),
    found: foundCount,
    scannedFiles,
    cancelled: !!(cancel && cancel.cancelled),
  };
}

// ─── where the user can search ────────────────────────────────────────────────
function listWindowsDrives() {
  return new Promise((resolve) => {
    const script = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | " +
      "ForEach-Object { '{0}|{1}|{2}' -f $_.DeviceID, $_.Size, $_.FreeSpace }";
    try {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 10000 }, (err, stdout) => {
          if (err) return resolve([]);
          const drives = String(stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            .map((l) => {
              const [id, size, free] = l.split("|");
              return { letter: id, size: Number(size) || 0, free: Number(free) || 0 };
            })
            .filter((d) => /^[A-Z]:$/i.test(d.letter));
          resolve(drives);
        });
    } catch (_) { resolve([]); }
  });
}

// Parses `df -Pk` output into { mount, size, free } (bytes).
function parseDf(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).slice(1).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // "Filesystem 1024-blocks Used Available Capacity Mounted-on"; the mount
    // point is everything after the capacity column (it may contain spaces)
    const m = /^\S+\s+(\d+)\s+\d+\s+(\d+)\s+\d+%\s+(.+)$/.exec(line.trim());
    if (m) out.push({ mount: m[3], size: Number(m[1]) * 1024, free: Number(m[2]) * 1024 });
  }
  return out;
}

// The system disk plus external/extra drives, ignoring pseudo and system mounts.
function isUserMount(mount, plat) {
  if (mount === "/") return true;
  if (plat.isMac) return mount.startsWith("/Volumes/");
  return /^\/(media|mnt|run\/media)\//.test(mount);
}

function listPosixDrives(plat) {
  return new Promise((resolve) => {
    try {
      execFile("df", ["-Pk"], { timeout: 10000 }, (err, stdout) => {
        if (err && !stdout) return resolve([]);
        resolve(parseDf(stdout).filter((d) => isUserMount(d.mount, plat)));
      });
    } catch (_) { resolve([]); }
  });
}

function getFixturePath() {
  return path.join(os.tmpdir(), "xcoretech-playwright-largefiles-fixture");
}

async function listSearchRoots() {
  const plat = getPlatform();
  const roots = [];
  if (process.env.PLAYWRIGHT_TEST) {
    roots.push({ id: "fixture", kind: "folder", label: "Test folder", path: getFixturePath() });
  }
  const home = os.homedir();
  if (home) roots.push({ id: "home", kind: "folder", label: "Your files", path: home });

  if (plat.isWin) {
    let drives = await listWindowsDrives();
    if (!drives.length) drives = [{ letter: "C:", size: 0, free: 0 }];
    for (const d of drives) {
      roots.push({
        id: `drive-${d.letter[0].toLowerCase()}`, kind: "drive",
        label: `Whole drive ${d.letter}`, path: `${d.letter}\\`,
        size: d.size, free: d.free,
      });
    }
    return roots;
  }

  let drives = await listPosixDrives(plat);
  if (!drives.some((d) => d.mount === "/")) drives.unshift({ mount: "/", size: 0, free: 0 });
  drives.forEach((d, i) => {
    const isSystem = d.mount === "/";
    roots.push({
      id: isSystem ? "drive-root" : `drive-${i}`, kind: "drive",
      label: isSystem ? "Whole disk" : `Drive ${path.basename(d.mount)}`,
      path: d.mount, size: d.size, free: d.free,
    });
  });
  return roots;
}

module.exports = {
  findLargeFiles,
  listSearchRoots,
  getFixturePath,
  isSkippedDir,
  parseDf,
  MAX_RESULTS,
};
