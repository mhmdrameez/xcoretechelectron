"use strict";
(function () {

  // ── element cache ──────────────────────────────────────────────────────────
  const el = (id) => document.getElementById(id);
  const scanBtn = el("scanBtn");
  const cleanBtn = el("cleanBtn");
  const autoStartChk = el("autoStartChk");
  const totalFilesEl = el("totalFiles");
  const totalSizeEl = el("totalSize");
  const progressPctEl = el("progressPct");
  const statusTextEl = el("statusText");
  const fileListEl = el("fileList");
  const listNoteEl = el("listNote");
  const toggleFilesBtn = el("toggleFilesBtn");
  const busyMessageEl = el("busyMessage");
  const impactTotalCleanedEl = el("impactTotalCleaned");
  const impactRunsEl = el("impactRuns");
  const impactAvgTimeEl = el("impactAvgTime");
  const impactSpeedGainEl = el("impactSpeedGain");
  const dashboardCardEl = el("dashboardCard");
  const sysDeviceEl = el("sysDevice");
  const startupSection = el("startupSection");
  const startupListEl = el("startupList");
  const startupRefreshBtn = el("startupRefreshBtn");
  const startupStatusEl = el("startupStatusEl");
  const sysOsEl = el("sysOs");
  const sysCpuEl = el("sysCpu");
  const sysRamEl = el("sysRam");
  const sysFreeEl = el("sysFree");
  const optJunkRemovedEl = el("optJunkRemoved");
  const optStatusEl = el("optStatus");
  const trustedCountEl = el("trustedCount");
  const trustedBadgeEl = el("trustedBadge");
  const proBadge = el("proBadge");
  const autoStartContainer = el("autoStartContainer");
  const progressBarEl = el("progressBar");

  const techInternetBtn = el("techInternetBtn");
  const techRamBtn = el("techRamBtn");
  const techAutoBtn = el("techAutoBtn");
  const techFullBtn = el("techFullBtn");

  // ── constants ──────────────────────────────────────────────────────────────
  const MAX_LIST_ROWS = 2000;
  const VISIBLE_ROWS = 100;

  // ── in-memory state ONLY — zero localStorage / zero file cache ─────────────
  let scanning = false;
  let cleaning = false;
  let showAllFiles = false;
  let lastFiles = [];

  // ── RAF paint scheduler ────────────────────────────────────────────────────
  let pendingProgress = null;
  let rafId = 0;
  let lastPaintTs = 0;

  function schedulePaint(p) {
    pendingProgress = p;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const now = Date.now();
      if (now - lastPaintTs < 80) setTimeout(flushPaint, 80 - (now - lastPaintTs));
      else flushPaint();
    });
  }

  function flushPaint() {
    const p = pendingProgress;
    if (!p) return;
    pendingProgress = null;
    lastPaintTs = Date.now();
    setTotals(p.totalFiles, p.totalBytes);
    setProgress(p.percent);
    if (Array.isArray(p.newFiles) && p.newFiles.length) appendToList(p.newFiles);
    if (p.totalFiles > MAX_LIST_ROWS && listNoteEl)
      listNoteEl.textContent = `Showing first ${MAX_LIST_ROWS}. ${p.totalFiles - MAX_LIST_ROWS} more…`;
  }

  function cancelPendingProgressPaint() {
    pendingProgress = null;
    if (rafId) {
      try { cancelAnimationFrame(rafId); } catch (_) {}
      rafId = 0;
    }
  }

  // ── formatting helpers ─────────────────────────────────────────────────────
  const UNITS = ["B", "KB", "MB", "GB", "TB"];
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "0 B";
    const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
    const val = n / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${UNITS[i]}`;
  }

  function formatDuration(ms) {
    const n = Math.max(0, ms | 0);
    if (n < 1000) return "0s";
    const s = Math.round(n / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  // ── DOM setters ────────────────────────────────────────────────────────────
  function setStatus(t) { if (statusTextEl) statusTextEl.textContent = t || ""; }
  function setOptStatus(t) { if (optStatusEl) optStatusEl.textContent = t || "Idle"; }
  function pingMetric(el) {
    if (!el) return;
    const parent = el.closest(".metric");
    if (!parent) return;
    parent.classList.remove("updated");
    void parent.offsetWidth; // trigger reflow
    parent.classList.add("updated");
    setTimeout(() => parent.classList.remove("updated"), 400);
  }

  function setTotals(f, b) {
    if (totalFilesEl) { totalFilesEl.textContent = String(f | 0); pingMetric(totalFilesEl); }
    if (totalSizeEl) { totalSizeEl.textContent = formatBytes(b); pingMetric(totalSizeEl); }
  }
  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct | 0));
    if (progressPctEl) {
      progressPctEl.textContent = `${clamped}%`;
      if (pct % 10 === 0) pingMetric(progressPctEl); // Ping every 10% to avoid too much flickering
    }
    if (progressBarEl) progressBarEl.style.width = `${clamped}%`;
  }
  function setButtons() {
    const noFiles = (totalFilesEl ? Number(totalFilesEl.textContent) : 0) <= 0;
    scanBtn.disabled = scanning || cleaning;
    cleanBtn.disabled = scanning || cleaning || noFiles;
  }
  function setBusy(active, msg) {
    document.body.classList.toggle("busy", !!active);
    if (busyMessageEl && msg) busyMessageEl.textContent = msg;
    if (active) setOptStatus("Cleaning…");
  }
  function showFirstRun(show) {
    if (dashboardCardEl) dashboardCardEl.classList.toggle("hidden", false);
  }
  // "win32 10.0.22631" -> "Windows 11 (build 22631)"
  function friendlyOs(os) {
    const m = /^win32 10\.0\.(\d+)/i.exec(String(os || ""));
    if (!m) return os || "-";
    const build = Number(m[1]);
    return `Windows ${build >= 22000 ? 11 : 10} (build ${build})`;
  }

  function updateSystemDashboard(s) {
    if (!s) return;
    if (sysDeviceEl) sysDeviceEl.textContent = s.device || "-";
    if (sysOsEl) sysOsEl.textContent = friendlyOs(s.os);
    if (sysCpuEl) sysCpuEl.textContent = s.cpu || "-";
    if (sysRamEl) sysRamEl.textContent = s.ram ? `${s.ram} GB` : "-";
    if (sysFreeEl) sysFreeEl.textContent = s.free ? `${s.free} GB` : "-";
  }

  function updateImpactCards(s) {
    if (!s) return;
    if (impactTotalCleanedEl) impactTotalCleanedEl.textContent = formatBytes(s.totalBytesFreed || 0);
    if (optJunkRemovedEl) optJunkRemovedEl.textContent = formatBytes(s.totalBytesFreed || 0);
    if (impactRunsEl) impactRunsEl.textContent = String(s.totalRuns || 0);
    if (impactAvgTimeEl) impactAvgTimeEl.textContent = formatDuration(s.avgDurationMs || 0);
    if (impactSpeedGainEl)
      impactSpeedGainEl.textContent = `${Math.max(0, Math.min(100, s.estimatedSpeedBoostPercent | 0))}%`;
  }

  // ── file list ──────────────────────────────────────────────────────────────
  function clearList() {
    lastFiles = [];
    if (fileListEl) fileListEl.textContent = "";
    if (listNoteEl) listNoteEl.textContent = "";
    showAllFiles = false;
    if (toggleFilesBtn) toggleFilesBtn.style.display = "none";
  }

  function renderList() {
    if (!fileListEl) return;
    const visible = showAllFiles ? lastFiles : lastFiles.slice(0, VISIBLE_ROWS);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < visible.length; i++) {
      const row = document.createElement("div");
      row.className = "fileRow";
      row.textContent = visible[i];
      frag.appendChild(row);
    }
    fileListEl.textContent = "";
    fileListEl.appendChild(frag);
    if (toggleFilesBtn) {
      toggleFilesBtn.textContent = showAllFiles ? "Show Less" : "Show All";
      toggleFilesBtn.style.display = lastFiles.length > VISIBLE_ROWS ? "inline-block" : "none";
    }
  }

  function appendToList(paths) {
    if (!paths || !paths.length) return;
    const space = MAX_LIST_ROWS - lastFiles.length;
    if (space <= 0) return;
    const count = Math.min(paths.length, space);
    for (let i = 0; i < count; i++) lastFiles.push(paths[i]);
    renderList();
  }

  // ── analytics — fire-and-forget, NO queue, NO storage ────────────────────
  function track(payload) {
    if (!payload) return;
    // Always force:true so throttle is bypassed for user-triggered events
    window.api.trackEvent({ ...payload, force: true }).catch(() => { });
  }

  function trackActivity(action, extra) {
    const note = [action, extra].filter(Boolean).join(" | ").slice(0, 64);
    track({ event: "activity", name: "System User", phone: "unknown", junk: note || "activity" });
  }


  // ── auto-start ─────────────────────────────────────────────────────────────
  async function refreshAutoStart() {
    try { autoStartChk.checked = !!((await window.api.getAutoStart()).enabled); }
    catch (_) { autoStartChk.checked = false; }
  }

  // ── bootstrap — always shows dashboard ───────────
  async function bootstrap() {
    // Always show dashboard
    showFirstRun(false);

    window.api.getSystemInfo().then(r => {
      if (r && r.ok) {
        updateSystemDashboard(r.system);
      }
    }).catch(() => { });
  }

  // ── event listeners ────────────────────────────────────────────────────────

  scanBtn.addEventListener("click", async () => {
    if (scanning) return;
    scanning = true;
    setButtons();
    clearList();
    setTotals(0, 0);
    setProgress(0);
    setStatus("Scanning…");
    trackActivity("scan_start");
    try {
      await window.api.scanStart();
    } catch (_) {
      setStatus("Scan failed.");
      scanning = false;
      setButtons();
      trackActivity("scan_failed");
    }
  });

  cleanBtn.addEventListener("click", async () => {
    if (scanning || cleaning) return;
    cleaning = true;
    setButtons();
    setStatus("Preparing to clean…");
    setBusy(true, "Cleaning files… Please wait.");
    trackActivity("clean_start");
    try {
      // No retry targets from storage — always clean fresh scan results only
      const result = await window.api.cleanStart({ files: [], directories: [] });
      if (result && result.cancelled) {
        cleaning = false;
        setBusy(false);
        setButtons();
        trackActivity("clean_cancelled");
      }
    } catch (_) {
      cleaning = false;
      setBusy(false);
      setButtons();
      setStatus("Cleaning failed.");
      trackActivity("clean_failed");
    }
  });

  if (toggleFilesBtn) toggleFilesBtn.addEventListener("click", () => {
    showAllFiles = !showAllFiles;
    renderList();
  });


  autoStartChk.addEventListener("change", async () => {
    const desired = !!autoStartChk.checked;
    setStatus("Updating startup setting…");
    try {
      const r = await window.api.setAutoStart(desired);
      if (!r || !r.ok) { autoStartChk.checked = !desired; setStatus("Failed to update startup setting."); return; }
      setStatus("Startup setting updated.");
      trackActivity(desired ? "autostart_on" : "autostart_off");
    } catch (_) {
      autoStartChk.checked = !desired;
      setStatus("Failed to update startup setting.");
    }
  });

  // ── technician listeners ───────────────────────────────────────────────────
  function setTechBusy(busy) {
    [techInternetBtn, techRamBtn, techAutoBtn, techFullBtn].forEach(b => { if (b) b.disabled = busy; });
  }

  async function runTechTool(name, fn, progId) {
    if (scanning || cleaning) return;
    const progEl = el(progId);
    setTechBusy(true);
    setBusy(true, `${name} in progress…`);
    setStatus(`Running ${name}…`);
    if (progEl) { progEl.textContent = "Processing..."; progEl.style.color = "var(--accent-warning)"; }
    trackActivity(`tech_${name.toLowerCase().replace(/ /g, "_")}_start`);
    try {
      const r = await fn();
      if (r && r.ok) {
        setStatus(`${name} complete.`);
        if (progEl) {
          let msg = "✔ Completed";
          if (name === "Internet Fix") msg = `✔ Reset ${r.successCount || 0}/${r.total || 5} network components`;
          if (name === "RAM Boost") msg = `✔ Freed ${formatBytes(r.freedBytes || 0)} of RAM`;
          if (name === "Auto Fix") msg = "✔ Services & Caches Repaired";
          progEl.textContent = msg;
          progEl.style.color = "var(--accent-primary)";
        }
        trackActivity(`tech_${name.toLowerCase().replace(/ /g, "_")}_ok`);
      } else {
        setStatus(`${name} failed.`);
        if (progEl) { progEl.textContent = "✖ Failed"; progEl.style.color = "var(--accent-danger)"; }
        trackActivity(`tech_${name.toLowerCase().replace(/ /g, "_")}_failed`);
      }
    } catch (e) {
      setStatus(`${name} failed.`);
      if (progEl) { progEl.textContent = "✖ Error"; progEl.style.color = "var(--accent-danger)"; }
    } finally {
      setTechBusy(false);
      setBusy(false);
      setTimeout(() => { if (progEl && progEl.textContent.includes("✔")) progEl.textContent = ""; }, 4000);
    }
  }

  if (techInternetBtn) techInternetBtn.addEventListener("click", () => runTechTool("Internet Fix", window.api.techInternetFix, "techInternetProg"));
  if (techRamBtn) techRamBtn.addEventListener("click", () => runTechTool("RAM Boost", window.api.techRamBoost, "techRamProg"));
  if (techAutoBtn) techAutoBtn.addEventListener("click", () => runTechTool("Auto Fix", window.api.techAutoFix, "techAutoProg"));

  if (techFullBtn) techFullBtn.addEventListener("click", async () => {
    if (scanning || cleaning) return;
    const progEl = el("techFullProg");
    setTechBusy(true);
    setBusy(true, "Full Service in progress… This may take a moment.");
    setStatus("Running Full Service…");
    if (progEl) { progEl.textContent = "Starting..."; progEl.style.color = "var(--accent-warning)"; }
    trackActivity("tech_full_service_start");
    try {
      if (progEl) progEl.textContent = "Fixing internet connection...";
      const resInt = await window.api.techInternetFix();
      if (progEl) progEl.textContent = "Speeding up memory...";
      const resRam = await window.api.techRamBoost();
      if (progEl) progEl.textContent = "Repairing background issues...";
      const resAuto = await window.api.techAutoFix();
      setStatus("Full Service complete.");
      if (progEl) {
        progEl.textContent = `✔ Freed ${formatBytes(resRam.freedBytes || 0)} RAM & Fixed ${resInt.successCount || 0} Network Issues`;
        progEl.style.color = "var(--accent-primary)";
      }
      trackActivity("tech_full_service_ok");
    } catch (e) {
      setStatus("Full Service failed.");
      if (progEl) { progEl.textContent = "✖ Failed during execution"; progEl.style.color = "var(--accent-danger)"; }
    } finally {
      setTechBusy(false);
      setBusy(false);
      setTimeout(() => { if (progEl && progEl.textContent.includes("✔")) progEl.textContent = ""; }, 5000);
    }
  });

  // ── IPC handlers ───────────────────────────────────────────────────────────


  window.api.onStatus((p) => setStatus(p && p.text ? p.text : ""));

  window.api.onScanReset(() => {
    scanning = true;
    setButtons();
    clearList();
    setTotals(0, 0);
    setProgress(0);
  });

  window.api.onScanProgress(schedulePaint);

  window.api.onScanDone((p) => {
    cancelPendingProgressPaint();
    scanning = false;
    if (p && p.ok) {
      setTotals(p.totalFiles, p.totalBytes);
      setProgress(100);
      clearList();
      appendToList(p.allFiles || []);
      if ((p.totalFiles || 0) > MAX_LIST_ROWS && listNoteEl)
        listNoteEl.textContent = `Showing first ${MAX_LIST_ROWS}. ${p.totalFiles - MAX_LIST_ROWS} more…`;
    }
    setButtons();
    trackActivity(p && p.ok ? "scan_ok" : "scan_err", p && p.ok ? `${p.totalFiles | 0} files` : "");
  });

  window.api.onTechProgress((p) => {
    if (p && p.id && p.msg) {
      const progEl = el(p.id);
      if (progEl) {
        progEl.textContent = p.msg;
        progEl.style.color = "var(--accent-warning)";
      }
    }
  });

  window.api.onCleanDone((p) => {
    cleaning = false;
    setBusy(false);
    if (!p || !p.ok) { setButtons(); return; }

    clearList();
    setTotals((p.remainingFiles || []).length, p.remainingBytes || 0);
    setProgress(0);

    if (listNoteEl) {
      listNoteEl.textContent = "Cleanup complete.";
    }
    if (toggleFilesBtn) toggleFilesBtn.style.display = "none";
    if (p.stats) updateImpactCards(p.stats);

    track({ event: "cleanup_done", name: "System User", phone: "unknown", junk: formatBytes(p.freedBytes || 0) });
    trackActivity("clean_ok", formatBytes(p.freedBytes || 0));
    setOptStatus("Improved");
    setButtons();
  });

  window.api.onStatsUpdate(updateImpactCards);

  // ── Auto-update UI ──────────────────────────────────────────────
  const updateBannerEl = el("updateBanner");
  const updateMsgEl = el("updateMsg");
  const updatePctEl = el("updatePct");
  const updateBtnEl = el("updateBtn");

  function showBanner(msg, pct, showBtn) {
    if (updateMsgEl) updateMsgEl.textContent = msg || "";
    if (updatePctEl) updatePctEl.textContent = pct != null ? `${pct}%` : "";
    if (updateBtnEl) updateBtnEl.style.display = showBtn ? "inline-block" : "none";
    if (updateBannerEl) updateBannerEl.classList.add("visible");
  }

  if (window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable((info) => {
      showBanner(`Update v${info.version} found. Downloading…`, null, false);
    });
  }

  if (window.api.onUpdateProgress) {
    window.api.onUpdateProgress((p) => {
      showBanner(`Downloading update…`, p.percent, false);
    });
  }

  if (window.api.onUpdateDownloaded) {
    window.api.onUpdateDownloaded((info) => {
      // Show "Restarting…" — the app will auto-quit in 3 seconds (handled by updater.js)
      showBanner(`Update v${info.version} downloaded, restarting automatically…`, null, false);
    });
  }

  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus((s) => {
      if (s.phase === "error") {
        // Show error briefly, then hide after 10 seconds
        showBanner(`Update failed: ${s.error}`, null, false);
        setTimeout(() => {
          if (updateBannerEl) updateBannerEl.classList.remove("visible");
        }, 5000);
      } else if (s.phase === "latest") {
        // No update available — hide banner silently
        if (updateBannerEl) updateBannerEl.classList.remove("visible");
      } else if (s.phase === "checking") {
        // Don't show anything for background checks
      }
    });
  }

  if (updateBtnEl) {
    updateBtnEl.addEventListener("click", () => {
      updateBtnEl.textContent = "Restarting…";
      updateBtnEl.disabled = true;
      window.api.updateInstall().catch(() => { });
    });
  }

  // ── Startup Programs Panel ──────────────────────────────────────────────────
  let startupItems = [];
  let startupLoading = false;

  // Plain-language names for where a startup entry lives (sources from main.js)
  const SOURCE_LABELS = {
    "HKCU Run": "This user",
    "HKCU RunOnce": "This user, runs once",
    "HKLM Run": "All users",
    "HKLM RunOnce": "All users, runs once",
    "HKLM32 Run": "All users (32-bit)",
    "HKCU Policies": "Set by policy",
    "HKLM Policies": "Set by policy",
    "Startup Folder": "Startup folder",
    "Common Startup": "Startup folder, all users",
  };

  function setStartupStatus(msg) {
    if (startupStatusEl) startupStatusEl.textContent = msg || "";
  }

  function replaceStartupContent(node) {
    if (!startupListEl) return;
    startupListEl.textContent = "";
    if (node) startupListEl.appendChild(node);
  }
  function setStartupMessage(message) {
    const node = document.createElement("div");
    node.className = "startupEmpty";
    node.textContent = message;
    replaceStartupContent(node);
  }

  function renderStartupList() {
    if (!startupListEl) return;
    if (!startupItems.length) {
      setStartupMessage("No startup programs found.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of startupItems) {
      const row = document.createElement("div");
      row.className = "startupRow";
      row.dataset.id = item.id;

      const icon = document.createElement("div");
      icon.className = "startupIcon";
      icon.textContent = (item.name.trim()[0] || "?").toUpperCase();

      const info = document.createElement("div");
      info.className = "startupInfo";

      const nameEl = document.createElement("div");
      nameEl.className = "startupName";
      nameEl.textContent = item.name;
      nameEl.title = item.name;

      const cmdEl = document.createElement("div");
      cmdEl.className = "startupCmd";
      cmdEl.textContent = item.command;
      cmdEl.title = item.command;

      const meta = document.createElement("div");
      meta.className = "startupMeta";

      const hiveEl = document.createElement("span");
      const source = item.source || item.hive || "";
      hiveEl.className = "startupHive";
      hiveEl.textContent = SOURCE_LABELS[source] || source;
      hiveEl.title = item.registryKey || source;

      meta.appendChild(hiveEl);

      info.appendChild(nameEl);
      info.appendChild(cmdEl);
      info.appendChild(meta);

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "startupToggle";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = item.enabled;
      chk.disabled = !item.canToggle;
      chk.setAttribute("aria-label", `Start ${item.name} with Windows`);
      if (!item.canToggle) toggleLabel.title = "This entry can't be turned off from here.";

      toggleLabel.appendChild(chk);

      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(toggleLabel);

      // Toggle event
      if (item.canToggle) chk.addEventListener("change", async () => {
        const wantEnable = chk.checked;
        chk.disabled = true;
        setStartupStatus(wantEnable ? `Enabling "${item.name}"…` : `Disabling "${item.name}"…`);
        try {
          const r = await window.api.setStartupEnabled(item.name, item.approvedKey, item.regFlag, wantEnable);
          if (r && r.ok) {
            item.enabled = wantEnable;
            chk.title = wantEnable ? "Click to disable" : "Click to enable";
            setStartupStatus(wantEnable ? `✔ "${item.name}" enabled.` : `✔ "${item.name}" disabled.`);
          } else {
            chk.checked = !wantEnable; // rollback
            setStartupStatus(`⚠ Failed: ${r && r.error ? r.error : "Unknown error"}`);
          }
        } catch (err) {
          chk.checked = !wantEnable;
          setStartupStatus(`⚠ Error: ${err && err.message ? err.message : String(err)}`);
        } finally {
          chk.disabled = !item.canToggle;
        }
      });

      frag.appendChild(row);
    }
    replaceStartupContent(frag);
  }

  async function loadStartupPrograms() {
    if (startupLoading) return;
    startupLoading = true;
    setStartupStatus("Loading startup programs…");
    if (startupListEl) setStartupMessage("Loading…");
    try {
      const r = await window.api.getStartupList();
      if (r && r.ok) {
        startupItems = Array.isArray(r.items) ? r.items : [];
        renderStartupList();
        setStartupStatus(`${startupItems.length} startup program(s) found.`);
      } else {
        startupItems = [];
        if (startupListEl) setStartupMessage("Failed to load startup programs.");
        setStartupStatus(r && r.error ? `Error: ${r.error}` : "Failed to load.");
      }
    } catch (err) {
      if (startupListEl) setStartupMessage("Error loading startup programs.");
      setStartupStatus(`Error: ${err && err.message ? err.message : String(err)}`);
    } finally {
      startupLoading = false;
    }
  }

  if (startupRefreshBtn) {
    startupRefreshBtn.addEventListener("click", () => {
      loadStartupPrograms();
    });
  }

  // ── Large files ─────────────────────────────────────────────────────────────
  const largeRootEl = el("largeRoot");
  const largeMinEl = el("largeMin");
  const largeScanBtn = el("largeScanBtn");
  const largeStopBtn = el("largeStopBtn");
  const largeStatusEl = el("largeStatus");
  const largeResultsEl = el("largeResults");
  const largeListEl = el("largeList");
  const largeSelectAllEl = el("largeSelectAll");
  const largeSelInfoEl = el("largeSelInfo");
  const largeTrashBtn = el("largeTrashBtn");
  const largeDeleteBtn = el("largeDeleteBtn");

  let largeItems = [];             // { path, name, size, modified }
  const largeSelected = new Set(); // paths
  let largeBusy = false;

  const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  function dirOf(p) { const i = p.lastIndexOf("\\"); return i > 0 ? p.slice(0, i) : p; }

  function setLargeStatus(t) { if (largeStatusEl) largeStatusEl.textContent = t || ""; }

  function updateLargeSelection() {
    let bytes = 0;
    for (const it of largeItems) if (largeSelected.has(it.path)) bytes += it.size;
    const n = largeSelected.size;
    if (largeSelInfoEl) largeSelInfoEl.textContent = n ? `${n} selected · ${formatBytes(bytes)}` : "Nothing selected";
    if (largeTrashBtn) largeTrashBtn.disabled = largeBusy || !n;
    if (largeDeleteBtn) largeDeleteBtn.disabled = largeBusy || !n;
    if (largeSelectAllEl) {
      largeSelectAllEl.checked = n > 0 && n === largeItems.length;
      largeSelectAllEl.indeterminate = n > 0 && n < largeItems.length;
    }
  }

  function renderLargeList() {
    if (!largeListEl) return;
    if (largeResultsEl) largeResultsEl.hidden = false;
    largeListEl.textContent = "";
    if (!largeItems.length) {
      const empty = document.createElement("div");
      empty.className = "largeEmpty";
      empty.textContent = "No files that big were found here.";
      largeListEl.appendChild(empty);
      updateLargeSelection();
      return;
    }
    const frag = document.createDocumentFragment();
    for (const it of largeItems) {
      const row = document.createElement("div");
      row.className = "largeRow";
      row.dataset.path = it.path;

      const checkWrap = document.createElement("label");
      checkWrap.className = "largeCheck";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = largeSelected.has(it.path);
      chk.setAttribute("aria-label", `Select ${it.name}`);
      checkWrap.appendChild(chk);

      const file = document.createElement("div");
      file.className = "largeFile";
      const name = document.createElement("div");
      name.className = "largeName";
      name.textContent = it.name;
      name.title = it.path;
      const dir = document.createElement("div");
      dir.className = "largeDir";
      dir.textContent = dirOf(it.path);
      dir.title = dirOf(it.path);
      file.appendChild(name);
      file.appendChild(dir);

      const size = document.createElement("div");
      size.className = "largeSize";
      size.textContent = formatBytes(it.size);

      const date = document.createElement("div");
      date.className = "largeDate";
      date.textContent = it.modified ? dateFmt.format(new Date(it.modified)) : "";

      const show = document.createElement("button");
      show.className = "link largeShow";
      show.textContent = "Show in folder";

      row.append(checkWrap, file, size, date, show);
      frag.appendChild(row);
    }
    largeListEl.appendChild(frag);
    updateLargeSelection();
  }

  function setLargeBusy(busy) {
    largeBusy = busy;
    if (largeScanBtn) {
      largeScanBtn.disabled = busy || !largeRootEl || !largeRootEl.value;
      largeScanBtn.style.display = busy ? "none" : "";
    }
    if (largeStopBtn) largeStopBtn.style.display = busy ? "" : "none";
    if (largeRootEl) largeRootEl.disabled = busy || !largeRootEl.options.length;
    if (largeMinEl) largeMinEl.disabled = busy;
    updateLargeSelection();
  }

  async function loadLargeRoots() {
    if (!largeRootEl) return;
    try {
      const r = await window.api.largeRoots();
      const roots = (r && r.ok && Array.isArray(r.roots)) ? r.roots : [];
      largeRootEl.textContent = "";
      for (const root of roots) {
        const opt = document.createElement("option");
        opt.value = root.id;
        opt.textContent = root.kind === "drive" && root.size
          ? `${root.label} (${formatBytes(root.free)} free of ${formatBytes(root.size)})`
          : `${root.label} (${root.path})`;
        largeRootEl.appendChild(opt);
      }
      if (!roots.length) setLargeStatus("Couldn't list your drives.");
    } catch (_) {
      setLargeStatus("Couldn't list your drives.");
    }
    setLargeBusy(false);
  }

  async function runLargeScan() {
    if (largeBusy || !largeRootEl || !largeRootEl.value) return;
    largeItems = [];
    largeSelected.clear();
    if (largeResultsEl) largeResultsEl.hidden = true;
    setLargeBusy(true);
    setLargeStatus("Searching…");
    trackActivity("large_scan_start");
    try {
      const r = await window.api.largeScan(largeRootEl.value, Number(largeMinEl ? largeMinEl.value : 104857600));
      if (!r || !r.ok) {
        setLargeStatus(r && r.error ? r.error : "Search failed.");
        return;
      }
      largeItems = Array.isArray(r.items) ? r.items : [];
      const shown = largeItems.length < (r.found || 0) ? ` Showing the ${largeItems.length} biggest.` : "";
      setLargeStatus(`${r.cancelled ? "Stopped. " : ""}Checked ${Number(r.scannedFiles || 0).toLocaleString()} files, found ${r.found || 0}.${shown}`);
      renderLargeList();
      trackActivity("large_scan_ok", `${r.found || 0} files`);
    } catch (_) {
      setLargeStatus("Search failed.");
    } finally {
      setLargeBusy(false);
    }
  }

  async function removeSelectedLarge(permanent) {
    if (largeBusy || !largeSelected.size) return;
    const paths = largeItems.filter((it) => largeSelected.has(it.path)).map((it) => it.path);
    setLargeBusy(true);
    try {
      const r = await window.api.largeDelete(paths, permanent);
      if (!r || r.cancelled) return;
      if (!r.ok) { setLargeStatus(r.error || "Couldn't remove the files."); return; }
      const removed = new Set(r.removed || []);
      largeItems = largeItems.filter((it) => !removed.has(it.path));
      for (const p of removed) largeSelected.delete(p);
      let msg = `${permanent ? "Deleted" : "Moved to the Recycle Bin"}: ${removed.size} file(s), ${formatBytes(r.removedBytes || 0)}.`;
      if (r.failed && r.failed.length) msg += ` ${r.failed.length} couldn't be removed (${r.failed[0].error}).`;
      setLargeStatus(msg);
      renderLargeList();
      trackActivity(permanent ? "large_delete" : "large_trash", formatBytes(r.removedBytes || 0));
    } catch (_) {
      setLargeStatus("Couldn't remove the files.");
    } finally {
      setLargeBusy(false);
    }
  }

  function initLargeFiles() {
    if (!window.api.largeRoots || !largeRootEl) {
      const section = el("largeSection");
      if (section) section.hidden = true;
      return;
    }
    if (largeScanBtn) largeScanBtn.addEventListener("click", runLargeScan);
    if (largeStopBtn) largeStopBtn.addEventListener("click", () => {
      setLargeStatus("Stopping…");
      window.api.largeCancel().catch(() => { });
    });
    if (largeTrashBtn) largeTrashBtn.addEventListener("click", () => removeSelectedLarge(false));
    if (largeDeleteBtn) largeDeleteBtn.addEventListener("click", () => removeSelectedLarge(true));
    if (largeSelectAllEl) largeSelectAllEl.addEventListener("change", () => {
      largeSelected.clear();
      if (largeSelectAllEl.checked) for (const it of largeItems) largeSelected.add(it.path);
      renderLargeList();
    });
    if (largeListEl) {
      largeListEl.addEventListener("change", (e) => {
        const row = e.target.closest(".largeRow");
        if (!row || e.target.type !== "checkbox") return;
        if (e.target.checked) largeSelected.add(row.dataset.path);
        else largeSelected.delete(row.dataset.path);
        updateLargeSelection();
      });
      largeListEl.addEventListener("click", (e) => {
        if (!e.target.classList.contains("largeShow")) return;
        const row = e.target.closest(".largeRow");
        if (row) window.api.largeReveal(row.dataset.path).catch(() => { });
      });
    }
    if (window.api.onLargeProgress) window.api.onLargeProgress((p) => {
      if (!largeBusy || !p) return;
      setLargeStatus(`Searching… ${Number(p.scannedFiles || 0).toLocaleString()} files checked, ${p.found || 0} found`);
    });
    loadLargeRoots();
  }

  // ── init ───────────────────────────────────────────────────────────────────
  function init() {
    setButtons();
    setBusy(false);
    bootstrap();
    refreshAutoStart();
    loadStartupPrograms(); // Auto-load on init
    initLargeFiles();

    // Stats from main process (in-memory, no file read needed now)
    window.api.getStats().then(r => { if (r && r.ok && r.stats) updateImpactCards(r.stats); }).catch(() => { });

    // User count badge (100% Real Count, Fast Frontend Fetch with Local Cache)
    let currentDisplayCount = 0;
    const cachedCountStr = localStorage.getItem("xcore_user_count");
    let cachedCount = cachedCountStr ? parseInt(cachedCountStr, 10) : 0;

    if (trustedBadgeEl) {
      trustedBadgeEl.style.display = "flex"; // Ensure it's always visible
      trustedBadgeEl.classList.add("visible");
      if (trustedCountEl) {
        if (cachedCount > 0) {
          // Immediately display cached number for zero latency UI
          trustedCountEl.textContent = `${cachedCount.toLocaleString()}+ Users`;
          currentDisplayCount = cachedCount;
        } else {
          trustedCountEl.textContent = "0+ Users";
        }
      }
    }

    function animateCount(target, startFrom = 0) {
      if (!trustedCountEl || target <= startFrom) return;
      const duration = 2000; // 2 seconds animation
      const startTime = performance.now();
      const diff = target - startFrom;

      function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // easeOutExpo for a fast start and slow, smooth finish
        const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const currentCount = Math.floor(startFrom + (diff * easeOut));

        trustedCountEl.textContent = `${currentCount.toLocaleString()}+ Users`;

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          trustedCountEl.textContent = `${target.toLocaleString()}+ Users`;
          currentDisplayCount = target;
        }
      }
      requestAnimationFrame(update);
    }

    // Direct CDN-like Frontend Fetch for maximum speed
    const trackingUrl = "https://script.google.com/macros/s/AKfycbyrao1GQrhzYsO9PE3yzdzgj7T3QbaiT8V06fELWqGFWkIqEqwwqKTbgIT3khlmP0n0/exec?type=count";

    fetch(trackingUrl, { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (data && data.total > currentDisplayCount) {
          // Update cache and animate up from the current display count
          localStorage.setItem("xcore_user_count", data.total.toString());
          animateCount(data.total, currentDisplayCount);
        }
      })
      .catch(() => {
        // Fallback to IPC if direct frontend fetch is blocked by CORS/network
        window.api.getCounts().then(r => {
          if (r && r.ok && r.total > currentDisplayCount) {
            localStorage.setItem("xcore_user_count", r.total.toString());
            animateCount(r.total, currentDisplayCount);
          }
        }).catch(() => { });
      });

    setStatus("Idle.");
    setOptStatus("Idle");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();

