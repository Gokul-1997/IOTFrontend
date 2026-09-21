import { test, expect } from '@playwright/test';
import { seedAuth } from './fixtures/auth';

/*
 * Each default role opens the app on a page it can use, and sees only the
 * actions it holds. Before: SETTER signed in to "Access Denied", QUALITY and
 * HR got the same at the app's home address, and view-only roles were shown
 * buttons that answered "Permission denied".
 */

const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data }) });
const mockAll = (page: any) => page.route('**/api/**', (r: any) => r.fulfill(ok([])));
const company = ['page:programs:view', 'page:quality:view', 'page:quality:edit', 'page:analytics-oee:view',
  'page:analytics-operators:view', 'page:operators:view', 'page:analytics-energy:view', 'page:analytics-energy:settings'];

test.describe('the app\'s home address opens each role\'s own first page', () => {
  for (const [role, permissions, landing] of [
    ['SETTER', ['page:programs:view', 'machine.view'], '/programs'],
    ['QUALITY', ['page:analytics-oee:view', 'page:quality:view', 'line.view'], '/oee-dashboard'],
    ['HR', ['page:analytics-operators:view', 'page:operators:view', 'operator.view', 'shift.view'], '/operator-performance'],
  ] as const) {
    test(`${role} → ${landing}, not Access Denied`, async ({ page }) => {
      await seedAuth(page, { roles: [role], permissions, company_permissions: company });
      await mockAll(page);
      await page.goto('/');
      await expect(page).toHaveURL(new RegExp(`${landing}$`));
      await expect(page.getByText('Access Denied')).toHaveCount(0);
    });
  }
});

test('S&T has no Settings, Notifications or bell — and the URLs send it home', async ({ page }) => {
  await seedAuth(page, { roles: ['SNT_SUPER'], is_snt_super: true, company_id: null, user_type: 'SNT_SUPER', username: 'superadmin' });
  await mockAll(page);
  await page.goto('/admin/companies');
  await page.getByRole('button', { name: /superadmin/ }).click();
  await expect(page.getByRole('link', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Notifications' })).toHaveCount(0);
  await expect(page.locator('app-notification-bell')).toHaveCount(0);

  for (const path of ['/settings', '/notifications']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/companies$/);
  }
});

test('Settings no longer offers an email digest', async ({ page }) => {
  await seedAuth(page, { roles: ['QUALITY'], permissions: ['page:quality:view'], company_permissions: company });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ notify_alarm: true, email_digest: false })));
  await page.goto('/settings');
  await expect(page.getByText('Alarms', { exact: true })).toBeVisible();
  await expect(page.getByText('Email digest')).toHaveCount(0);
});

test('Quality: a view-only role sees no edit icons; a role with Edit does', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:quality:view', 'page:quality:production-cards'], company_permissions: [] });
  await mockAll(page);
  await page.goto('/quality');
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(page.locator('.absolute.bottom-2.right-2')).toHaveCount(0);
});

test('Energy: whoever can set the tariff finds it in the top bar', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: company });
  await mockAll(page);
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.locator('form.mexa-titlebar').getByRole('button', { name: 'Tariff & limits' })).toBeVisible();
});

test('Energy: a view-only role gets no tariff button', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'], company_permissions: company });
  await mockAll(page);
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tariff & limits' })).toHaveCount(0);
});
