# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core.spec.js >> Core Features >> Clean PC functionality
- Location: tests\core.spec.js:33:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#statusText')
Expected substring: "Done."
Received string:    "Running in background. Click tray icon to reopen."

Call log:
  - Expect "toContainText" with timeout 25000ms
  - waiting for locator('#statusText')
    21 × locator resolved to <span id="statusText">Cleaning…</span>
       - unexpected value "Cleaning…"
    2 × locator resolved to <span id="statusText">Running in background. Click tray icon to reopen.</span>
      - unexpected value "Running in background. Click tray icon to reopen."

```

# Test source

```ts
  1  | const { _electron: electron } = require('playwright');
  2  | const { test, expect } = require('@playwright/test');
  3  | 
  4  | test.describe('Core Features', () => {
  5  |   let electronApp;
  6  |   let window;
  7  | 
  8  |   test.beforeAll(async () => {
  9  |     // Launch Electron app
  10 |     electronApp = await electron.launch({ args: ['.'], env: { ...process.env, PLAYWRIGHT_TEST: '1' } });
  11 |     window = await electronApp.firstWindow();
  12 |   });
  13 | 
  14 |   test.afterAll(async () => {
  15 |     await electronApp.close();
  16 |   });
  17 | 
  18 |   test('Scan PC functionality', async () => {
  19 |     // Wait for the app to be ready and idle
  20 |     await expect(window.locator('#statusText')).toHaveText('Idle.', { timeout: 10000 });
  21 | 
  22 |     // Click the Scan button
  23 |     await window.click('#scanBtn');
  24 |     
  25 |     // Wait for the scan to complete by checking the status text
  26 |     await expect(window.locator('#statusText')).toContainText('Scan complete.', { timeout: 15000 });
  27 |     
  28 |     // Check if the total files is populated (greater than 0)
  29 |     const filesText = await window.locator('#totalFiles').innerText();
  30 |     expect(parseInt(filesText)).toBeGreaterThanOrEqual(0);
  31 |   });
  32 | 
  33 |   test('Clean PC functionality', async () => {
  34 |     // Check if there are files to clean
  35 |     const filesText = await window.locator('#totalFiles').innerText();
  36 |     if (parseInt(filesText) === 0) {
  37 |       test.skip('No files to clean, skipping test.');
  38 |     }
  39 | 
  40 |     // Click the Clean button
  41 |     await window.click('#cleanBtn');
  42 |     
  43 |     // Wait for cleanup to finish
> 44 |     await expect(window.locator('#statusText')).toContainText('Done.', { timeout: 25000 });
     |                                                 ^ Error: expect(locator).toContainText(expected) failed
  45 |     
  46 |     // We don't strictly expect 0 because some files might be in use
  47 |     const finalFiles = parseInt(await window.locator('#totalFiles').innerText());
  48 |     expect(finalFiles).toBeGreaterThanOrEqual(0);
  49 |   });
  50 | });
  51 | 
```