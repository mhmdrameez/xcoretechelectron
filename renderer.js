"use strict";
(function () {

  // ── element cache ──────────────────────────────────────────────────────────
  const el  = (id) => document.getElementById(id);
  const scanBtn            = el("scanBtn");
  const cleanBtn           = el("cleanBtn");
  const autoStartChk       = el("autoStartChk");
  const totalFilesEl       = el("totalFiles");
  const totalSizeEl        = el("totalSize");
  const progressPctEl      = el("progressPct");
  const statusTextEl       = el("statusText");
  const fileListEl         = el("fileList");
  const listNoteEl         = el("listNote");
  const toggleFilesBtn     = el("toggleFilesBtn");
  const busyMessageEl      = el("busyMessage");
  const impactTotalCleanedEl = el("impactTotalCleaned");
  const impactRunsEl       = el("impactRuns");
  const impactAvgTimeEl    = el("impactAvgTime");
  const impactSpeedGainEl  = el("impactSpeedGain");
  const firstRunCardEl     = el("firstRunCard");
  const dashboardCardEl    = el("dashboardCard");
  const customerNameInput  = el("customerNameInput");
  const customerPhoneInput = el("customerPhoneInput");
  const saveCustomerBtn    = el("saveCustomerBtn");
  const profileStatusEl    = el("profileStatus");
  const sysDeviceEl        = el("sysDevice");
  const sysOsEl            = el("sysOs");
  const sysCpuEl           = el("sysCpu");
  const sysRamEl           = el("sysRam");
  const sysFreeEl          = el("sysFree");
  const optJunkRemovedEl   = el("optJunkRemoved");
  const optStatusEl        = el("optStatus");
  const trustedCountEl     = el("trustedCount");
  const trustedBadgeEl     = el("trustedBadge");

  // ── constants ──────────────────────────────────────────────────────────────
  const MAX_LIST_ROWS = 2000;
  const VISIBLE_ROWS  = 100;

  // ── in-memory state ONLY — zero localStorage / zero file cache ─────────────
  let scanning      = false;
  let cleaning      = false;
  let showAllFiles  = false;
  let lastFiles     = [];

  // Profile lives in memory for the current session only
  let sessionProfile = { name: "", phone: "" };

  function readProfile()              { return sessionProfile; }
  function setProfile(name, phone)    { sessionProfile = { name: String(name||"").trim(), phone: String(phone||"").trim() }; }

  // ── RAF paint scheduler ────────────────────────────────────────────────────
  let pendingProgress = null;
  let rafId           = 0;
  let lastPaintTs     = 0;

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

  // ── formatting helpers ─────────────────────────────────────────────────────
  const UNITS = ["B", "KB", "MB", "GB", "TB"];
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "0 B";
    const i   = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
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
  function setStatus(t)        { if (statusTextEl)    statusTextEl.textContent    = t || ""; }
  function setOptStatus(t)     { if (optStatusEl)     optStatusEl.textContent     = t || "Idle"; }
  function setProfileStatus(t) { if (profileStatusEl) profileStatusEl.textContent = t || ""; }
  function setTotals(f, b) {
    if (totalFilesEl) totalFilesEl.textContent = String(f | 0);
    if (totalSizeEl)  totalSizeEl.textContent  = formatBytes(b);
  }
  function setProgress(pct) {
    if (progressPctEl) progressPctEl.textContent = `${Math.max(0, Math.min(100, pct | 0))}%`;
  }
  function setButtons() {
    const noFiles = (totalFilesEl ? Number(totalFilesEl.textContent) : 0) <= 0;
    scanBtn.disabled  = scanning || cleaning;
    cleanBtn.disabled = scanning || cleaning || noFiles;
  }
  function setBusy(active, msg) {
    document.body.classList.toggle("busy", !!active);
    if (busyMessageEl && msg) busyMessageEl.textContent = msg;
    if (active) setOptStatus("Cleaning…");
  }
  function showFirstRun(show) {
    if (firstRunCardEl)  firstRunCardEl.classList.toggle("hidden",  !show);
    if (dashboardCardEl) dashboardCardEl.classList.toggle("hidden",   show);
  }
  function updateSystemDashboard(s) {
    if (!s) return;
    if (sysDeviceEl) sysDeviceEl.textContent = s.device || "-";
    if (sysOsEl)     sysOsEl.textContent     = s.os     || "-";
    if (sysCpuEl)    sysCpuEl.textContent    = s.cpu    || "-";
    if (sysRamEl)    sysRamEl.textContent    = s.ram    ? `${s.ram} GB` : "-";
    if (sysFreeEl)   sysFreeEl.textContent   = s.free   ? `${s.free} GB` : "-";
  }
  function updateImpactCards(s) {
    if (!s) return;
    if (impactTotalCleanedEl) impactTotalCleanedEl.textContent = formatBytes(s.totalBytesFreed || 0);
    if (optJunkRemovedEl)     optJunkRemovedEl.textContent     = formatBytes(s.totalBytesFreed || 0);
    if (impactRunsEl)         impactRunsEl.textContent         = String(s.totalRuns || 0);
    if (impactAvgTimeEl)      impactAvgTimeEl.textContent      = formatDuration(s.avgDurationMs || 0);
    if (impactSpeedGainEl)
      impactSpeedGainEl.textContent = `${Math.max(0, Math.min(100, s.estimatedSpeedBoostPercent | 0))}%`;
  }

  // ── file list ──────────────────────────────────────────────────────────────
  function clearList() {
    lastFiles = [];
    if (fileListEl)     fileListEl.textContent = "";
    if (listNoteEl)     listNoteEl.textContent = "";
    showAllFiles = false;
    if (toggleFilesBtn) toggleFilesBtn.style.display = "none";
  }

  function renderList() {
    if (!fileListEl) return;
    const visible = showAllFiles ? lastFiles : lastFiles.slice(0, VISIBLE_ROWS);
    const frag    = document.createDocumentFragment();
    for (let i = 0; i < visible.length; i++) {
      const row       = document.createElement("div");
      row.className   = "fileRow";
      row.textContent = visible[i];
      frag.appendChild(row);
    }
    fileListEl.textContent = "";
    fileListEl.appendChild(frag);
    if (toggleFilesBtn) {
      toggleFilesBtn.textContent   = showAllFiles ? "Show Less" : "Show All";
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
    window.api.trackEvent({ ...payload, force: true }).catch(() => {});
  }

  function trackActivity(action, extra) {
    const p    = readProfile();
    const note = [action, extra].filter(Boolean).join(" | ").slice(0, 18);
    track({ event: "activity", name: p.name || "unknown", phone: p.phone || "unknown", junk: note || "activity" });
  }

  // ── auto-start ─────────────────────────────────────────────────────────────
  async function refreshAutoStart() {
    try { autoStartChk.checked = !!((await window.api.getAutoStart()).enabled); }
    catch (_) { autoStartChk.checked = false; }
  }

  // ── bootstrap — always shows first-run (no persistent profile) ───────────
  function bootstrap() {
    // No stored profile — always start fresh, show first-run card
    showFirstRun(true);
    window.api.getSystemInfo().then(r => { if (r && r.ok) updateSystemDashboard(r.system); }).catch(() => {});
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

  if (saveCustomerBtn) saveCustomerBtn.addEventListener("click", () => {
    const name  = String(customerNameInput  ? customerNameInput.value  : "").trim();
    const phone = String(customerPhoneInput ? customerPhoneInput.value : "").trim();
    if (!name || !phone) { setProfileStatus("Please enter name and phone."); return; }
    setProfile(name, phone);
    setProfileStatus("Saved.");
    showFirstRun(false);
    track({ event: "app_open", name, phone, junk: "0" });
    window.api.getSystemInfo().then(r => { if (r && r.ok) updateSystemDashboard(r.system); }).catch(() => {});
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

    const profile = readProfile();
    track({ event: "cleanup_done", name: profile.name, phone: profile.phone, junk: formatBytes(p.freedBytes || 0) });
    trackActivity("clean_ok", formatBytes(p.freedBytes || 0));
    setOptStatus("Improved");
    setButtons();
  });

  window.api.onStatsUpdate(updateImpactCards);

  // ── Auto-update UI ──────────────────────────────────────────────
  const updateBannerEl = el("updateBanner");
  const updateMsgEl    = el("updateMsg");
  const updatePctEl    = el("updatePct");
  const updateBtnEl    = el("updateBtn");

  function showBanner(msg, pct, showBtn) {
    if (updateMsgEl)    updateMsgEl.textContent  = msg || "";
    if (updatePctEl)    updatePctEl.textContent  = pct  != null ? `${pct}%` : "";
    if (updateBtnEl)    updateBtnEl.style.display = showBtn ? "inline-block" : "none";
    if (updateBannerEl) updateBannerEl.classList.add("visible");
  }

  if (window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable((info) => {
      showBanner(`🔄 Update v${info.version} found — downloading…`, null, false);
    });
  }

  if (window.api.onUpdateProgress) {
    window.api.onUpdateProgress((p) => {
      showBanner(`⬇️ Downloading update…`, p.percent, false);
    });
  }

  if (window.api.onUpdateDownloaded) {
    window.api.onUpdateDownloaded((info) => {
      showBanner(`✅ v${info.version} ready — restart to apply`, null, true);
    });
  }

  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus((s) => {
      // Only show banner for non-trivial states
      if (s.phase === "error") showBanner("⚠️ Update check failed", null, false);
      // "latest" and "checking" — keep banner hidden
    });
  }

  if (updateBtnEl) {
    updateBtnEl.addEventListener("click", () => {
      updateBtnEl.textContent = "Restarting…";
      updateBtnEl.disabled    = true;
      window.api.updateInstall().catch(() => {});
    });
  }

  // ── Startup Programs Panel ──────────────────────────────────────────────────
  const startupPanelEl       = el("startupPanel");
  const startupToggleHeader  = el("startupToggleHeader");
  const startupListEl        = el("startupList");
  const startupEmptyEl       = el("startupEmpty");
  const startupRefreshBtnEl  = el("startupRefreshBtn");
  const startupStatusEl2     = el("startupStatusEl");

  let startupItems = [];
  let startupLoading = false;

  function setStartupStatus(msg) {
    if (startupStatusEl2) startupStatusEl2.textContent = msg || "";
  }

  function renderStartupList() {
    if (!startupListEl) return;
    if (!startupItems.length) {
      startupListEl.innerHTML = "<div class=\"startupEmpty\">No startup programs found.</div>";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of startupItems) {
      const row = document.createElement("div");
      row.className = "startupRow";
      row.dataset.id = item.id;

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "startupToggle";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = item.enabled;
      chk.disabled = !item.canToggle;
      chk.title = item.canToggle
        ? (item.enabled ? "Click to disable" : "Click to enable")
        : "Cannot toggle this entry";

      const slider = document.createElement("span");
      slider.className = "startupSlider";

      toggleLabel.appendChild(chk);
      toggleLabel.appendChild(slider);

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

      info.appendChild(nameEl);
      info.appendChild(cmdEl);

      const hiveEl = document.createElement("span");
      hiveEl.className = "startupHive";
      hiveEl.textContent = item.source || item.hive;

      row.appendChild(toggleLabel);
      row.appendChild(info);
      row.appendChild(hiveEl);

      // Toggle event
      if (item.canToggle) chk.addEventListener("change", async () => {
        const wantEnable = chk.checked;
        chk.disabled = true;
        setStartupStatus(wantEnable ? `Enabling "${item.name}"…` : `Disabling "${item.name}"…`);
        try {
          const r = await window.api.setStartupEnabled(item.hive, item.name, item.approvedKey, item.regFlag, wantEnable);
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
    startupListEl.textContent = "";
    startupListEl.appendChild(frag);
  }

  async function loadStartupPrograms() {
    if (startupLoading) return;
    startupLoading = true;
    setStartupStatus("Loading startup programs…");
    if (startupListEl) startupListEl.innerHTML = "<div class=\"startupEmpty\">Loading…</div>";
    try {
      const r = await window.api.getStartupList();
      if (r && r.ok) {
        startupItems = Array.isArray(r.items) ? r.items : [];
        renderStartupList();
        setStartupStatus(`${startupItems.length} startup program(s) found.`);
      } else {
        startupItems = [];
        if (startupListEl) startupListEl.innerHTML = "<div class=\"startupEmpty\">Failed to load startup programs.</div>";
        setStartupStatus(r && r.error ? `Error: ${r.error}` : "Failed to load.");
      }
    } catch (err) {
      if (startupListEl) startupListEl.innerHTML = "<div class=\"startupEmpty\">Error loading startup programs.</div>";
      setStartupStatus(`Error: ${err && err.message ? err.message : String(err)}`);
    } finally {
      startupLoading = false;
    }
  }

  // Collapsible toggle
  if (startupToggleHeader) {
    startupToggleHeader.addEventListener("click", (e) => {
      // Don't toggle when clicking refresh button
      if (e.target.closest("#startupRefreshBtn")) return;
      if (!startupPanelEl) return;
      const isOpen = startupPanelEl.classList.toggle("open");
      // Auto-load on first open
      if (isOpen && !startupItems.length && !startupLoading) {
        loadStartupPrograms();
      }
    });
  }

  if (startupRefreshBtnEl) {
    startupRefreshBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      // Auto-open panel
      if (startupPanelEl && !startupPanelEl.classList.contains("open")) {
        startupPanelEl.classList.add("open");
      }
      loadStartupPrograms();
    });
  }

  // ── init ───────────────────────────────────────────────────────────────────
  function init() {
    setButtons();
    setBusy(false);
    bootstrap();
    refreshAutoStart();

    // Stats from main process (in-memory, no file read needed now)
    window.api.getStats().then(r => { if (r && r.ok && r.stats) updateImpactCards(r.stats); }).catch(() => {});

    // User count badge
    window.api.getCounts().then(r => {
      if (r && r.ok && r.total > 0) {
        if (trustedCountEl) trustedCountEl.textContent = r.total;
        if (trustedBadgeEl) trustedBadgeEl.classList.add("visible");
      }
    }).catch(() => {});

    setStatus("Idle.");
    setOptStatus("Idle");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();

