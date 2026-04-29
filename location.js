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

const ENDPOINTS = [
  { url: "https://ipapi.co/json/", city: "city", country: "country_name" },
  { url: "http://ip-api.com/json/", city: "city", country: "country" },
  { url: "https://freeipapi.com/api/json", city: "cityName", country: "countryName" }
];

function fetchWithRetry(index = 0) {
  if (index >= ENDPOINTS.length) {
    if (!memoryLocation || memoryLocation === "unknown") memoryLocation = "unknown";
    return;
  }

  const service = ENDPOINTS[index];
  const isHttps = service.url.startsWith("https");
  const lib = isHttps ? require("https") : require("http");

  try {
    const req = lib.get(service.url, (res) => {
      let body = "";
      res.on("data", (chunk) => { if (body.length < 1024) body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const city = parsed[service.city] || "";
          const country = parsed[service.country] || "";
          if (city || country) {
            memoryLocation = sanitizeLocation(city, country);
            writeCache(memoryLocation);
            return; // Success!
          }
        } catch (_) {}
        fetchWithRetry(index + 1); // Try next
      });
    });

    req.setTimeout(4000, () => {
      try { req.destroy(); } catch (_) {}
      fetchWithRetry(index + 1);
    });

    req.on("error", () => {
      fetchWithRetry(index + 1);
    });
  } catch (_) {
    fetchWithRetry(index + 1);
  }
}

function primeLocation(cacheFilePath) {
  setCachePath(cacheFilePath);
  if (!memoryLocation || memoryLocation === "unknown") {
    memoryLocation = readCacheSync() || "unknown";
  }
  // De-prioritize network fetch: wait 8 seconds so it doesn't slow down startup
  setTimeout(() => {
    fetchWithRetry(0);
  }, 8000);
}

function getLocation() {
  return String(memoryLocation || "unknown");
}

module.exports = { primeLocation, getLocation };
