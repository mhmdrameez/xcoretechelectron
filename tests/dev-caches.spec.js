const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const { createDevCaches, stalePlaywrightDirs, getDevFixturePath } = require('../devCaches.js');

const KB = 1024;
const DAY = 24 * 60 * 60 * 1000;

function makeFile(p, size, ageDays) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(size));
  if (ageDays) {
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(p, t, t);
  }
}

// a command runner that records what would be run, and runs nothing
function fakeRunner() {
  const calls = [];
  const run = async (cmd) => { calls.push(cmd); return { ok: true, stdout: '', stderr: '', error: '' }; };
  return { calls, run };
}

test.describe('Developer caches (module)', () => {
  let root;
  test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcoretech-dev-unit-')); });
  test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('finds Playwright browsers that no installed project needs', () => {
    const browsers = path.join(root, 'ms-playwright');
    const pkg = path.join(root, 'project', 'node_modules', 'playwright-core');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'browsers.json'), JSON.stringify({ browsers: [
      { name: 'chromium-headless-shell', revision: '100' },
      { name: 'webkit', revision: '200', revisionOverrides: { mac14: '199' } },
    ] }));
    fs.mkdirSync(path.join(browsers, '.links'), { recursive: true });
    fs.writeFileSync(path.join(browsers, '.links', 'a'), pkg);
    fs.writeFileSync(path.join(browsers, '.links', 'b'), path.join(root, 'deleted-project'));
    for (const d of ['chromium_headless_shell-100', 'chromium_headless_shell-90', 'webkit-199', 'webkit-200', 'firefox-50', 'ffmpeg-10', 'notes']) {
      fs.mkdirSync(path.join(browsers, d));
    }
    const stale = stalePlaywrightDirs(browsers).map((p) => path.basename(p)).sort();
    expect(stale).toEqual(['chromium_headless_shell-90', 'ffmpeg-10', 'firefox-50']);
  });

  test('leaves Playwright browsers alone when it cannot tell what is used', () => {
    const browsers = path.join(root, 'ms-playwright');
    fs.mkdirSync(path.join(browsers, 'chromium-1'), { recursive: true });
    expect(stalePlaywrightDirs(browsers)).toBeNull();
  });

  test('detects caches without running tools, and cleans only what is safe', async () => {
    const local = path.join(root, 'local');
    const temp = path.join(root, 'temp');
    makeFile(path.join(local, 'npm-cache', '_cacache', 'content', 'a'), 300 * KB);
    makeFile(path.join(local, 'npm-cache', '_logs', 'debug.log'), 10 * KB);
    makeFile(path.join(local, 'pip', 'Cache', 'http', 'b'), 200 * KB);
    makeFile(path.join(local, 'pnpm', 'store', 'v3', 'c'), 100 * KB);
    makeFile(path.join(temp, 'old.tmp'), 50 * KB, 10);
    makeFile(path.join(temp, 'sub', 'old2.tmp'), 25 * KB, 30);
    makeFile(path.join(temp, 'fresh.tmp'), 40 * KB);

    const runner = fakeRunner();
    const dev = createDevCaches({
      env: {}, localAppData: local, userProfile: path.join(root, 'home'), tempDir: temp,
      which: async () => null, run: runner.run,
    });
    const targets = await dev.detect();
    const byId = Object.fromEntries(targets.map((t) => [t.id, t]));

    expect(byId.npm).toMatchObject({ status: 'found', items: 1, bytes: 300 * KB, cleanable: true });
    expect(byId.pip).toMatchObject({ status: 'found', bytes: 200 * KB, cleanable: true });
    expect(byId.pnpm).toMatchObject({ status: 'needs-tool', bytes: 100 * KB, cleanable: false });
    expect(byId.temp).toMatchObject({ status: 'found', items: 2, bytes: 75 * KB, cleanable: true });
    expect(byId.uv.status).toBe('nothing');
    expect(byId.conda.status).toBe('nothing');
    expect(byId.playwright.status).toBe('nothing');
    expect(byId.temp.files).toBeUndefined(); // internal file list isn't exposed

    const results = await dev.clean(['npm', 'pip', 'temp', 'pnpm', 'bogus']);
    const res = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(res.npm).toMatchObject({ ok: true, freedBytes: 300 * KB });
    expect(res.pip).toMatchObject({ ok: true, freedBytes: 200 * KB });
    expect(res.temp).toMatchObject({ ok: true, freedBytes: 75 * KB });
    expect(res.pnpm.ok).toBe(false);
    expect(res.bogus).toBeUndefined();

    expect(fs.existsSync(path.join(local, 'npm-cache', '_logs', 'debug.log'))).toBe(true);
    expect(fs.existsSync(path.join(local, 'pnpm', 'store', 'v3', 'c'))).toBe(true);
    expect(fs.existsSync(path.join(temp, 'fresh.tmp'))).toBe(true);
    expect(fs.existsSync(path.join(temp, 'old.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(temp, 'sub', 'old2.tmp'))).toBe(false);
    expect(runner.calls).toEqual([]); // no tool was run
  });

  test('uses each tool\'s own clean command when the tool is installed', async () => {
    const local = path.join(root, 'local');
    const home = path.join(root, 'home');
    makeFile(path.join(local, 'npm-cache', '_cacache', 'a'), 10 * KB);
    makeFile(path.join(local, 'uv', 'cache', 'b'), 10 * KB);
    makeFile(path.join(home, 'miniconda3', 'pkgs', 'c.tar.bz2'), 10 * KB);
    makeFile(path.join(home, 'miniconda3', 'Scripts', 'conda.exe'), 1);

    const runner = fakeRunner();
    const tools = { npm: 'C:\\tools\\npm.cmd', uv: 'C:\\tools\\uv.exe' };
    const dev = createDevCaches({
      env: {}, localAppData: local, userProfile: home, tempDir: path.join(root, 'temp'),
      which: async (t) => tools[t] || null, run: runner.run,
    });
    const byId = Object.fromEntries((await dev.detect()).map((t) => [t.id, t]));
    expect(byId.conda).toMatchObject({ status: 'found', cleanable: true });

    runner.calls.length = 0;
    await dev.clean(['npm', 'uv', 'conda']);
    expect(runner.calls).toEqual([
      'npm cache clean --force',
      'uv cache prune',
      `"${path.join(home, 'miniconda3', 'Scripts', 'conda.exe')}" clean --packages --tarballs --yes`,
    ]);
    // the fake tools didn't delete anything, and nothing was deleted behind their back
    expect(fs.existsSync(path.join(local, 'npm-cache', '_cacache', 'a'))).toBe(true);
    expect(fs.existsSync(path.join(local, 'uv', 'cache', 'b'))).toBe(true);
  });
});

test.describe('Developer caches (app)', () => {
  let electronApp;
  let window;
  const fx = getDevFixturePath();

  test.beforeAll(async () => {
    fs.rmSync(fx, { recursive: true, force: true });
    makeFile(path.join(fx, 'local', 'npm-cache', '_cacache', 'content', 'pkg.tgz'), 512 * KB);
    makeFile(path.join(fx, 'local', 'pip', 'Cache', 'wheels', 'x.whl'), 256 * KB);
    makeFile(path.join(fx, 'temp', 'old.log'), 128 * KB, 9);
    makeFile(path.join(fx, 'temp', 'today.log'), 64 * KB);
    electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
    fs.rmSync(fx, { recursive: true, force: true });
  });

  test('Check lists every cache with its status and size', async () => {
    await window.locator('#devCheckBtn').click();
    const rows = window.locator('#devList .devRow');
    await expect(rows).toHaveCount(7, { timeout: 15000 });
    const npm = window.locator('#devList .devRow[data-id="npm"]');
    await expect(npm.locator('.pill')).toHaveText('Found');
    await expect(npm.locator('.num').nth(1)).toHaveText('512 KB');
    await expect(window.locator('#devList .devRow[data-id="uv"] .pill')).toHaveText('Nothing found');
    await expect(window.locator('#devList .devRow[data-id="temp"] .num').nth(0)).toHaveText('1');
    await expect(window.locator('#devTotal')).toHaveText('Selected: 896 KB');
    await expect(window.locator('#devCleanBtn')).toBeEnabled();
  });

  test('Clean selected frees the chosen caches only', async () => {
    await window.locator('#devList .devRow[data-id="pip"] input').uncheck();
    await expect(window.locator('#devTotal')).toHaveText('Selected: 640 KB');
    await window.locator('#devCleanBtn').click();

    await expect(window.locator('#devStatus')).toHaveText('Freed 640 KB.', { timeout: 15000 });
    await expect(window.locator('#devList .devRow[data-id="npm"] .pill')).toHaveText('Cleaned');
    await expect(window.locator('#devList .devRow[data-id="npm"] .devFreed')).toHaveText('512 KB');
    await expect(window.locator('#devList .devRow[data-id="pip"] .pill')).toHaveText('Found');
    expect(fs.existsSync(path.join(fx, 'local', 'npm-cache', '_cacache', 'content', 'pkg.tgz'))).toBe(false);
    expect(fs.existsSync(path.join(fx, 'local', 'pip', 'Cache', 'wheels', 'x.whl'))).toBe(true);
    expect(fs.existsSync(path.join(fx, 'temp', 'old.log'))).toBe(false);
    expect(fs.existsSync(path.join(fx, 'temp', 'today.log'))).toBe(true);
  });
});
