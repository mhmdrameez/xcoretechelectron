const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Technician Mode Features', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('RAM Boost functionality', async () => {
    // Check if the RAM Boost button is visible and not disabled
    const ramBtn = window.locator('#techRamBtn');
    
    // We can only click it if the lock overlay isn't blocking it.
    // In dev mode or activated pro mode, the overlay might be hidden.
    const lockOverlay = window.locator('#techOverlay');
    // Wait for the app to finish initialization
    await window.waitForTimeout(2000);
    const isLocked = await lockOverlay.evaluate((node) => window.getComputedStyle(node).pointerEvents !== 'none' && !node.classList.contains('hidden'));
    
    if (isLocked) {
      test.skip('Technician mode is locked. Please activate Pro to run this test.');
      return;
    }

    await ramBtn.click();

    const progEl = window.locator('#techRamProg');
    // Wait for completion
    await expect(progEl).toContainText('✔ Freed', { timeout: 20000 });
  });

  test('Auto Fix functionality', async () => {
    const autoBtn = window.locator('#techAutoBtn');
    
    const lockOverlay = window.locator('#techOverlay');
    const isLocked = await lockOverlay.evaluate((node) => window.getComputedStyle(node).pointerEvents !== 'none' && !node.classList.contains('hidden'));
    if (isLocked) {
      test.skip('Technician mode is locked.');
      return;
    }

    await autoBtn.click();
    
    const progEl = window.locator('#techAutoProg');
    await expect(progEl).toContainText('✔ Services & Caches Repaired', { timeout: 25000 });
  });

  test('Internet Fix functionality', async () => {
    // This will trigger the backend commands and log the raw output to Playwright console
    const netBtn = window.locator('#techInternetBtn');
    await netBtn.click();
    
    const progEl = window.locator('#techInternetProg');
    await expect(progEl).toContainText('✔ Reset', { timeout: 30000 });
  });
});
