"use strict";
const fs   = require("fs");
const path = require("path");

// ─── constants ────────────────────────────────────────────────────────────────
const WALK_CONCURRENCY = 6;    // concurrent readdirs — lower = less OS handle pressure
const REPORT_INTERVAL  = 150;  // ms between progress pushes
const YIELD_EVERY      = 400;  // items before yielding to event loop
const BATCH_CAP        = 200;  // max new-files in one progress payload

// ─── helpers ──────────────────────────────────────────────────────────────────
function envPath(name) { return process.env[name] || ""; }
function safeJoin(base, ...parts) {
  try { return path.join(base, ...parts); } catch (_) { return ""; }
}

// ─── parallel directory walker ─────────────────────────────────────────────────
async function scanPaths(targetPaths, { cancel, onProgress, onLog }) {
  const files       = [];
  const directories = [];
  let   totalBytes  = 0;

  const visitedDirs   = new Set();
  const dirQueue      = [];
  const newFilesBatch = [];
  let   processedItems = 0;
  let   lastProgressAt = 0;

  // pre-seed queue — sync stat once per root, then async everywhere else
  for (let i = 0; i < targetPaths.length; i++) {
    const p = targetPaths[i];
    if (!p) continue;
    try {
      if (fs.statSync(p).isDirectory()) dirQueue.push(p);
    } catch (_) {
      onLog && onLog({ level: "info", msg: "Root path missing, skipped", path: p });
    }
  }

  function maybeReport(force) {
    const t = Date.now();
    if (!force && t - lastProgressAt < REPORT_INTERVAL) return;
    lastProgressAt = t;
    try {
      onProgress && onProgress({
        totalFiles: files.length,
        totalBytes,
        percent:    0,
        newFiles:   newFilesBatch.splice(0),
      });
    } catch (_) {}
  }

  async function processDir(dir) {
    const key = dir.toLowerCase();
    if (visitedDirs.has(key)) return;
    visitedDirs.add(key);
    directories.push(dir);

    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      onLog && onLog({ level: "warn", msg: "readdir failed", path: dir,
                       error: e && e.message ? e.message : String(e) });
      return;
    }

    for (let i = 0; i < entries.length; i++) {
      if (cancel && cancel.cancelled) return;
      const ent = entries[i];
      if (ent.isSymbolicLink() || ent.isFIFO() || ent.isCharacterDevice()) {
        processedItems++; continue;
      }
      const full = safeJoin(dir, ent.name);
      if (!full) { processedItems++; continue; }

      if (ent.isDirectory()) {
        const lk = full.toLowerCase();
        if (!visitedDirs.has(lk)) dirQueue.push(full);
        processedItems++; continue;
      }

      if (ent.isFile()) {
        let size = 0;
        try { size = (await fs.promises.stat(full)).size; }
        catch (_) { processedItems++; continue; }
        files.push(full);
        totalBytes += size;
        if (newFilesBatch.length < BATCH_CAP) newFilesBatch.push(full);
      }

      processedItems++;
      if (processedItems % YIELD_EVERY === 0) {
        maybeReport(false);
        await new Promise(setImmediate);
      }
    }
    maybeReport(false);
  }

  async function worker() {
    while (dirQueue.length && !(cancel && cancel.cancelled)) {
      const dir = dirQueue.shift();
      if (dir) await processDir(dir);
    }
  }

  const count   = Math.min(WALK_CONCURRENCY, Math.max(1, dirQueue.length));
  const workers = [];
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);

  maybeReport(true);
  directories.sort((a, b) => b.length - a.length);
  return { files, directories, totalBytes, cancelled: !!(cancel && cancel.cancelled) };
}

// ─── default targets ───────────────────────────────────────────────────────────
function getDefaultTargets() {
  const temp  = envPath("TEMP") || envPath("TMP");
  const local = envPath("LOCALAPPDATA");
  const win   = envPath("WINDIR") || "C:\\Windows";
  const t = [];
  if (temp)  t.push(temp);
  t.push("C:\\Windows\\Temp");
  t.push(safeJoin(win,   "Prefetch"));
  if (local) {
    t.push(safeJoin(local, "Google",    "Chrome", "User Data", "Default", "Cache"));
    t.push(safeJoin(local, "Microsoft", "Edge",   "User Data", "Default", "Cache"));
  }
  return t.filter(Boolean);
}

async function scanDefaultTargets(opts) {
  return scanPaths(getDefaultTargets(), opts);
}

module.exports = { scanPaths, scanDefaultTargets, getDefaultTargets };
