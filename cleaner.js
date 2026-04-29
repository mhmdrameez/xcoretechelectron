"use strict";
const fs   = require("fs");
const path = require("path");
const { isProbablyUnsafeSystemPath } = require(path.join(__dirname, "utils.js"));

// ─── helpers ──────────────────────────────────────────────────────────────────

function normPath(p) {
  try { return path.normalize(String(p || "")); } catch (_) { return String(p || ""); }
}

function quote(p) { return `"${String(p || "").replace(/"/g, '""')}"`; }

const { execFile } = require("child_process");

function execCmd(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: 12000 }, (err, stdout, stderr) => {
        resolve({
          ok    : !err,
          code  : err && typeof err.code === "number" ? err.code : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error : err ? String(err.message || err) : "",
        });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "", error: String(e && e.message ? e.message : e) });
    }
  });
}

async function isGone(p) {
  try { await fs.promises.lstat(p); return false; } catch (_) { return true; }
}

// ─── attribute strip ──────────────────────────────────────────────────────────

function clearAttr(targetPath, isDir) {
  const target = isDir ? `${targetPath}\\*` : targetPath;
  return execCmd("cmd.exe", ["/d", "/s", "/c", `attrib -r -h -s ${quote(target)}`]);
}

// ─── file deletion ────────────────────────────────────────────────────────────

async function forceDeleteFile(filePath) {
  // 1. native unlink (fastest path)
  try { await fs.promises.unlink(filePath); return { ok: true, method: "unlink" }; } catch (_) {}
  if (await isGone(filePath)) return { ok: true, method: "unlink-gone" };

  // 2. strip attributes, retry unlink
  await clearAttr(filePath, false);
  try { await fs.promises.unlink(filePath); return { ok: true, method: "unlink-attrib" }; } catch (_) {}
  if (await isGone(filePath)) return { ok: true, method: "attrib-gone" };

  // 3. shell del
  const shell = await execCmd("cmd.exe", ["/d", "/s", "/c", `del /f /q ${quote(filePath)}`]);
  if (shell.ok || await isGone(filePath)) return { ok: true, method: "shell-del" };

  // 4. schedule for reboot via PendingFileRenameOperations
  const scheduled = await schedulePendingDelete(filePath, false);
  return { ok: false, scheduled: !!scheduled.ok, error: shell.error || shell.stderr || "Failed to delete." };
}

// ─── directory deletion ───────────────────────────────────────────────────────

async function forceDeleteDir(dirPath) {
  // 1. rmdir (works if already empty)
  try { await fs.promises.rmdir(dirPath); return { ok: true, method: "rmdir" }; } catch (_) {}
  if (await isGone(dirPath)) return { ok: true, method: "rmdir-gone" };

  // 2. fs.rm recursive
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    return { ok: true, method: "fs-rm" };
  } catch (_) {}
  if (await isGone(dirPath)) return { ok: true, method: "fs-rm-gone" };

  // 3. strip attributes, retry rmdir
  await clearAttr(dirPath, true);
  try { await fs.promises.rmdir(dirPath); return { ok: true, method: "rmdir-attrib" }; } catch (_) {}

  // 4. shell rd
  const shell = await execCmd("cmd.exe", ["/d", "/s", "/c", `rd /s /q ${quote(dirPath)}`]);
  if (shell.ok || await isGone(dirPath)) return { ok: true, method: "shell-rd" };

  // 5. schedule reboot
  const scheduled = await schedulePendingDelete(dirPath, true);
  return { ok: false, scheduled: !!scheduled.ok, error: shell.error || shell.stderr || "Failed to delete dir." };
}

// ─── reboot-delete scheduler ──────────────────────────────────────────────────

async function schedulePendingDelete(entryPath, _isDir) {
  const normalized = normPath(entryPath);
  if (!normalized) return { ok: false, error: "Invalid path." };
  try {
    const escaped = normalized.replace(/'/g, "''");
    const source  = `\\\\??\\\\${escaped}`;
    const script  =
      "$key='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager';" +
      "$name='PendingFileRenameOperations';" +
      "$cur=(Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name;" +
      "if($null -eq $cur){$cur=@();}" +
      "$upd=@($cur)+'" + source + "','';" +
      "Set-ItemProperty -Path $key -Name $name -Value $upd -Type MultiString";
    const r = await execCmd("powershell.exe", ["-NoProfile", "-NonInteractive",
                             "-ExecutionPolicy", "Bypass", "-Command", script]);
    return r.ok ? { ok: true } : { ok: false, error: r.error || r.stderr };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ─── bounded concurrency runner ───────────────────────────────────────────────

async function parallel(items, worker, limit) {
  const list = Array.isArray(items) ? items : [];
  let   idx  = 0;
  async function run() {
    while (idx < list.length) {
      const i = idx++;
      await worker(list[i], i);
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(limit, list.length); i++) pool.push(run());
  await Promise.all(pool);
}

// ─── main export ──────────────────────────────────────────────────────────────

async function cleanFiles(files, directories, { onProgress, onLog }) {
  const fileList = Array.isArray(files) ? files : [];
  const dirList  = Array.isArray(directories)
    ? directories.slice().sort((a, b) => b.length - a.length)   // deepest first
    : [];

  const totalWork       = fileList.length + dirList.length;
  let deleted           = 0;
  let attempted         = 0;
  let skipped           = 0;
  let scheduledForReboot = 0;
  let lastReportAt      = 0;
  const failedFiles      = [];
  const failedDirectories = [];

  function report(force) {
    const t = Date.now();
    if (!force && t - lastReportAt < 120) return;
    lastReportAt = t;
    try {
      onProgress && onProgress({
        attempted, deleted, skipped, scheduledForReboot,
        percent: totalWork ? Math.round((attempted / totalWork) * 100) : 0,
      });
    } catch (_) {}
  }

  async function processFile(filePath) {
    const p = normPath(filePath);
    if (!p || isProbablyUnsafeSystemPath(p)) {
      skipped++; attempted++;
      onLog && !p && onLog({ level: "warn", msg: "Empty path skipped" });
      report(false); return;
    }
    const r = await forceDeleteFile(p);
    attempted++;
    if (r.ok) {
      deleted++;
    } else {
      skipped++;
      if (r.scheduled) scheduledForReboot++;
      failedFiles.push(p);
      onLog && onLog({ level: r.scheduled ? "info" : "debug",
        msg: r.scheduled ? "Scheduled for reboot" : "Failed to delete", path: p, error: r.error });
    }
    if (attempted % 250 === 0) { report(false); await new Promise(setImmediate); }
  }

  async function processDir(dirPath) {
    const p = normPath(dirPath);
    if (!p || isProbablyUnsafeSystemPath(p)) {
      skipped++; attempted++;
      report(false); return;
    }
    const r = await forceDeleteDir(p);
    attempted++;
    if (r.ok) {
      deleted++;
    } else {
      skipped++;
      if (r.scheduled) scheduledForReboot++;
      failedDirectories.push(p);
      onLog && onLog({ level: r.scheduled ? "info" : "debug",
        msg: r.scheduled ? "Dir scheduled for reboot" : "Failed to delete dir", path: p, error: r.error });
    }
    if (attempted % 250 === 0) { report(false); await new Promise(setImmediate); }
  }

  // Files: 6 parallel workers; Dirs: 3 (deepest-first avoids parent-locking)
  await parallel(fileList, processFile, 6);
  await parallel(dirList,  processDir,  3);

  report(true);
  return { ok: true, deleted, attempted, skipped, scheduledForReboot, failedFiles, failedDirectories };
}

module.exports = { cleanFiles };
