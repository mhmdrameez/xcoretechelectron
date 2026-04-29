// analytics.js
const axios = require('axios');

const ALLOWED_EVENTS = new Set(["app_open", "cleanup_done", "crash", "activity"]);
const NORMAL_GAP_MS = 60 * 1000;
const NON_CRITICAL_DELAY_MS = 2200;

let baseUrlPrefix = "";
let getSystemInfoFn = () => ({});
let getLocationFn = () => "unknown";
let lastNormalSentAt = 0;

function initAnalytics({ endpoint, getSystemInfo, getLocation }) {
  const url = String(endpoint || "").trim();
  if (!url) return;
  baseUrlPrefix = url.includes("?") ? `${url}&` : `${url}?`;
  getSystemInfoFn = typeof getSystemInfo === "function" ? getSystemInfo : getSystemInfoFn;
  getLocationFn = typeof getLocation === "function" ? getLocation : getLocationFn;
}

function isOnlineNow() {
  try {
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return false;
  } catch (_) {}
  try {
    const { net } = require("electron");
    if (net && typeof net.isOnline === "function") return !!net.isOnline();
  } catch (_) {}
  return true;
}

function enc(v, maxLen) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, maxLen) : "unknown";
}

function buildQuery(eventName, payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const s = getSystemInfoFn() || {};
  const location = getLocationFn() || "unknown";
  const params = new URLSearchParams({
    name: enc(p.name, 40),
    phone: enc(p.phone, 20),
    device: enc(s.device, 32),
    os: enc(s.os, 26),
    cpu: enc(s.cpu, 38),
    ram: enc(s.ram, 6),
    free: enc(s.free, 6),
    junk: enc(p.junk, 18),
    event: enc(eventName, 14),
    location: enc(location, 42),
    error: enc(p.error, 120),
  });
  let query = params.toString();
  if (query.length > 900) query = query.slice(0, 900);
  return query;
}

async function sendEvent(eventName, payload, options) {
  const opts = options && typeof options === "object" ? options : {};
  if (!baseUrlPrefix || !ALLOWED_EVENTS.has(eventName)) {
    return { ok: false, error: "Event not allowed or endpoint not set" };
  }
  if (!isOnlineNow()) {
    return { ok: false, error: "No internet connection" };
  }

  const isCrash = eventName === "crash";
  const now = Date.now();
  if (!isCrash && !opts.force && now - lastNormalSentAt < NORMAL_GAP_MS) {
    return { ok: false, error: "Throttled (sent too recently)" };
  }

  const query = buildQuery(eventName, payload);
  const url = `${baseUrlPrefix}${query}`;
  console.log("Sending analytics:", url);

  const delayMs = opts.immediate ? 0 : NON_CRITICAL_DELAY_MS;

  // Return a promise that resolves after the actual HTTP response
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            "User-Agent": "XCoreTech-DiskCleaner/1.0",
            Accept: "*/*",
          },
        });

        const ok = response.status >= 200 && response.status < 300;
        if (!isCrash) lastNormalSentAt = Date.now();

        // Log the result clearly
        if (ok) {
          console.log(`✅ Analytics sent successfully (HTTP ${response.status} ${response.statusText})`);
        } else {
          console.log(`⚠️ Analytics responded with HTTP ${response.status} ${response.statusText}`);
        }

        resolve({
          ok,
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });
      } catch (err) {
        let status = null;
        let statusText = "";
        let errorMessage = err.message;
        let code = err.code;

        if (err.response) {
          status = err.response.status;
          statusText = err.response.statusText || "";
          errorMessage = err.response.data?.message || err.message;
          console.log(`❌ Analytics failed: HTTP ${status} ${statusText} - ${errorMessage}`);
        } else if (err.request) {
          errorMessage = "No response from server (network issue)";
          code = err.code || "ENORESPONSE";
          console.log(`❌ Analytics failed: ${errorMessage} (${code})`);
        } else {
          console.log(`❌ Analytics error: ${errorMessage}`);
        }

        resolve({
          ok: false,
          status,
          statusText,
          error: errorMessage,
          code,
        });
      }
    }, delayMs);
  });
}

async function getUserCounts() {
  if (!baseUrlPrefix) return { ok: false, error: "Endpoint not set" };
  if (!isOnlineNow()) return { ok: false, error: "No internet connection" };

  try {
    // Build the URL cleanly — strip any trailing & or ? from baseUrlPrefix
    const base = baseUrlPrefix.replace(/[?&]$/, "");
    const url  = `${base}?type=count`;

    const response = await axios.get(url, {
      timeout: 10000,
      responseType: "text",
      headers: { Accept: "application/json, text/plain, */*" },
      maxRedirects: 5,
    });

    const raw = String(response.data || "").trim();
    console.log("[analytics] getCounts raw:", raw.slice(0, 150));

    // If still returning "OK", the old script is deployed — return not-ready
    if (raw === "OK") {
      console.log("[analytics] getCounts: old script deployed, no count available");
      return { ok: false, error: "Old script deployed" };
    }

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) {}

    const total = (parsed && parsed.total != null) ? Number(parsed.total) : 0;
    console.log("[analytics] getCounts total unique users:", total);
    return { ok: true, total };
  } catch (err) {
    console.log("[analytics] getCounts error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { initAnalytics, sendEvent, getUserCounts };