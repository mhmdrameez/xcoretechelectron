const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers/electronApp');

test.describe('Payment Modal', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  async function openPaymentModal() {
    await window.locator('#goProBtn').click();
    await expect(window.locator('#activateModal')).toHaveClass(/visible/);
    await window.locator('#buyKeyBtn').click();
    await expect(window.locator('#paymentModal')).toHaveClass(/visible/);
  }

  test('is present but hidden on first load', async () => {
    await expect(window.locator('#paymentModal')).toHaveCount(1);
    await expect(window.locator('#paymentModal')).not.toHaveClass(/visible/);
  });

  test('opens from Purchase Key button inside activation modal', async () => {
    await openPaymentModal();
    await expect(window.locator('.paymentTitle')).toContainText('₹399 / Lifetime Pro');
  });

  test('keeps activation modal open behind the payment modal', async () => {
    await openPaymentModal();
    await expect(window.locator('#activateModal')).toHaveClass(/visible/);
    await expect(window.locator('#paymentModal')).toHaveClass(/visible/);
  });

  test('shows seller UPI ID in both seller notice and copy row', async () => {
    await openPaymentModal();
    await expect(window.locator('#sellerUpiIdNotice')).toHaveText('muhammedrameez2000-7@okaxis');
    await expect(window.locator('#sellerUpiIdDisplay')).toHaveText('muhammedrameez2000-7@okaxis');
  });

  test('shows the exact lifetime amount', async () => {
    await openPaymentModal();
    await expect(window.locator('.amountRow')).toContainText('₹399.00 INR');
  });

  test('renders a QR code image for the UPI payment URI', async () => {
    await openPaymentModal();
    const qr = window.locator('#qrcodeContainer img');
    await expect(qr).toBeVisible({ timeout: 10000 });
    await expect(qr).toHaveAttribute('alt', 'UPI payment QR code');
    await expect(qr).toHaveAttribute('src', /api\.qrserver\.com/);
  });

  test('copy UPI button gives immediate user feedback', async () => {
    await openPaymentModal();
    const copyButton = window.locator('#copyUpiId');
    await copyButton.click();
    await expect(copyButton).toHaveText(/Copied|Copy failed/);
  });

  test('close button closes only the payment modal', async () => {
    await openPaymentModal();
    await window.locator('#closePaymentBtn').click();
    await expect(window.locator('#paymentModal')).not.toHaveClass(/visible/);
    await expect(window.locator('#activateModal')).toHaveClass(/visible/);
  });

  test('clicking the payment backdrop closes the payment modal', async () => {
    await openPaymentModal();
    await window.locator('#paymentModal').click({ position: { x: 5, y: 5 } });
    await expect(window.locator('#paymentModal')).not.toHaveClass(/visible/);
  });

  test('Escape closes the payment modal', async () => {
    await openPaymentModal();
    await window.keyboard.press('Escape');
    await expect(window.locator('#paymentModal')).not.toHaveClass(/visible/);
  });

  test('payment proof actions are visible and labeled clearly', async () => {
    await openPaymentModal();
    await expect(window.locator('#paymentEmailBtn')).toHaveText('Email: xcoretech@yahoo.com');
    await expect(window.locator('#paymentWhatsappBtn')).toHaveText('WhatsApp Business: +91 9446960834');
  });

  test('UPI, email, and WhatsApp buttons call the external-link bridge', async () => {
    await openPaymentModal();

    await window.locator('#upiDeepLinkBtn').click();
    await window.locator('#paymentEmailBtn').click();
    await window.locator('#paymentWhatsappBtn').click();

    const links = await window.evaluate(() => window.__openedExternalLinks);
    expect(links).toHaveLength(3);
    expect(links[0]).toContain('upi://pay');
    expect(links[0]).toContain('pa=muhammedrameez2000-7%40okaxis');
    expect(links[1]).toContain('mailto:xcoretech@yahoo.com');
    expect(links[2]).toBe('https://wa.me/919446960834');
  });
});
