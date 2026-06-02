const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test.describe('Static App Contracts', () => {
  test('package test script runs Playwright', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.test).toBe('playwright test');
  });

  test('Electron entry point remains index.js', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.main).toBe('index.js');
  });

  test('build package includes core UI files without license configuration', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.build.files).toEqual(expect.arrayContaining([
      'index.html',
      'styles.css',
      'renderer.js',
      'preload.js',
      'main.js',
    ]));
    expect(pkg.build.files).not.toContain('config.js');
  });

  test('activation and payment model is removed', () => {
    const source = [
      read('index.html'),
      read('renderer.js'),
      read('preload.js'),
      read('main.js'),
    ].join('\n');

    for (const removed of [
      'activateModal',
      'paymentModal',
      'license:verify',
      'license:activatePaid',
      'RAZORPAY_KEY_ID',
      'verifyOnlineLicense',
      'licenseState',
    ]) {
      expect(source).not.toContain(removed);
    }
  });

  test('full version badge is present and purchase button is removed', () => {
    const html = read('index.html');
    expect(html).toContain('<div id="proBadge" class="proBadge pro">PRO</div>');
    expect(html).not.toContain('id="goProBtn"');
  });

  test('boot auto-clean launches stay hidden and run without activation gating', () => {
    const main = read('main.js');
    const utils = read('utils.js');

    expect(utils).toContain('--autoclean --hidden');
    expect(main).toContain('function isBackgroundLaunch');
    expect(main).toContain('hasProcessArg(argv, "--hidden") || hasProcessArg(argv, "--autoclean")');
    expect(main).toContain('const shouldStayHidden = isBackgroundLaunch()');
    expect(main).toContain('if (mainWindow && !shouldStayHidden) mainWindow.show()');
    expect(main).not.toContain('Auto-clean is a Pro feature.');
  });

  test('HTML loads only the local renderer script', () => {
    const html = read('index.html');
    expect(html).toContain('<script src="renderer.js"></script>');
    expect(html).not.toContain('tailwind');
    expect(html).not.toContain('qrcode.min.js');
  });
});
