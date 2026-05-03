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

  test('shows Razorpay checkout details', async () => {
    await openPaymentModal();
    await expect(window.locator('.paymentPanelTitle')).toHaveText('Secure Razorpay Checkout');
    await expect(window.locator('.paymentPanel')).toContainText('XCoreTech Lifetime Pro');
  });

  test('shows the exact lifetime amount', async () => {
    await openPaymentModal();
    await expect(window.locator('.amountRow').first()).toContainText('₹399.00 INR');
  });

  test('opens Razorpay checkout with the lifetime payment options', async () => {
    await openPaymentModal();
    await window.locator('#razorpayCheckoutBtn').click();
    const state = await window.evaluate(() => ({
      opened: window.__razorpayOpened,
      options: window.__razorpayOptions,
    }));
    expect(state.opened).toBe(true);
    expect(state.options.key).toBe('rzp_test_PLAYWRIGHT12345');
    expect(state.options.amount).toBe(39900);
    expect(state.options.currency).toBe('INR');
    expect(state.options.name).toBe('XCoreTech Software');
  });

  test('successful Razorpay callback activates Pro state', async () => {
    await openPaymentModal();
    await window.locator('#razorpayCheckoutBtn').click();
    await window.evaluate(() => window.__razorpayOptions.handler({ razorpay_payment_id: 'pay_PLAYWRIGHT12345' }));
    await expect(window.locator('#proBadge')).toHaveText('PRO');

    const activations = await window.evaluate(() => window.__paidLicenseActivations);
    expect(activations).toHaveLength(1);
    expect(activations[0].razorpay_payment_id).toBe('pay_PLAYWRIGHT12345');
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

  test('payment support action is visible and labeled clearly', async () => {
    await openPaymentModal();
    await expect(window.locator('#paymentEmailBtn')).toHaveText('Contact Support: xcoretech@yahoo.com');
  });

  test('support button calls the external-link bridge', async () => {
    await openPaymentModal();

    await window.locator('#paymentEmailBtn').click();

    const links = await window.evaluate(() => window.__openedExternalLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('mailto:xcoretech@yahoo.com');
    expect(links[0]).toContain('Razorpay');
  });
});
