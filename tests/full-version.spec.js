const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/electronApp');

test.describe('Full Version', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  test('shows the PRO badge without activation or purchase UI', async () => {
    await expect(window.locator('#proBadge')).toHaveText('PRO');
    await expect(window.locator('#goProBtn')).toHaveCount(0);
    await expect(window.locator('#activateModal')).toHaveCount(0);
    await expect(window.locator('#paymentModal')).toHaveCount(0);
  });

  test('full-version controls are available immediately', async () => {
    await expect(window.locator('#autoStartChk')).toBeEnabled();
    await expect(window.locator('#startupOverlay')).toHaveCount(0);
    await expect(window.locator('#techOverlay')).toHaveCount(0);
  });
});
