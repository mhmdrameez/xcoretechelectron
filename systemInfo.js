const os = require("os");
const fs = require("fs");
const path = require("path");
const { macVersionFromDarwin } = require(path.join(__dirname, "platform.js"));

function clampText(value, maxLen) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function toGb(value) {
  const gb = Number(value || 0) / (1024 * 1024 * 1024);
  return gb > 0 ? gb.toFixed(1) : "0.0";
}

// "Windows 11 (build 22631)", "macOS 15", "Ubuntu 24.04 LTS"
let _osPretty = null;
function getOsPretty() {
  if (_osPretty) return _osPretty;
  const release = os.release();
  if (process.platform === "win32") {
    const build = Number(String(release).split(".")[2]) || 0;
    _osPretty = build ? `Windows ${build >= 22000 ? 11 : 10} (build ${build})` : `Windows ${release}`;
  } else if (process.platform === "darwin") {
    const v = macVersionFromDarwin(release);
    _osPretty = v ? `macOS ${v}` : `macOS (Darwin ${release})`;
  } else {
    let pretty = "";
    try {
      const m = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8"));
      if (m) pretty = m[1];
    } catch (_) {}
    _osPretty = pretty || `Linux ${release}`;
  }
  return _osPretty;
}

function getSystemInfo() {
  let cpuModel = "unknown";
  try {
    const cpus = os.cpus();
    if (Array.isArray(cpus) && cpus.length) cpuModel = cpus[0].model || "unknown";
  } catch (_) {}

  return {
    device: clampText(os.hostname(), 32).toUpperCase(),
    os: clampText(`${os.platform()} ${os.release()}`, 26),
    osPretty: clampText(getOsPretty(), 48),
    cpu: clampText(cpuModel, 64),
    ram: toGb(os.totalmem()),
    free: toGb(os.freemem()),
  };
}

module.exports = { getSystemInfo };
