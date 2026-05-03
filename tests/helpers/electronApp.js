const { expect } = require('@playwright/test');
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function launchApp() {
  const bundledChromium = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'ms-playwright',
    'chromium-1217',
    'chrome-win64',
    'chrome.exe'
  );
  const electronApp = await chromium.launch({
    executablePath: fs.existsSync(bundledChromium) ? bundledChromium : undefined,
  });
  const window = await electronApp.newPage();
  await window.addInitScript(() => {
    const callbacks = {};
    window.__openedExternalLinks = [];
    window.__mockIpcCallbacks = callbacks;
    window.__sendMockIpc = (channel, payload) => {
      if (typeof callbacks[channel] === 'function') callbacks[channel](payload);
    };

    const on = (channel, fn) => {
      callbacks[channel] = fn;
      return () => {
        if (callbacks[channel] === fn) delete callbacks[channel];
      };
    };

    window.api = {
      scanStart: async () => ({ ok: true }),
      scanCancel: async () => ({ ok: true }),
      cleanStart: async () => ({ ok: true }),
      getAutoStart: async () => ({ enabled: false }),
      setAutoStart: async (enabled) => ({ ok: true, enabled }),
      getStats: async () => ({ ok: true, stats: {
        totalBytesFreed: 0,
        totalRuns: 0,
        avgDurationMs: 0,
        estimatedSpeedBoostPercent: 0,
      } }),
      getSystemInfo: async () => ({ ok: true, system: {
        device: 'Playwright Device',
        os: 'Windows Test',
        cpu: 'Test CPU',
        ram: 16,
        free: 128,
      } }),
      getLicense: async () => ({ ok: true, license: { isPro: false } }),
      verifyLicense: async () => ({ ok: false, error: 'Verification failed.' }),
      getCounts: async () => ({ ok: true, total: 1234 }),
      trackEvent: async () => ({ ok: true }),
      updateInstall: async () => ({ ok: true }),
      updateCheck: async () => ({ ok: true }),
      getStartupList: async () => ({ ok: true, items: [] }),
      setStartupEnabled: async () => ({ ok: true }),
      techInternetFix: async () => ({ ok: true, successCount: 5, total: 5 }),
      techRamBoost: async () => ({ ok: true, freedBytes: 1024 }),
      techAutoFix: async () => ({ ok: true }),
      openExternal: async (url) => {
        window.__openedExternalLinks.push(url);
        return { ok: true };
      },
      onScanReset: (fn) => on('scan:reset', fn),
      onScanProgress: (fn) => on('scan:progress', fn),
      onScanDone: (fn) => on('scan:done', fn),
      onCleanProgress: (fn) => on('clean:progress', fn),
      onCleanDone: (fn) => on('clean:done', fn),
      onStatsUpdate: (fn) => on('stats:update', fn),
      onStatus: (fn) => on('status', fn),
      onLog: (fn) => on('log', fn),
      onUpdateAvailable: (fn) => on('update:available', fn),
      onUpdateProgress: (fn) => on('update:progress', fn),
      onUpdateDownloaded: (fn) => on('update:downloaded', fn),
      onUpdateStatus: (fn) => on('update:status', fn),
      onTechProgress: (fn) => on('tech:progress', fn),
    };
  });

  await window.goto(`file://${path.resolve(__dirname, '..', '..', 'index.html')}`);
  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('#app')).toBeVisible({ timeout: 10000 });
  return { electronApp, window };
}

async function closeApp(electronApp) {
  if (!electronApp) return;
  try {
    await electronApp.close();
  } catch (_) {}
}

async function isVisibleByStyle(locator) {
  return locator.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });
}

module.exports = {
  launchApp,
  closeApp,
  isVisibleByStyle,
};
