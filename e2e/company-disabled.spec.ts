import { test, expect } from '@playwright/test';
import { seedAuth } from './fixtures/auth';

/*
 * S&T disabling a company stops everyone in it. The server refuses them;
 * these check the person is told why, in plain words, rather than seeing
 * "Your account has been deactivated" — their own account is fine.
 */

const COMPANY_OFF = "Your company's access has been turned off. Contact S&T to turn it back on.";

test('sign-in for a disabled company says the company is off', async ({ page }) => {
  await page.route('**/api/auth/login', r => r.fulfill({
    status: 403, contentType: 'application/json',
    body: JSON.stringify({ success: false, code: 'COMPANY_DISABLED', message: COMPANY_OFF })
  }));
  await page.goto('/login');
  await page.getByPlaceholder(/email/i).first().fill('admin@pacpl.test');
  await page.getByPlaceholder(/password/i).first().fill('Passw0rd!');
  await page.getByRole('button', { name: /sign in|login/i }).click();

  await expect(page.getByText(COMPANY_OFF)).toBeVisible();
  await expect(page.getByText(/Your account has been deactivated/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login/);
  await page.screenshot({ path: 'mexa-login-company-disabled.png', fullPage: true });
});

test('an open session is signed out, and the sign-in page says why', async ({ page }) => {
  await seedAuth(page);
  // every request is refused as the middleware does; the refresh is refused too
  await page.route('**/api/**', r => r.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ code: 'COMPANY_DISABLED', message: COMPANY_OFF })
  }));
  await page.route('**/api/auth/refresh', r => r.fulfill({
    status: 403, contentType: 'application/json',
    body: JSON.stringify({ success: false, code: 'COMPANY_DISABLED', message: COMPANY_OFF })
  }));
  await page.route('**/api/auth/logout', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(COMPANY_OFF)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();

  // shown once — a reload doesn't repeat it
  await page.reload();
  await expect(page.getByText(COMPANY_OFF)).toHaveCount(0);
});
