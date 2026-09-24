import { test, expect } from './fixtures/auth';

async function mockApi(page: import('@playwright/test').Page) {
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [], meta: { total: 0 } } }));
}

test('Gokul navigation opens management pages and remembers the selected theme', async ({ authedPage: page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light'); });
  await mockApi(page);
  await page.goto('/dashboard');
  await expect(page).toHaveTitle('Gokul | Industrial Intelligence');
  await expect(page.getByRole('link', { name: 'Gokul home' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\bSTM\b|\bMEXA\b/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Machines', exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('phone navigation closes on Escape and route selection without horizontal overflow', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  const opener = page.getByRole('button', { name: 'Open navigation' });
  await opener.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeVisible();
  await opener.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Machines', exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('restricted users only see permitted navigation', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    user.roles = ['OPERATOR'];
    user.permissions = ['page:quality'];
    localStorage.setItem('user', JSON.stringify(user));
  });
  await page.goto('/quality');
  await expect(page.getByRole('button', { name: 'Dashboards', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Quality', exact: true })).toBeVisible();
});

test('machine detail renders API measurements when the socket is unavailable', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.route('**/api/dashboard/live/1', route => route.fulfill({ json: {
    data: {
      machine: { machine_serial_no: 'CELL-01' }, operator: { operator_name: 'Gokul' },
      job: { part_name: 'Housing', target_qty: 100, achieved_qty: 42 },
      production: { run_time: '02:30:00', idle_time: '00:30:00' },
      oee: { availability: 85, performance: 80, quality: 99, oee: 67.3 },
      quality: { accepted: 41, rejected: 1 },
      live: { machine_status: 'RUNNING', parts_count: 42, spindle_load: 50, feed_rate: 1500 }
    }
  } }));
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    user.permissions = ['page:dashboard:live:spindle-speed-chart', 'page:dashboard:live:feed-override-chart'];
    localStorage.setItem('user', JSON.stringify(user));
  });
  await page.goto('/dashboard/live/1');
  await expect(page.getByRole('heading', { name: /CELL-01/ })).toBeVisible();
  await expect(page.locator('.output-number')).toContainText('42');
  await expect(page.locator('.oee-number')).toContainText('67.3');
  await expect(page.locator('.time-values')).toContainText('02h 30m 00s');
  await expect(page.locator('.machine-panel')).toBeVisible();
  await expect(page.locator('.telemetry-panel').filter({ hasText: 'Spindle load' })).toContainText('50.0');
  await expect(page.locator('.telemetry-panel').filter({ hasText: 'Feed rate' })).toContainText('1,500');
  await expect(page.locator('.machine-tabs')).toHaveCount(0);
});

test('password recovery sends the email and renders confirmation', async ({ page }) => {
  await page.route('**/api/auth/forgot-password', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'gokul@example.com' });
    await route.fulfill({ json: { message: 'Reset link sent.' } });
  });
  await page.goto('/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill('gokul@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('Reset link sent.');
});

test('reset password validates matching values and completes the recovery flow', async ({ page }) => {
  await page.route('**/api/auth/reset-password', async route => {
    expect(route.request().postDataJSON()).toEqual({ token: 'test-reset-token', password: 'new-password-123' });
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/reset-password/test-reset-token');
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm password', { exact: true }).fill('mismatch-123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password reset successful.');
  await expect(page).toHaveURL(/\/login$/);
});

test('direct nested links load deployment configuration from the application root', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  const configRequest = page.waitForRequest(request => request.url().endsWith('/config.js'));
  await page.goto('/reset-password/deep-link-check');
  expect(new URL((await configRequest).url()).pathname).toBe('/config.js');
  await expect(page.getByRole('heading', { name: 'Reset password.' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
