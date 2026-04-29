// analytics.js — fire-and-forget, native Node https, redirect-following
"use strict";
const https = require("https");
const http  = require("http");
const { URL } = require("url");

const ALLOWED_EVENTS = new Set(["app_open", "cleanup_done", "crash", "activity"]);
const NORMAL_GAP_MS  = 60_000;
const DELAY_MS       = 2200;   // defer non-critical sends so startup is fast
const MAX_REDIRECTS  = 5;      // Google Apps Script always does 302 → final

let baseUrl          = "";
let getSystemInfoFn  = () => ({});
let getLocationFn    = () => "unknown";
let lastNormalSentAt = 0;

function initAnalytics({ endpoint, getSystemInfo, getLocation }) {
  const url = String(endpoint || "").trim();
  if (!url) return;
  baseUrl         = url.includes("?") ? `${url}&` : `${url}?`;
  getSystemInfoFn = typeof getSystemInfo === "function" ? getSystemInfo : getSystemInfoFn;
  getLocationFn   = typeof getLocation   === "function" ? getLocation   : getLocationFn;
}

function isOnlineNow() {
  try { const { net } = require("electron"); return net.isOnline(); } catch (_) { return true; }
}

function enc(v, maxLen) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, maxLen) : "unknown";
}

function buildQuery(eventName, payload) {
  const p = (payload && typeof payload === "object") ? payload : {};
  const s = getSystemInfoFn() || {};
  const params = new URLSearchParams({
    name:     enc(p.name,         64),
    phone:    enc(p.phone,        32),
    device:   enc(s.device,       64),
    os:       enc(s.os,           64),
    cpu:      enc(s.cpu,          128),
    ram:      enc(s.ram,           12),
    free:     enc(s.free,          12),
    junk:     enc(p.junk,         256),
    event:    enc(eventName,      32),
    location: enc(getLocationFn(), 64),
    error:    enc(p.error,       512),
  });
  const q = params.toString();
  return q.length > 1800 ? q.slice(0, 1800) : q;
}

// ── redirect-following GET — drains body, returns { ok, status, body } ────────
function httpGet(rawUrl, drainBody, hopsLeft) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) {
      return resolve({ ok: false, status: 0, body: "", error: "Invalid URL" });
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || undefined,
      path:     parsed.pathname + parsed.search,
      method:   "GET",
      headers:  { "User-Agent": "XCoreTech-DiskCleaner/1.0", Accept: "application/json, */*" },
      timeout:  10000,
    };
    const req = lib.request(opts, (res) => {
      const { statusCode, headers } = res;

      // Follow redirect (301/302/303/307/308)
      if ((statusCode === 301 || statusCode === 302 || statusCode === 303 ||
           statusCode === 307 || statusCode === 308) && headers.location) {
        res.resume(); // drain redirect body
        if ((hopsLeft || 0) <= 0) return resolve({ ok: false, status: statusCode, body: "", error: "Too many redirects" });
        // Resolve relative redirect URLs
        let nextUrl = headers.location;
        try { nextUrl = new URL(headers.location, rawUrl).toString(); } catch (_) {}
        return httpGet(nextUrl, drainBody, (hopsLeft || MAX_REDIRECTS) - 1).then(resolve);
      }

      if (!drainBody) {
        res.resume();
        return resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, body: "" });
      }

      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (body.length < 8192) body += c; });
      res.on("end",  ()  => resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, body }));
      res.on("error", (e) => resolve({ ok: false, status: statusCode, body, error: e.message }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, body: "", error: "timeout" }); });
    req.on("error",   (e)  => resolve({ ok: false, status: 0, body: "", error: e.message }));
    req.end();
  });
}

// ── public API ────────────────────────────────────────────────────────────────
async function sendEvent(eventName, payload, options) {
  const opts = (options && typeof options === "object") ? options : {};
  if (!baseUrl || !ALLOWED_EVENTS.has(eventName))
    return { ok: false, error: "Event not allowed or endpoint not set" };
  if (!isOnlineNow())
    return { ok: false, error: "Offline" };

  const isCrash = eventName === "crash";
  const now = Date.now();
  if (!isCrash && !opts.force && now - lastNormalSentAt < NORMAL_GAP_MS)
    return { ok: false, error: "Throttled" };

  const url     = `${baseUrl}${buildQuery(eventName, payload)}`;
  const delayMs = opts.immediate ? 0 : DELAY_MS;

  const performSend = async () => {
    const r = await httpGet(url, false, MAX_REDIRECTS);
    if (!isCrash && r.ok) lastNormalSentAt = Date.now();
    return r;
  };

  if (delayMs <= 0) return performSend();

  return new Promise((resolve) => {
    setTimeout(async () => {
      resolve(await performSend());
    }, delayMs);
  });
}

async function getUserCounts() {
  if (!baseUrl)        return { ok: false, error: "Endpoint not set" };
  if (!isOnlineNow())  return { ok: false, error: "Offline" };

  const base = baseUrl.replace(/[?&]$/, "");
  const r = await httpGet(`${base}?type=count`, true, MAX_REDIRECTS);
  if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status}` };

  const raw = r.body.trim();
  if (!raw || raw === "OK") return { ok: false, error: "Old script or empty response" };

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}
  const total = (parsed && parsed.total != null) ? Number(parsed.total) : 0;
  return { ok: true, total };
}

module.exports = { initAnalytics, sendEvent, getUserCounts };