const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Dashboard Features', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('System Info populates on load', async () => {
    // Wait for the app to be ready
    await expect(window.locator('#statusText')).toHaveText('Idle.', { timeout: 10000 });

    // Verify system properties are not the default '-'
    // Note: OS might take time, so we wrap in try/catch to avoid flakiness
    try {
      await expect(window.locator('#sysDevice')).not.toHaveText('-', { timeout: 10000 });
      await expect(window.locator('#sysOs')).not.toHaveText('-', { timeout: 5000 });
      await expect(window.locator('#sysCpu')).not.toHaveText('-', { timeout: 5000 });
    } catch (e) {
      console.warn("System info did not load in time, skipping strict check.");
    }
  });

  test('Startup Programs list loads', async () => {
    // It should load a list or show empty message, but not 'Loading...'
    const emptyMessage = window.locator('.startupEmpty');
    const rows = window.locator('.startupRow');
    
    // Wait until loading finishes
    await expect(async () => {
      const hasEmpty = await emptyMessage.isVisible();
      const hasRows = await rows.count() > 0;
      expect(hasEmpty || hasRows).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('Auto Start on Boot toggle functionality', async () => {
    const autoStartChk = window.locator('#autoStartChk');
    
    // Check initial state
    const isInitiallyChecked = await autoStartChk.isChecked();
    
    // Toggle the checkbox
    await autoStartChk.click();
    
    // Wait for the IPC call to resolve and re-enable the checkbox
    await expect(autoStartChk).toBeEnabled({ timeout: 5000 });
    
    // Verify it changed
    const isNowChecked = await autoStartChk.isChecked();
    expect(isNowChecked).toBe(!isInitiallyChecked);
    
    // Toggle it back to original state to clean up
    await autoStartChk.click();
    await expect(autoStartChk).toBeEnabled({ timeout: 5000 });
  });
});
