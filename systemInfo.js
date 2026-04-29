const os = require("os");

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

function getSystemInfo() {
  let cpuModel = "unknown";
  try {
    const cpus = os.cpus();
    if (Array.isArray(cpus) && cpus.length) cpuModel = cpus[0].model || "unknown";
  } catch (_) {}

  return {
    device: clampText(os.hostname(), 32).toUpperCase(),
    os: clampText(`${os.platform()} ${os.release()}`, 26),
    cpu: clampText(cpuModel, 38),
    ram: toGb(os.totalmem()),
    free: toGb(os.freemem()),
  };
}

module.exports = { getSystemInfo };
