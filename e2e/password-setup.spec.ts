import { test, expect } from '@playwright/test';

// All API calls are local fixtures: these checks never send an email or
// change a real customer's password.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [] } }));
});

test('invitation opens password setup; mismatched passwords cannot be submitted', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/auth/reset-password', route => { requests++; return route.fulfill({ json: { success: true } }); });
  await page.goto('/reset-password/invitation-test-token?mode=setup');
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm password', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel('Confirm password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your password is set');
  expect(requests).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
});

test('reset password keeps its own wording and sends the token with the chosen password once', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/auth/reset-password', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ token: 'reset-test-token', password: 'new-password-123' });
    await waiting;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/reset-password/reset-test-token');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  expect(requests).toBe(1);
  release();
  await expect(page.getByRole('status')).toContainText('Your password has been reset');
  await expect(page.locator('form')).toHaveCount(0);
});

test('expired invitation shows a usable way to request another link', async ({ page }) => {
  await page.route('**/api/auth/reset-password', route => route.fulfill({ status: 400, json: { message: 'Invalid or expired token' } }));
  await page.goto('/reset-password/expired-test-token?mode=setup');
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid or expired token');
  await expect(page.getByRole('button', { name: 'Set password', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Request a new link' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test('forgot password explains the email and shows the generic response', async ({ page }) => {
  await page.route('**/api/auth/forgot-password', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'admin@example.test' });
    await route.fulfill({ json: { success: true, message: 'If the account exists, a reset link has been sent' } });
  });
  await page.goto('/forgot-password');
  await expect(page.getByText(/The link is valid for 15 minutes/)).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByRole('button', { name: 'Send Reset Link' }).click();
  await expect(page.getByRole('status')).toContainText('If the account exists');
  await expect(page.getByRole('status')).toContainText('inbox or spam');
});

test('setup form fits a phone and password visibility controls remain independent', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/reset-password/mobile-test-token?mode=setup');
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Show new password', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByText('Confirm password is required.')).toBeVisible();
});
