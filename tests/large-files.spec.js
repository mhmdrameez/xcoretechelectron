const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const { findLargeFiles, isSkippedDir, getFixturePath } = require('../largeFiles.js');

const MB = 1024 * 1024;

// Electron's own default_app.asar: <dist>/resources on Windows/Linux,
// Electron.app/Contents/Resources on macOS
function defaultAppAsar() {
  const exe = require('electron'); // in Node this is the path to the Electron binary
  const resources = process.platform === 'darwin'
    ? path.join(path.dirname(exe), '..', 'Resources')
    : path.join(path.dirname(exe), 'resources');
  return path.join(resources, 'default_app.asar');
}

// fs.truncate makes a file of the given size without writing the bytes
function makeFile(p, size) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
  fs.truncateSync(p, size);
}

test.describe('Large file finder (module)', () => {
  let dir;

  test.beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcoretech-large-unit-'));
    makeFile(path.join(dir, 'movie.mkv'), 3 * MB);
    makeFile(path.join(dir, 'notes.txt'), 10);
    makeFile(path.join(dir, 'deep', 'deeper', 'backup.zip'), 5 * MB);
    makeFile(path.join(dir, 'deep', 'small.log'), 512 * 1024);
  });

  test.afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('finds files at or above the size limit, biggest first', async () => {
    const r = await findLargeFiles(dir, { minBytes: 1 * MB });
    expect(r.cancelled).toBe(false);
    expect(r.found).toBe(2);
    expect(r.scannedFiles).toBe(4);
    expect(r.items.map((i) => i.name)).toEqual(['backup.zip', 'movie.mkv']);
    expect(r.items[0].size).toBe(5 * MB);
    expect(r.items[0].path).toBe(path.join(dir, 'deep', 'deeper', 'backup.zip'));
    expect(typeof r.items[0].modified).toBe('number');
  });

  test('keeps only the biggest files when a result limit is set', async () => {
    const r = await findLargeFiles(dir, { minBytes: 1, maxResults: 1 });
    expect(r.found).toBe(4);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe('backup.zip');
  });

  test('stops when cancelled', async () => {
    const r = await findLargeFiles(dir, { minBytes: 1, cancel: { cancelled: true } });
    expect(r.cancelled).toBe(true);
    expect(r.items).toHaveLength(0);
  });

  test('reports a missing folder instead of throwing', async () => {
    const r = await findLargeFiles(path.join(dir, 'does-not-exist'), { minBytes: 1 });
    expect(r.items).toHaveLength(0);
    expect(r.error).toBeTruthy();
  });

  test('skips Windows and program folders only at a drive root', () => {
    expect(isSkippedDir('C:\\', 'Windows')).toBe(true);
    expect(isSkippedDir('D:\\', 'Program Files (x86)')).toBe(true);
    expect(isSkippedDir('C:\\', '$Recycle.Bin')).toBe(true);
    expect(isSkippedDir('C:\\', 'Users')).toBe(false);
    expect(isSkippedDir('C:\\Users\\me\\Games', 'Windows')).toBe(false);
  });
});

test.describe('Large file finder (app)', () => {
  let electronApp;
  let window;
  const fixture = getFixturePath();

  test.beforeAll(async () => {
    fs.rmSync(fixture, { recursive: true, force: true });
    makeFile(path.join(fixture, 'big-video.mp4'), 120 * MB);
    makeFile(path.join(fixture, 'sub', 'old-installer.iso'), 60 * MB);
    makeFile(path.join(fixture, 'tiny.txt'), 100);
    fs.mkdirSync(path.join(fixture, 'apps'), { recursive: true });
    fs.copyFileSync(
      defaultAppAsar(),
      path.join(fixture, 'apps', 'app.asar'));
    electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  test('lists places to search, starting with the test folder', async () => {
    await expect(window.locator('#largeRoot')).toBeEnabled({ timeout: 15000 });
    await expect(window.locator('#largeRoot option').first()).toHaveAttribute('value', 'fixture');
    await expect(window.locator('#largeRoot option[value="home"]')).toHaveCount(1);
    expect(await window.locator('#largeRoot option[value^="drive-"]').count()).toBeGreaterThan(0);
  });

  test('finds large files and shows them biggest first', async () => {
    await window.locator('#largeRoot').selectOption('fixture');
    await window.locator('#largeMin').selectOption({ label: '50 MB' });
    await window.locator('#largeScanBtn').click();

    const rows = window.locator('#largeList .largeRow');
    await expect(rows).toHaveCount(2, { timeout: 15000 });
    await expect(rows.nth(0).locator('.largeName')).toHaveText('big-video.mp4');
    await expect(rows.nth(0).locator('.largeSize')).toHaveText('120 MB');
    await expect(rows.nth(1).locator('.largeName')).toHaveText('old-installer.iso');
    await expect(window.locator('#largeStatus')).toContainText('found 2');
    await expect(window.locator('#largeTrashBtn')).toBeDisabled();
  });

  test('select all updates the selection summary', async () => {
    await window.locator('#largeSelectAll').check();
    await expect(window.locator('#largeSelInfo')).toHaveText('2 selected · 180 MB');
    await window.locator('#largeSelectAll').uncheck();
    await expect(window.locator('#largeSelInfo')).toHaveText('Nothing selected');
  });

  test('refuses to delete files that were not in the scan results', async () => {
    // any existing file that the scan didn't return — here, the test runner itself
    const outside = process.execPath;
    const r = await window.evaluate((p) => window.api.largeDelete([p], true), outside);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });

  test('deletes the selected file and removes it from the list', async () => {
    const target = path.join(fixture, 'sub', 'old-installer.iso');
    await window.locator('#largeList .largeRow', { hasText: 'old-installer.iso' }).locator('input[type=checkbox]').check();
    await expect(window.locator('#largeSelInfo')).toHaveText('1 selected · 60.0 MB');
    await window.locator('#largeDeleteBtn').click();

    await expect(window.locator('#largeList .largeRow')).toHaveCount(1, { timeout: 10000 });
    await expect(window.locator('#largeStatus')).toContainText('Deleted: 1 file(s), 60.0 MB');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(fixture, 'big-video.mp4'))).toBe(true);
  });

  test('treats .asar archives as plain files and does not lock them', async () => {
    const asar = path.join(fixture, 'apps', 'app.asar');
    const r = await window.evaluate(() => window.api.largeScan('fixture', 1));
    expect(r.ok).toBe(true);
    const paths = r.items.map((i) => i.path);
    expect(paths).toContain(asar);
    expect(paths.some((p) => p.startsWith(asar + path.sep))).toBe(false);
    expect(r.items.find((i) => i.path === asar).size).toBe(fs.statSync(asar).size);
    // a file the app still holds open can't be renamed on Windows
    fs.renameSync(asar, asar + '.moved');
    fs.renameSync(asar + '.moved', asar);
  });
});

