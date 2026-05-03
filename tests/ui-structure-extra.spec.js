const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/electronApp');

test.describe('UI Structure Extra Coverage', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  test('primary header actions are visible', async () => {
    await expect(window.locator('#goProBtn')).toBeVisible();
    await expect(window.locator('#scanBtn')).toBeVisible();
    await expect(window.locator('#cleanBtn')).toBeVisible();
  });

  test('clean button starts disabled before scan results', async () => {
    await expect(window.locator('#cleanBtn')).toBeDisabled();
  });

  test('dashboard metric cards start from zero state', async () => {
    await expect(window.locator('#totalFiles')).toHaveText('0');
    await expect(window.locator('#totalSize')).toHaveText('0 B');
    await expect(window.locator('#progressPct')).toHaveText('0%');
  });

  test('performance impact cards render stable default values', async () => {
    await expect(window.locator('#impactTotalCleaned')).toBeVisible();
    await expect(window.locator('#impactRuns')).toBeVisible();
    await expect(window.locator('#impactAvgTime')).toBeVisible();
    await expect(window.locator('#impactSpeedGain')).toBeVisible();
  });

  test('Technician Mode section exposes all expected tools', async () => {
    await expect(window.locator('#techInternetBtn')).toHaveText('Run Fix');
    await expect(window.locator('#techRamBtn')).toHaveText('Optimize');
    await expect(window.locator('#techAutoBtn')).toHaveText('Repair');
    await expect(window.locator('#techFullBtn')).toHaveText('One-Click Fix');
  });

  test('startup section has refresh button and list container', async () => {
    await expect(window.locator('#startupSection')).toBeVisible();
    await expect(window.locator('#startupRefreshBtn')).toBeVisible();
    await expect(window.locator('#startupList')).toBeVisible();
  });

  test('trusted users badge becomes visible during initialization', async () => {
    await expect(window.locator('#trustedBadge')).toBeVisible({ timeout: 10000 });
    await expect(window.locator('#trustedCount')).toContainText('Users');
  });

  test('footer support and version information is visible', async () => {
    await expect(window.locator('.footer')).toContainText('Support: +91 7907858474');
    await expect(window.locator('.footer')).toContainText('Version 1.3.6');
  });

  test('busy overlay is hidden while idle', async () => {
    const display = await window.locator('#busyOverlay').evaluate((node) => window.getComputedStyle(node).display);
    expect(display).toBe('none');
  });

  test('update banner controls exist and start without restart button', async () => {
    await expect(window.locator('#updateBanner')).toHaveCount(1);
    await expect(window.locator('#updateMsg')).toHaveCount(1);
    await expect(window.locator('#updatePct')).toHaveCount(1);
    await expect(window.locator('#updateBtn')).toHaveCSS('display', 'none');
  });
});
