const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPaths } = require('../scanner');
const { cleanFiles } = require('../cleaner');
const { launchApp, closeApp } = require('./helpers/electronApp');

const ROOT = path.resolve(__dirname, '..');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function removeDir(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

async function createStressFixture(label, filesPerDir = 35, dirCount = 24) {
  const root = path.join(os.tmpdir(), `xcoretech-stress-${label}-${Date.now()}-${process.pid}`);
  await fs.promises.mkdir(root, { recursive: true });

  const dirs = [];
  for (let d = 0; d < dirCount; d++) {
    const dir = path.join(root, `bucket-${String(d).padStart(3, '0')}`, 'cache', 'deep');
    dirs.push(dir);
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const writes = [];
  for (let d = 0; d < dirs.length; d++) {
    for (let f = 0; f < filesPerDir; f++) {
      const body = `stress fixture ${label} ${d}:${f}\n`.repeat((f % 5) + 1);
      writes.push(fs.promises.writeFile(path.join(dirs[d], `junk-${String(f).padStart(3, '0')}.tmp`), body));
    }
  }
  await Promise.all(writes);
  return { root, expectedFiles: filesPerDir * dirCount };
}

function burnCpuFor(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    Math.sqrt(Math.random() * Number.MAX_SAFE_INTEGER);
  }
}

test.describe('Stress and Low Resource Coverage', () => {
  test('scanner handles a large nested cache fixture with slow progress consumers', async () => {
    test.setTimeout(30000);
    const fixture = await createStressFixture('scan', 40, 28);
    const progress = [];
    const logs = [];

    try {
      const result = await scanPaths([fixture.root, path.join(fixture.root, 'missing-root')], {
        cancel: { cancelled: false },
        onProgress: (p) => {
          progress.push(p);
          burnCpuFor(1);
        },
        onLog: (entry) => logs.push(entry),
      });

      expect(result.files).toHaveLength(fixture.expectedFiles);
      expect(result.directories.length).toBeGreaterThanOrEqual(28);
      expect(result.totalBytes).toBeGreaterThan(0);
      expect(progress.length).toBeGreaterThan(0);
      expect(logs.some((entry) => entry.msg === 'Root path missing, skipped')).toBe(true);
    } finally {
      await removeDir(fixture.root);
    }
  });

  test('cleaner deletes a large fixture and reports final progress under pressure', async () => {
    test.setTimeout(30000);
    const fixture = await createStressFixture('clean', 35, 20);
    const scanned = await scanPaths([fixture.root], {
      cancel: { cancelled: false },
      onProgress: () => {},
      onLog: () => {},
    });
    const progress = [];

    try {
      const result = await cleanFiles(scanned.files, scanned.directories, {
        onProgress: (p) => {
          progress.push(p);
          burnCpuFor(1);
        },
        onLog: () => {},
      });

      expect(result.ok).toBe(true);
      expect(result.attempted).toBe(scanned.files.length + scanned.directories.length);
      expect(result.deleted).toBeGreaterThanOrEqual(scanned.files.length);
      expect(result.skipped).toBe(0);
      expect(progress.at(-1).percent).toBe(100);
      await expect(async () => {
        await fs.promises.access(fixture.root);
      }).rejects.toBeTruthy();
    } finally {
      await removeDir(fixture.root);
    }
  });

  test('renderer survives rapid IPC updates without layout-breaking totals', async () => {
    test.setTimeout(30000);
    let app;
    let window;
    try {
      ({ electronApp: app, window } = await launchApp());

      await window.evaluate(() => {
        for (let i = 0; i < 250; i++) {
          window.__sendMockIpc('scan:progress', {
            totalFiles: i + 1,
            totalBytes: (i + 1) * 2048,
            percent: i % 101,
            newFiles: [`C:\\Temp\\stress-${i}.tmp`],
          });
        }
        window.__sendMockIpc('scan:done', {
          ok: true,
          totalFiles: 250,
          totalBytes: 250 * 2048,
          allFiles: Array.from({ length: 250 }, (_, i) => `C:\\Temp\\done-${i}.tmp`),
        });
        for (let i = 0; i < 100; i++) {
          window.__sendMockIpc('stats:update', {
            totalBytesFreed: i * 4096,
            totalRuns: i,
            avgDurationMs: i * 10,
            estimatedSpeedBoostPercent: i % 100,
          });
        }
      });

      await expect(window.locator('#totalFiles')).toHaveText('250');
      await expect(window.locator('#progressPct')).toHaveText('100%');
      await expect(window.locator('#totalSize')).toContainText('500');
      const appBox = await window.locator('#app').boundingBox();
      expect(appBox.width).toBeGreaterThan(700);
      expect(appBox.height).toBeGreaterThan(500);
    } finally {
      await closeApp(app);
    }
  });

  test('Electron boots with constrained JS heap and hidden background args', async () => {
    test.setTimeout(30000);
    let electronApp;
    try {
      electronApp = await electron.launch({
        args: [
          '--js-flags=--max-old-space-size=32 --max-semi-space-size=1 --optimize-for-size',
          '--disable-gpu',
          '--disable-gpu-compositing',
          '.',
          '--hidden',
        ],
        cwd: ROOT,
        env: cleanEnv({ PLAYWRIGHT_TEST: '1' }),
      });
      const window = await electronApp.firstWindow();
      await expect(window.locator('#app')).toBeVisible({ timeout: 10000 });
      await expect(window.locator('#statusText')).toHaveText(/Idle\.|Checking for updates|Background mode active/, { timeout: 15000 });
    } finally {
      if (electronApp) await electronApp.close();
    }
  });
});
