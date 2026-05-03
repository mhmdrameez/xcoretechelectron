
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/electronApp');

test.describe('IPC Driven UI Extra Coverage', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  test('status IPC event updates the status label', async () => {
    await window.evaluate(() => window.__sendMockIpc('status', { text: 'Playwright status probe' }));
    await expect(window.locator('#statusText')).toHaveText('Playwright status probe');
  });

  test('scan reset IPC event resets totals and progress', async () => {
    await window.evaluate(() => window.__sendMockIpc('scan:reset'));
    await expect(window.locator('#totalFiles')).toHaveText('0');
    await expect(window.locator('#totalSize')).toHaveText('0 B');
    await expect(window.locator('#progressPct')).toHaveText('0%');
  });

  test('scan progress IPC event updates metrics', async () => {
    await window.evaluate(() => {
      window.__sendMockIpc('scan:progress', {
        totalFiles: 12,
        totalBytes: 2048,
        percent: 40,
        newFiles: [],
      });
    });
    await expect(window.locator('#totalFiles')).toHaveText('12');
    await expect(window.locator('#totalSize')).toHaveText('2.00 KB');
    await expect(window.locator('#progressPct')).toHaveText('40%');
  });

  test('scan done IPC event renders file rows and completes progress', async () => {
    await window.evaluate(() => {
      window.__sendMockIpc('scan:done', {
        ok: true,
        totalFiles: 2,
        totalBytes: 3072,
        allFiles: ['C:\\Temp\\one.tmp', 'C:\\Temp\\two.tmp'],
      });
    });
    await expect(window.locator('#totalFiles')).toHaveText('2');
    await expect(window.locator('#progressPct')).toHaveText('100%');
  });

  test('stats update IPC event updates impact cards', async () => {
    await window.evaluate(() => {
      window.__sendMockIpc('stats:update', {
        totalBytesFreed: 1048576,
        totalRuns: 7,
        avgDurationMs: 3000,
        estimatedSpeedBoostPercent: 22,
      });
    });
    await expect(window.locator('#impactTotalCleaned')).toHaveText('1.00 MB');
    await expect(window.locator('#impactRuns')).toHaveText('7');
    await expect(window.locator('#impactAvgTime')).toHaveText('3s');
    await expect(window.locator('#impactSpeedGain')).toHaveText('22%');
  });

  test('technician progress IPC event updates the requested tool row', async () => {
    await window.evaluate(() => {
      window.__sendMockIpc('tech:progress', {
        id: 'techRamProg',
        msg: 'Playwright RAM progress',
      });
    });
    await expect(window.locator('#techRamProg')).toHaveText('Playwright RAM progress');
  });

  test('update available IPC event shows version in banner', async () => {
    await window.evaluate(() => window.__sendMockIpc('update:available', { version: '88.8.8' }));
    await expect(window.locator('#updateBanner')).toHaveClass(/visible/);
    await expect(window.locator('#updateMsg')).toContainText('v88.8.8');
  });

  test('update progress IPC event renders percentage', async () => {
    await window.evaluate(() => window.__sendMockIpc('update:progress', { percent: 67 }));
    await expect(window.locator('#updateBanner')).toHaveClass(/visible/);
    await expect(window.locator('#updatePct')).toHaveText('67%');
  });

  test('update latest IPC event hides the banner', async () => {
    await window.evaluate(() => {
      window.__sendMockIpc('update:available', { version: '88.8.8' });
      window.__sendMockIpc('update:status', { phase: 'latest' });
    });
    await expect(window.locator('#updateBanner')).not.toHaveClass(/visible/);
  });
});
