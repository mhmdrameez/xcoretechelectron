// Cross-platform logic, tested by simulating each OS (runs on any machine).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { createPlatform, macVersionFromDarwin } = require('../platform.js');
const { buildLaunchAgentPlist, buildAutostartDesktop } = require('../utils.js');
const {
  parseDesktopEntry, desktopEnabled, setDesktopHidden, parseLaunchctlDisabled, parseRegEntries,
} = require('../startupItems.js');
const { parseDf } = require('../largeFiles.js');
const { createDevCaches } = require('../devCaches.js');

const home = path.join(os.tmpdir(), 'fake-home');

test.describe('Platform rules', () => {
  test('names and Quick fixes per OS', () => {
    expect(createPlatform({ platform: 'win32', home }).techTools).toEqual(['internet', 'ram', 'autofix']);
    expect(createPlatform({ platform: 'darwin', home }).name).toBe('macOS');
    expect(createPlatform({ platform: 'linux', home }).techTools).toEqual(['internet']);
  });

  test('junk targets point at each OS\'s caches', () => {
    const mac = createPlatform({ platform: 'darwin', home, env: {} }).junkTargets();
    expect(mac).toContain(path.join(home, 'Library', 'Caches', 'Google', 'Chrome', 'Default', 'Cache'));
    const linux = createPlatform({ platform: 'linux', home, env: {} }).junkTargets();
    expect(linux).toContain(path.join(home, '.cache', 'thumbnails'));
    const xdg = createPlatform({ platform: 'linux', home, env: { XDG_CACHE_HOME: '/data/cache' } }).junkTargets();
    expect(xdg).toContain(path.join('/data/cache', 'thumbnails'));
    const win = createPlatform({ platform: 'win32', home, env: { TEMP: 'C:\\T', LOCALAPPDATA: 'C:\\L' } }).junkTargets();
    expect(win[0]).toBe('C:\\T');
    expect(win).toContain('C:\\Windows\\Temp');
  });

  test('system folders are protected on every OS', () => {
    const win = createPlatform({ platform: 'win32', home });
    expect(win.isUnsafePath('C:\\Windows\\System32\\drivers\\x.sys')).toBe(true);
    expect(win.isUnsafePath('C:\\Program Files\\App\\a.dll')).toBe(true);
    expect(win.isUnsafePath('C:\\Users\\me\\Downloads\\big.iso')).toBe(false);

    const mac = createPlatform({ platform: 'darwin', home });
    expect(mac.isUnsafePath('/System/Library/Kernels/kernel')).toBe(true);
    expect(mac.isUnsafePath('/Applications/Xcode.app/Contents/x')).toBe(true);
    expect(mac.isUnsafePath('/Library/Fonts/a.ttf')).toBe(true);
    expect(mac.isUnsafePath('/Users/me/Library/Caches/big.bin')).toBe(false);
    expect(mac.isUnsafePath('/Users/me/Movies/film.mov')).toBe(false);
    expect(mac.isUnsafePath('/')).toBe(true);
    expect(mac.isUnsafePath('/private/var/folders/ab/xyz/T/old.tmp')).toBe(false);
    expect(mac.isUnsafePath('/private/var/db/x')).toBe(true);

    const linux = createPlatform({ platform: 'linux', home });
    expect(linux.isUnsafePath('/usr/lib/libc.so')).toBe(true);
    expect(linux.isUnsafePath('/var/lib/docker/overlay2/x')).toBe(true);
    expect(linux.isUnsafePath('/home/me/Videos/a.mkv')).toBe(false);
    expect(linux.isUnsafePath('/usrdata/a')).toBe(false); // prefix match is per folder
  });

  test('whole-disk search skips system folders and other mounts at "/"', () => {
    const mac = createPlatform({ platform: 'darwin', home });
    expect(mac.isSkippedDir('/', 'System')).toBe(true);
    expect(mac.isSkippedDir('/', 'Volumes')).toBe(true);
    expect(mac.isSkippedDir('/', 'Users')).toBe(false);
    expect(mac.isSkippedDir('/Users/me', 'System')).toBe(false);

    const linux = createPlatform({ platform: 'linux', home });
    expect(linux.isSkippedDir('/', 'proc')).toBe(true);
    expect(linux.isSkippedDir('/', 'media')).toBe(true);
    expect(linux.isSkippedDir('/', 'home')).toBe(false);
    expect(linux.isSkippedFile('/', 'swapfile')).toBe(true);
    expect(linux.isSkippedFile('/home/me', 'swapfile')).toBe(false);
  });

  test('paths compare case-insensitively only on Windows and macOS', () => {
    expect(createPlatform({ platform: 'win32', home }).pathKey('C:\\A\\B')).toBe('c:\\a\\b');
    expect(createPlatform({ platform: 'darwin', home }).pathKey('/Users/A')).toBe('/users/a');
    expect(createPlatform({ platform: 'linux', home }).pathKey('/home/A')).toBe('/home/A');
  });

  test('macOS version from the Darwin kernel version', () => {
    expect(macVersionFromDarwin('20.6.0')).toBe('11');
    expect(macVersionFromDarwin('23.4.0')).toBe('14');
    expect(macVersionFromDarwin('24.1.0')).toBe('15');
    expect(macVersionFromDarwin('25.0.0')).toBe('26');
    expect(macVersionFromDarwin('19.6.0')).toBe('10.15');
  });
});

