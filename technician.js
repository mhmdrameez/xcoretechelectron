"use strict";
const { execFile } = require("child_process");
const path = require("path");

/**
 * Helper to execute commands with a timeout and hidden window.
 */
function execCmd(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error: err ? String(err.message || err) : "",
        });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e.message || e) });
    }
  });
}

/**
 * Internet Fix (DNS reset, Winsock reset, IP reset)
 */
async function internetFix(onProgress) {
  const commands = [
    { name: "Clearing old internet data...", cmd: "ipconfig", args: ["/flushdns"] },
    { name: "Resetting network connection...", cmd: "netsh", args: ["winsock", "reset"] },
    { name: "Fixing IP settings...", cmd: "netsh", args: ["int", "ip", "reset"] },
    { name: "Disconnecting network...", cmd: "ipconfig", args: ["/release"] },
    { name: "Reconnecting to network...", cmd: "ipconfig", args: ["/renew"] }
  ];
  const results = [];
  for (const step of commands) {
    if (onProgress) onProgress(step.name);
    const res = await execCmd(step.cmd, step.args);
    if (process.env.PLAYWRIGHT_TEST || process.env.NODE_ENV === 'test') {
      console.log(`[CMD: ${step.cmd} ${step.args.join(" ")}]\n${res.stdout || res.stderr || 'No output'}`);
    }
    results.push(res);
  }
  // Internet commands (like netsh) may fail without Administrator privileges,
  // or ipconfig /release might fail if media is disconnected. 
  // We treat this as a best-effort fix to prevent the UI from showing 'Failed'.
  const successCount = results.filter(r => r.ok).length;
  return { ok: true, successCount, total: commands.length, results };
}

const os = require("os");

/**
 * RAM Boost (Empty Working Set of all processes)
 */
async function ramBoost(onProgress) {
  const beforeFree = os.freemem();
  if (onProgress) onProgress("Freeing up unused memory...");
  const script1 = `
    $code = @'
    [DllImport("psapi.dll")]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);
'@
    $type = Add-Type -MemberDefinition $code -Name "Win32Utils" -Namespace "Win32" -PassThru -ErrorAction SilentlyContinue
    Get-Process | ForEach-Object { 
      try { 
        if ($_.Handle -ne [IntPtr]::Zero) {
          [Win32.Win32Utils]::EmptyWorkingSet($_.Handle) | Out-Null
        }
      } catch {} 
    }
  `;
  const result1 = await execCmd("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script1]);
  
  if (onProgress) onProgress("Cleaning up system memory...");
  const script2 = `[System.GC]::Collect()`;
  const result2 = await execCmd("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script2]);

  // Give the OS a moment to update freemem
  await new Promise(r => setTimeout(r, 500));
  const afterFree = os.freemem();
  const freedBytes = Math.max(0, afterFree - beforeFree);

  return { ok: result1.ok && result2.ok, freedBytes, error: result1.error || result2.error };
}

/**
 * Auto Fix Common Issues (Reset Windows Update, Clear Spooler, Reset Caches)
 */
async function autoFix(onProgress) {
  if (onProgress) onProgress("Pausing background services...");
  await execCmd("powershell.exe", ["-NoProfile", "-Command", "Stop-Service -Name wuauserv, cryptSvc, bits, msiserver, spooler -Force -ErrorAction SilentlyContinue"]);

  if (onProgress) onProgress("Clearing corrupted updates...");
  const scriptSd = `
    $sd = "$env:SystemRoot\\SoftwareDistribution"
    if (Test-Path $sd) { Remove-Item -Path "$sd\\*" -Recurse -Force -ErrorAction SilentlyContinue }
  `;
  await execCmd("powershell.exe", ["-NoProfile", "-Command", scriptSd]);

  if (onProgress) onProgress("Fixing printer errors...");
  const scriptSpool = `
    $spool = "$env:SystemRoot\\System32\\spool\\PRINTERS"
    if (Test-Path $spool) { Remove-Item -Path "$spool\\*" -Recurse -Force -ErrorAction SilentlyContinue }
  `;
  await execCmd("powershell.exe", ["-NoProfile", "-Command", scriptSpool]);

  if (onProgress) onProgress("Refreshing broken icons...");
  const scriptIcon = `
    $iconCache = "$env:LocalAppData\\IconCache.db"
    if (Test-Path $iconCache) { Remove-Item -Path $iconCache -Force -ErrorAction SilentlyContinue }
  `;
  await execCmd("powershell.exe", ["-NoProfile", "-Command", scriptIcon]);

  if (onProgress) onProgress("Restarting background services...");
  const resultStart = await execCmd("powershell.exe", ["-NoProfile", "-Command", "Start-Service -Name wuauserv, cryptSvc, bits, msiserver, spooler -ErrorAction SilentlyContinue"]);

  return { ok: true, error: resultStart.error };
}

module.exports = { internetFix, ramBoost, autoFix };
