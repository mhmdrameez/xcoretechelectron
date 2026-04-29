const fs = require("fs");
const https = require("https");
const path = require("path");

let memoryLocation = null;
let fetchStarted = false;
let cachePath = "";

function setCachePath(p) {
  cachePath = p || "";
}

function sanitizeLocation(city, country) {
  const c1 = String(city || "").trim();
  const c2 = String(country || "").trim();
  const joined = [c1, c2].filter(Boolean).join(", ");
  return joined ? joined.slice(0, 42) : "unknown";
}

function readCacheSync() {
  if (!cachePath) return null;
  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.value) return String(parsed.value).slice(0, 42) || "unknown";
    const v = sanitizeLocation(parsed.city, parsed.country);
    return v || "unknown";
  } catch (_) {
    return null;
  }
}

function writeCache(locationText) {
  if (!cachePath) return;
  try {
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(cachePath, JSON.stringify({ value: String(locationText || "unknown") }), () => {});
  } catch (_) {}
}

function fetchLocationOnce() {
  if (fetchStarted) return;
  fetchStarted = true;

  const req = https.get("https://ipapi.co/json/", (res) => {
    let body = "";
    res.on("data", (chunk) => {
      if (body.length < 600) body += String(chunk || "");
    });
    res.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const city = parsed.city || "";
        const country = parsed.country_name || parsed.country || "";
        memoryLocation = sanitizeLocation(city, country);
      } catch (_) {
        memoryLocation = "unknown";
      }
      writeCache(memoryLocation || "unknown");
    });
  });

  req.setTimeout(1500, () => {
    try {
      req.destroy();
    } catch (_) {}
    if (!memoryLocation) memoryLocation = "unknown";
  });

  req.on("error", () => {
    if (!memoryLocation) memoryLocation = "unknown";
  });
}

function primeLocation(cacheFilePath) {
  setCachePath(cacheFilePath);
  if (!memoryLocation) {
    memoryLocation = readCacheSync() || "unknown";
  }
  fetchLocationOnce();
}

function getLocation() {
  return String(memoryLocation || "unknown");
}

module.exports = { primeLocation, getLocation };