test.describe('Start at login files', () => {
  test('macOS LaunchAgent runs the app hidden with an auto-clean', () => {
    const plist = buildLaunchAgentPlist(['/Applications/X & Y.app/Contents/MacOS/X', '--autoclean', '--hidden']);
    expect(plist).toContain('<key>Label</key><string>com.xcoretech.diskcleaner</string>');
    expect(plist).toContain('<string>/Applications/X &amp; Y.app/Contents/MacOS/X</string>');
    expect(plist).toContain('<string>--autoclean</string>');
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
  });

  test('Linux autostart entry quotes paths with spaces', () => {
    const d = buildAutostartDesktop(['/home/me/My Apps/XCoreTech.AppImage', '--autoclean', '--hidden']);
    expect(d).toContain('Exec="/home/me/My Apps/XCoreTech.AppImage" --autoclean --hidden');
    expect(d.startsWith('[Desktop Entry]\n')).toBe(true);
  });
});

test.describe('Startup list parsing', () => {
  test('reads Linux autostart entries and their on/off state', () => {
    const e = parseDesktopEntry('[Desktop Entry]\nName=Slack\nExec=/usr/bin/slack -u\nHidden=false\n[Desktop Action New]\nName=Other\n');
    expect(e.Name).toBe('Slack');
    expect(e.Exec).toBe('/usr/bin/slack -u');
    expect(desktopEnabled(e)).toBe(true);
    expect(desktopEnabled({ Hidden: 'true' })).toBe(false);
    expect(desktopEnabled({ 'X-GNOME-Autostart-enabled': 'false' })).toBe(false);
  });

  test('switching a Linux entry off and on edits only Hidden in the main group', () => {
    const src = '[Desktop Entry]\nName=Slack\nExec=slack\nX-GNOME-Autostart-enabled=true\n[Desktop Action X]\nHidden=keep\n';
    const off = setDesktopHidden(src, true);
    expect(parseDesktopEntry(off).Hidden).toBe('true');
    expect(parseDesktopEntry(off)['X-GNOME-Autostart-enabled']).toBe('false');
    expect(off).toContain('[Desktop Action X]\nHidden=keep');
    const on = setDesktopHidden(off, false);
    expect(desktopEnabled(parseDesktopEntry(on))).toBe(true);
  });

  test('reads which macOS agents are switched off', () => {
    const m = parseLaunchctlDisabled('disabled services = {\n\t"com.foo.agent" => disabled\n\t"com.bar" => enabled\n\t"com.old" => true\n}\n');
    expect(m).toEqual({ 'com.foo.agent': true, 'com.bar': false, 'com.old': true });
  });

  test('reads Windows Run key values', () => {
    const r = parseRegEntries('\r\nHKEY_CURRENT_USER\\...\\Run\r\n    OneDrive    REG_SZ    "C:\\OneDrive.exe" /background\r\n');
    expect(r).toEqual([{ name: 'OneDrive', value: '"C:\\OneDrive.exe" /background' }]);
  });
});

