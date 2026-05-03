const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/electronApp');

test.describe('Activation Modal Extra Coverage', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  test('activation modal is hidden on first load', async () => {
    await expect(window.locator('#activateModal')).toHaveCount(1);
    await expect(window.locator('#activateModal')).not.toHaveClass(/visible/);
  });

  test('Activate Pro button opens the activation modal', async () => {
    await window.locator('#goProBtn').click();
    await expect(window.locator('#activateModal')).toHaveClass(/visible/);
    await expect(window.locator('#activateModal .modalTitle')).toContainText('Activate Pro Version');
  });

  test('license key input receives focus when modal opens', async () => {
    await window.locator('#goProBtn').click();
    const focusedId = await window.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focusedId).toBe('licenseKeyInput');
  });

  test('Later button closes activation modal', async () => {
    await window.locator('#goProBtn').click();
    await window.locator('#closeActivateBtn').click();
    await expect(window.locator('#activateModal')).not.toHaveClass(/visible/);
  });

  test('clicking activation backdrop closes activation modal', async () => {
    await window.locator('#goProBtn').click();
    await window.locator('#activateModal').click({ position: { x: 5, y: 5 } });
    await expect(window.locator('#activateModal')).not.toHaveClass(/visible/);
  });

  test('empty license submit shows validation message', async () => {
    await window.locator('#goProBtn').click();
    await window.locator('#activateBtn').click();
    await expect(window.locator('#licenseError')).toHaveText('Please enter a license key.');
  });

  test('reopening activation modal clears previous validation and input', async () => {
    await window.locator('#goProBtn').click();
    await window.locator('#licenseKeyInput').fill('BAD-KEY');
    await window.locator('#activateBtn').click();
    await window.locator('#closeActivateBtn').click();
    await window.locator('#goProBtn').click();
    await expect(window.locator('#licenseKeyInput')).toHaveValue('');
    await expect(window.locator('#licenseError')).toHaveText('');
  });

  test('locked pro controls are disabled until activation', async () => {
    const isLocked = await window.locator('#autoStartContainer').evaluate((node) => node.classList.contains('proLockedFeature'));
    test.skip(!isLocked, 'App is already activated as Pro.');

    await expect(window.locator('#autoStartChk')).toBeDisabled();
    await expect(window.locator('#startupOverlay')).not.toHaveClass(/hidden/);
  });
});
