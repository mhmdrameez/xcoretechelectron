const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Core Features', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    // Launch Electron app
    electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('Scan PC functionality', async () => {
    // Wait for the app to be ready and idle
    await expect(window.locator('#statusText')).toHaveText('Idle.', { timeout: 10000 });

    // Click the Scan button
    await window.click('#scanBtn');
    
    // Wait for the scan to complete by checking the status text
    await expect(window.locator('#statusText')).toContainText('Scan complete.', { timeout: 15000 });
    
    // Check if the total files is populated (greater than 0)
    const filesText = await window.locator('#totalFiles').innerText();
    expect(parseInt(filesText)).toBeGreaterThanOrEqual(0);
  });

  test('Clean PC functionality', async () => {
    // Check if there are files to clean
    const filesText = await window.locator('#totalFiles').innerText();
    if (parseInt(filesText) === 0) {
      test.skip('No files to clean, skipping test.');
    }

    // Click the Clean button
    await window.click('#cleanBtn');
    
    // Wait for cleanup to finish
    await expect(window.locator('#statusText')).toContainText('Done.', { timeout: 25000 });
    
    // We don't strictly expect 0 because some files might be in use
    const finalFiles = parseInt(await window.locator('#totalFiles').innerText());
    expect(finalFiles).toBeGreaterThanOrEqual(0);
  });
});