test.describe('Drive listing', () => {
  test('parses df output, including mount points with spaces', () => {
    const d = parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n' +
      '/dev/sda2 100 40 60 40% /\n/dev/sdb1 2000 0 2000 0% /media/me/USB Stick\n');
    expect(d).toEqual([
      { mount: '/', size: 100 * 1024, free: 60 * 1024 },
      { mount: '/media/me/USB Stick', size: 2000 * 1024, free: 2000 * 1024 },
    ]);
  });
});

test.describe('Developer cache locations on macOS and Linux', () => {
  let root;
  test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcoretech-plat-')); });
  test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function put(rel, size) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(size));
  }
  const noTools = { which: async () => null, run: async () => ({ ok: false, stdout: '', stderr: '', error: '' }) };

  test('finds macOS caches in ~/.npm and ~/Library/Caches', async () => {
    put('.npm/_cacache/a', 1000);
    put('Library/Caches/pip/http/b', 2000);
    put('Library/Caches/ms-playwright/.links/x', 0);
    const dev = createDevCaches({ platform: 'darwin', env: {}, userProfile: root, tempDir: path.join(root, 'tmp'), ...noTools });
    const byId = Object.fromEntries((await dev.detect()).map((t) => [t.id, t]));
    expect(byId.npm).toMatchObject({ status: 'found', bytes: 1000, path: path.join(root, '.npm', '_cacache') });
    expect(byId.pip).toMatchObject({ status: 'found', bytes: 2000 });
    expect(byId.playwright.path).toBe(path.join(root, 'Library', 'Caches', 'ms-playwright'));
  });

  test('finds Linux caches in ~/.cache and the XDG data folder', async () => {
    put('.npm/_cacache/a', 1000);
    put('.cache/pip/b', 3000);
    put('.cache/uv/c', 4000);
    put('.local/share/pnpm/store/v3/d', 5000);
    const dev = createDevCaches({ platform: 'linux', env: {}, userProfile: root, tempDir: path.join(root, 'tmp'), ...noTools });
    const byId = Object.fromEntries((await dev.detect()).map((t) => [t.id, t]));
    expect(byId.pip).toMatchObject({ status: 'found', bytes: 3000 });
    expect(byId.uv).toMatchObject({ status: 'found', bytes: 4000, path: path.join(root, '.cache', 'uv') });
    expect(byId.pnpm).toMatchObject({ status: 'needs-tool', bytes: 5000 });
  });

  test('finds conda on Linux through bin/conda', async () => {
    put('miniconda3/pkgs/p.tar.bz2', 700);
    put('miniconda3/bin/conda', 1);
    const calls = [];
    const dev = createDevCaches({
      platform: 'linux', env: {}, userProfile: root, tempDir: path.join(root, 'tmp'),
      which: async () => null, run: async (c) => { calls.push(c); return { ok: true, stdout: '', stderr: '', error: '' }; },
    });
    const byId = Object.fromEntries((await dev.detect()).map((t) => [t.id, t]));
    expect(byId.conda).toMatchObject({ status: 'found', cleanable: true });
    await dev.clean(['conda']);
    expect(calls).toContain(`"${path.join(root, 'miniconda3', 'bin', 'conda')}" clean --packages --tarballs --yes`);
  });
});
