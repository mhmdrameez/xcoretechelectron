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

  test('build package includes renderer, styles, preload, and HTML', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.build.files).toEqual(expect.arrayContaining([
      'index.html',
      'styles.css',
      'renderer.js',
      'preload.js',
      'main.js',
      'engagement.js',
    ]));
  });

  test('preload exposes the external link bridge', () => {
    expect(read('preload.js')).toContain('openExternal');
    expect(read('preload.js')).toContain('app:openExternal');
  });

  test('main process only allows supported external link protocols', () => {
    const main = read('main.js');
    expect(main).toContain('app:openExternal');
    expect(main).toContain('https:\\/\\/|mailto:|upi:\\/\\/');
  });

  test('payment modal markup exists with required controls', () => {
    const html = read('index.html');
    for (const id of [
      'paymentModal',
      'closePaymentBtn',
      'sellerUpiIdDisplay',
      'copyUpiId',
      'qrcodeContainer',
      'upiDeepLinkBtn',
      'paymentEmailBtn',
      'paymentWhatsappBtn',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('payment constants are present in renderer', () => {
    const renderer = read('renderer.js');
    expect(renderer).toContain('muhammedrameez2000-7@okaxis');
    expect(renderer).toContain('PAYMENT_AMOUNT = "399"');
    expect(renderer).toContain('XCoreTech Software');
    expect(renderer).toContain('xcoretech@yahoo.com');
    expect(renderer).toContain('https://wa.me/919446960834');
  });

  test('payment modal styles include responsive mobile handling', () => {
    const css = read('styles.css');
    expect(css).toContain('.paymentModal');
    expect(css).toContain('.paymentCard');
    expect(css).toContain('@media (max-width: 520px)');
  });

  test('free boot background mode shows a daily Pro reminder instead of auto-cleaning', () => {
    const main = read('main.js');
    expect(main).toContain('showFreeProReminder("boot_background_free")');
    expect(main).toContain('Background mode active. Auto-clean is a Pro feature.');
    expect(main).toContain('Notification.isSupported');
    expect(main).toContain('markFreeProReminderShown');

    const freeBranch = main.slice(
      main.indexOf('sendStatus("Background mode active. Auto-clean is a Pro feature.")'),
      main.indexOf('} else if (isHidden && !licenseState.isPro)')
    );
    expect(freeBranch).not.toContain('runAutoClean');
    expect(freeBranch).not.toContain('cleaner().cleanFiles');
  });

  test('boot auto-clean launches stay hidden', () => {
    const main = read('main.js');
    const utils = read('utils.js');

    expect(utils).toContain('--autoclean --hidden');
    expect(main).toContain('function isBackgroundLaunch');
    expect(main).toContain('hasProcessArg(argv, "--hidden") || hasProcessArg(argv, "--autoclean")');
    expect(main).toContain('const shouldStayHidden = isBackgroundLaunch()');
    expect(main).toContain('if (mainWindow && !shouldStayHidden) mainWindow.show()');

    const secondInstanceBranch = main.slice(
      main.indexOf('app.on("second-instance"'),
      main.indexOf('app.whenReady().then')
    );
    expect(secondInstanceBranch).toContain('if (isBackgroundLaunch(argv))');
    expect(secondInstanceBranch.indexOf('return;')).toBeLessThan(secondInstanceBranch.indexOf('showMainWindow();'));
  });

  test('HTML loads only the local renderer script', () => {
    const html = read('index.html');
    expect(html).toContain('<script src="renderer.js"></script>');
    expect(html).not.toContain('tailwind');
    expect(html).not.toContain('qrcode.min.js');
  });
});
