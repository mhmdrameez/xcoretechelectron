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
  const goProBtn = el("goProBtn");
  const activateModal = el("activateModal");
  const closeActivateBtn = el("closeActivateBtn");
  const buyKeyBtn = el("buyKeyBtn");
  const paymentModal = el("paymentModal");
  const closePaymentBtn = el("closePaymentBtn");
  const sellerUpiIdNotice = el("sellerUpiIdNotice");
  const sellerUpiIdDisplay = el("sellerUpiIdDisplay");
  const copyUpiIdBtn = el("copyUpiId");
  const qrcodeContainer = el("qrcodeContainer");
  const upiDeepLinkBtn = el("upiDeepLinkBtn");
  const paymentEmailBtn = el("paymentEmailBtn");
  const paymentWhatsappBtn = el("paymentWhatsappBtn");
  const activateBtn = el("activateBtn");
  const licenseKeyInput = el("licenseKeyInput");
  const licenseErrorEl = el("licenseError");
  const proBadge = el("proBadge");
  const autoStartContainer = el("autoStartContainer");
  const startupOverlay = el("startupOverlay");
  const startupLockTag = el("startupLockTag");

  const techInternetBtn = el("techInternetBtn");
  const techRamBtn = el("techRamBtn");
  const techAutoBtn = el("techAutoBtn");
  const techFullBtn = el("techFullBtn");
  const techOverlay = el("techOverlay");
  const techLockTag = el("techLockTag");

  // ── constants ──────────────────────────────────────────────────────────────
  const MAX_LIST_ROWS = 2000;
  const VISIBLE_ROWS = 100;
  const SELLER_UPI_ID = "muhammedrameez2000-7@okaxis";
  const PAYMENT_AMOUNT = "399";
  const PAYEE_NAME = "XCoreTech Software";
  const NOTE_TEXT = "XCoreTech Pro License 399 Lifetime";
  const SUPPORT_EMAIL = "xcoretech@yahoo.com";
  const SUPPORT_WHATSAPP_URL = "https://wa.me/919446960834";
  const upiUrl = `upi://pay?pa=${encodeURIComponent(SELLER_UPI_ID)}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${PAYMENT_AMOUNT}&cu=INR&tn=${encodeURIComponent(NOTE_TEXT)}`;
  const proofEmailUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("XCoreTech Pro payment proof")}&body=${encodeURIComponent("Hello XCoreTech,\n\nI completed the ₹399 Lifetime Pro payment.\n\nEmail for license key:\nTransaction ID:\n\nThank you.")}`;

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
    if (progressPctEl) {
      progressPctEl.textContent = `${Math.max(0, Math.min(100, pct | 0))}%`;
      if (pct % 10 === 0) pingMetric(progressPctEl); // Ping every 10% to avoid too much flickering
    }
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
  function updateSystemDashboard(s) {
    if (!s) return;
    if (sysDeviceEl) sysDeviceEl.textContent = s.device || "-";
    if (sysOsEl) sysOsEl.textContent = s.os || "-";
    if (sysCpuEl) sysCpuEl.textContent = s.cpu || "-";
    if (sysRamEl) sysRamEl.textContent = s.ram ? `${s.ram} GB` : "-";
    if (sysFreeEl) sysFreeEl.textContent = s.free ? `${s.free} GB` : "-";
  }

  function applyProState(isPro) {
    if (isPro) {
      if (proBadge) { proBadge.textContent = "PRO"; proBadge.className = "proBadge pro"; }
      if (goProBtn) goProBtn.style.display = "none";
      if (autoStartContainer) autoStartContainer.classList.remove("proLockedFeature");
      if (startupOverlay) startupOverlay.classList.add("hidden");
      if (startupLockTag) startupLockTag.style.display = "none";
      if (autoStartChk) autoStartChk.disabled = false;
      if (techOverlay) techOverlay.classList.add("hidden");
      if (techLockTag) techLockTag.style.display = "none";
    } else {
      if (proBadge) { proBadge.textContent = "FREE"; proBadge.className = "proBadge free"; }
      if (goProBtn) goProBtn.style.display = "flex";
      if (autoStartContainer) autoStartContainer.classList.add("proLockedFeature");
      if (startupOverlay) startupOverlay.classList.remove("hidden");
      if (startupLockTag) startupLockTag.style.display = "inline-block";
      if (autoStartChk) autoStartChk.disabled = true;
      if (techOverlay) techOverlay.classList.remove("hidden");
      if (techLockTag) techLockTag.style.display = "inline-block";
    }
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

  function openExternalUrl(url) {
    if (!url) return;
    if (window.api && typeof window.api.openExternal === "function") {
      window.api.openExternal(url).catch(() => { window.location.href = url; });
      return;
    }
    window.location.href = url;
  }

  function generatePaymentQr() {
    if (!qrcodeContainer) return;
    const size = window.innerWidth < 480 ? 146 : 164;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(upiUrl)}`;
    qrcodeContainer.innerHTML = "";
    qrcodeContainer.removeAttribute("style");
    const img = document.createElement("img");
    img.width = size;
    img.height = size;
    img.alt = "UPI payment QR code";
    img.src = qrUrl;
    img.onerror = () => {
      qrcodeContainer.textContent = "QR unavailable. Use the UPI ID above.";
      qrcodeContainer.style.color = "#111827";
      qrcodeContainer.style.fontWeight = "700";
      qrcodeContainer.style.fontSize = "12px";
      qrcodeContainer.style.textAlign = "center";
      qrcodeContainer.style.padding = "16px";
    };
    qrcodeContainer.appendChild(img);
  }

  function togglePaymentModal(show) {
    if (!paymentModal) return;
    paymentModal.classList.toggle("visible", !!show);
    if (show) {
      generatePaymentQr();
      trackActivity("payment_modal_open");
    } else if (qrcodeContainer) {
      qrcodeContainer.textContent = "";
    }
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

    // Check License
    window.api.getLicense().then(r => {
      if (r && r.ok) applyProState(r.license.isPro);
    }).catch(() => { });

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
    if (autoStartContainer.classList.contains("proLockedFeature")) {
      autoStartChk.checked = !autoStartChk.checked;
      toggleActivateModal(true);
      return;
    }
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
      // Show "Restarting…" — the app will auto-quit in 3 seconds (handled by updater.js)
      showBanner(`✅ v${info.version} downloaded — restarting automatically…`, null, false);
    });
  }

  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus((s) => {
      if (s.phase === "error") {
        // Show error briefly, then hide after 10 seconds
        showBanner(`⚠️ Update failed: ${s.error}`, null, false);
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

  function setStartupStatus(msg) {
    if (startupStatusEl) startupStatusEl.textContent = msg || "";
  }

  function startupOverlayNode() {
    return document.getElementById("startupOverlay");
  }

  function ensureStartupOverlay() {
    if (!startupListEl) return null;
    let overlay = startupOverlayNode();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "startupOverlay";
      overlay.className = "lockOverlay";
      overlay.innerHTML = "<div class=\"lockCard\"><span style=\"font-size: 24px; margin-bottom: 12px;\">🔒</span><div style=\"font-weight: 700; margin-bottom: 4px;\">Pro Feature Locked</div><div style=\"font-size: 11px; color: var(--text-muted);\">Activate Pro to manage startup programs.</div></div>";
    }
    if (autoStartContainer && !autoStartContainer.classList.contains("proLockedFeature")) {
      overlay.classList.add("hidden");
    } else {
      overlay.classList.remove("hidden");
    }
    if (overlay.parentElement !== startupListEl) startupListEl.prepend(overlay);
    return overlay;
  }

  function replaceStartupContent(node) {
    if (!startupListEl) return;
    const overlay = ensureStartupOverlay();
    Array.from(startupListEl.children).forEach((child) => {
      if (child !== overlay) child.remove();
    });
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

      // Icon placeholder
      const icon = document.createElement("div");
      icon.className = "startupIcon";
      const iconText = item.name.toLowerCase().includes("edge") ? "🌐" :
        item.name.toLowerCase().includes("onedrive") ? "☁️" :
          item.name.toLowerCase().includes("security") ? "🛡️" :
            item.name.toLowerCase().includes("amd") || item.name.toLowerCase().includes("nvidia") ? "🎮" : "📦";
      icon.textContent = iconText;

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
      hiveEl.className = `startupHive ${source.includes("HKLM") ? "system" : ""}`;
      hiveEl.textContent = source;

      // Simulated Impact for UX
      const impact = document.createElement("span");
      const isHigh = item.command.toLowerCase().includes("exe") && item.command.length > 50;
      const isMed = item.command.toLowerCase().includes("background");
      impact.className = `startupImpact ${isHigh ? "impact-high" : isMed ? "impact-low" : "impact-medium"}`;
      impact.textContent = isHigh ? "High Impact" : isMed ? "Minimal" : "Measured";

      meta.appendChild(hiveEl);
      meta.appendChild(impact);

      info.appendChild(nameEl);
      info.appendChild(cmdEl);
      info.appendChild(meta);

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "startupToggle";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = item.enabled;
      chk.disabled = !item.canToggle;

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

  if (goProBtn) goProBtn.addEventListener("click", () => toggleActivateModal(true));
  if (closeActivateBtn) closeActivateBtn.addEventListener("click", () => toggleActivateModal(false));
  if (activateModal) activateModal.addEventListener("click", (e) => { if (e.target === activateModal) toggleActivateModal(false); });
  if (buyKeyBtn) buyKeyBtn.addEventListener("click", () => togglePaymentModal(true));
  if (closePaymentBtn) closePaymentBtn.addEventListener("click", () => togglePaymentModal(false));
  if (paymentModal) paymentModal.addEventListener("click", (e) => { if (e.target === paymentModal) togglePaymentModal(false); });
  if (upiDeepLinkBtn) upiDeepLinkBtn.addEventListener("click", () => {
    trackActivity("upi_pay_clicked");
    openExternalUrl(upiUrl);
  });
  if (paymentEmailBtn) paymentEmailBtn.addEventListener("click", () => openExternalUrl(proofEmailUrl));
  if (paymentWhatsappBtn) paymentWhatsappBtn.addEventListener("click", () => openExternalUrl(SUPPORT_WHATSAPP_URL));
  if (copyUpiIdBtn) copyUpiIdBtn.addEventListener("click", async () => {
    const originalText = copyUpiIdBtn.textContent;
    try {
      await navigator.clipboard.writeText(SELLER_UPI_ID);
      copyUpiIdBtn.textContent = "Copied";
    } catch (_) {
      copyUpiIdBtn.textContent = "Copy failed";
    }
    setTimeout(() => { copyUpiIdBtn.textContent = originalText; }, 1500);
  });
  window.addEventListener("resize", () => {
    if (!paymentModal || !paymentModal.classList.contains("visible")) return;
    clearTimeout(togglePaymentModal.resizeTimer);
    togglePaymentModal.resizeTimer = setTimeout(generatePaymentQr, 180);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (paymentModal && paymentModal.classList.contains("visible")) togglePaymentModal(false);
  });

  function toggleActivateModal(show) {
    if (activateModal) activateModal.classList.toggle("visible", !!show);
    if (show && licenseKeyInput) {
      licenseKeyInput.value = "";
      if (licenseErrorEl) licenseErrorEl.textContent = "";
      licenseKeyInput.focus();
    }
  }

  if (sellerUpiIdNotice) sellerUpiIdNotice.textContent = SELLER_UPI_ID;
  if (sellerUpiIdDisplay) sellerUpiIdDisplay.textContent = SELLER_UPI_ID;

  if (activateBtn) activateBtn.addEventListener("click", async () => {
    const key = String(licenseKeyInput ? licenseKeyInput.value : "").trim();
    if (!key) {
      if (licenseErrorEl) licenseErrorEl.textContent = "Please enter a license key.";
      return;
    }

    activateBtn.disabled = true;
    if (licenseErrorEl) licenseErrorEl.textContent = "Verifying securely...";

    try {
      const r = await window.api.verifyLicense(key);
      if (r && r.ok) {
        applyProState(true);
        if (licenseErrorEl) {
          licenseErrorEl.style.color = "var(--accent-primary)";
          licenseErrorEl.textContent = r.msg;
        }
        setTimeout(() => toggleActivateModal(false), 1500);
      } else {
        if (licenseErrorEl) {
          licenseErrorEl.style.color = "var(--accent-danger)";
          licenseErrorEl.textContent = r && r.error ? r.error : "Verification failed.";
        }
      }
    } catch (err) {
      if (licenseErrorEl) licenseErrorEl.textContent = "Connection error during verification.";
    } finally {
      activateBtn.disabled = false;
    }
  });

  // ── init ───────────────────────────────────────────────────────────────────
  function init() {
    setButtons();
    setBusy(false);
    bootstrap();
    refreshAutoStart();
    loadStartupPrograms(); // Auto-load on init

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

