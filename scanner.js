"use strict";
const fs   = require("fs");
const path = require("path");

// ─── tiny helpers ────────────────────────────────────────────────────────────

function envPath(name) { return process.env[name] || ""; }

function safeJoin(base, ...parts) {
  try { return path.join(base, ...parts); } catch (_) { return ""; }
}

// ─── parallel directory walker ────────────────────────────────────────────────
// Uses a fixed-size worker pool so we never flood the OS with thousands of
// concurrent readdir calls.  Each worker pulls the next directory off a shared
// queue, reads it, and dispatches child dirs back onto the queue.

const WALK_CONCURRENCY = 8;   // concurrent readdirs
const REPORT_INTERVAL  = 150; // ms between progress events
const YIELD_EVERY      = 500; // items before yielding to event loop

async function scanPaths(targetPaths, { cancel, onProgress, onLog }) {
  const files       = [];
  const directories = [];
  let   totalBytes  = 0;

  const visitedDirs  = new Set();
  const dirQueue     = [];          // shared queue
  const newFilesBatch = [];
  let   processedItems = 0;
  let   lastProgressAt = 0;
  let   activeWorkers  = 0;

  // pre-seed queue
  for (let i = 0; i < targetPaths.length; i++) {
    const p = targetPaths[i];
    if (!p) continue;
    try {
      const st = fs.statSync(p);          // sync – only called once per root
      if (st.isDirectory()) dirQueue.push(p);
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
        totalFiles : files.length,
        totalBytes,
        percent    : 0,                         // indeterminate – queue shrinks nonlinearly
        newFiles   : newFilesBatch.splice(0),   // drain batch in-place (no copy)
      });
    } catch (_) {}
  }

  // resolve a single directory
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

      // skip symlinks and special device files – no extra stat needed
      if (ent.isSymbolicLink() || ent.isFIFO() || ent.isCharacterDevice()) {
        processedItems++;
        continue;
      }

      const full = safeJoin(dir, ent.name);
      if (!full) { processedItems++; continue; }

      if (ent.isDirectory()) {
        const lk = full.toLowerCase();
        if (!visitedDirs.has(lk)) dirQueue.push(full);
        processedItems++;
        continue;
      }

      if (ent.isFile()) {
        let size = 0;
        try {
          // use BigInt stat to avoid number coercion overhead on large files
          const st = await fs.promises.stat(full);
          size = st.size;
        } catch (_) { processedItems++; continue; }

        files.push(full);
        totalBytes += size;
        if (newFilesBatch.length < 300) newFilesBatch.push(full);
      }

      processedItems++;
      if (processedItems % YIELD_EVERY === 0) {
        maybeReport(false);
        await new Promise(setImmediate);   // yield to event loop
      }
    }

    maybeReport(false);
  }

  // worker loop – keeps pulling from the shared queue until empty
  async function worker() {
    activeWorkers++;
    while (dirQueue.length && !(cancel && cancel.cancelled)) {
      const dir = dirQueue.shift();
      if (dir) await processDir(dir);
    }
    activeWorkers--;
  }

  // start up to WALK_CONCURRENCY workers
  const workers = [];
  const count   = Math.min(WALK_CONCURRENCY, Math.max(1, dirQueue.length));
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);

  maybeReport(true);
  directories.sort((a, b) => b.length - a.length);
  return { files, directories, totalBytes, cancelled: !!(cancel && cancel.cancelled) };
}

// ─── default targets ──────────────────────────────────────────────────────────

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
