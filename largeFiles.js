"use strict";
// original-fs treats .asar archives as plain files; Electron's patched fs would
// walk into them and keep them open (locked) while the app runs.
const fs   = (() => { try { return require("original-fs"); } catch (_) { return require("fs"); } })();
const os   = require("os");
const path = require("path");
const { execFile } = require("child_process");

// ─── constants ────────────────────────────────────────────────────────────────
const WALK_CONCURRENCY = 8;
const REPORT_INTERVAL  = 200;   // ms between progress pushes
const MAX_RESULTS      = 500;   // keep only the biggest N files

// Folders directly under a drive root that belong to Windows or installed
// programs. Deleting anything in them can break the system, so never list them.
const SKIP_AT_DRIVE_ROOT = new Set([
  "windows", "program files", "program files (x86)", "programdata",
  "$recycle.bin", "system volume information", "recovery", "$winreagent",
  "config.msi", "$windows.~bt", "$windows.~ws", "$sysreset", "msocache",
  "perflogs", "boot", "documents and settings",
]);

// System files at a drive root (page file, hibernation file, …).
const SKIP_FILES_AT_DRIVE_ROOT = new Set([
  "pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log", "dumpstack.log.tmp",
  "bootmgr", "bootnxt",
]);

function isDriveRoot(p) {
  return /^[a-z]:\\?$/i.test(String(p || ""));
}

function isSkippedDir(parent, name) {
  return isDriveRoot(parent) && SKIP_AT_DRIVE_ROOT.has(name.toLowerCase());
}

function isSkippedFile(parent, name) {
  return isDriveRoot(parent) && SKIP_FILES_AT_DRIVE_ROOT.has(name.toLowerCase());
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
    const key = dir.toLowerCase();
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
function listFixedDrives() {
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

function getFixturePath() {
  return path.join(os.tmpdir(), "xcoretech-playwright-largefiles-fixture");
}

async function listSearchRoots() {
  const roots = [];
  if (process.env.PLAYWRIGHT_TEST) {
    roots.push({ id: "fixture", kind: "folder", label: "Test folder", path: getFixturePath() });
  }
  const home = os.homedir();
  if (home) roots.push({ id: "home", kind: "folder", label: "Your files", path: home });

  let drives = await listFixedDrives();
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

module.exports = {
  findLargeFiles,
  listSearchRoots,
  getFixturePath,
  isSkippedDir,
  MAX_RESULTS,
};
