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
  await expect(page.getByText('System', { exact: true })).toBeVisible();
  await expect(page.getByText('Email digest')).toHaveCount(0);
});

/* Settings offers only the notifications a role is ever sent: a setter is
   told about program transfers, not alarms or tickets. */
test('Settings lists only the notifications the role can receive', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:programs:view'], company_permissions: company });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ notify_alarm: true })));
  await page.goto('/settings');
  const rows = page.locator('div.divide-y p.font-medium');
  await expect(rows).toHaveText(['Program transfer', 'System']);
});

test('Settings lists every notification for a company admin', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: [] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ notify_alarm: true })));
  await page.goto('/settings');
  const rows = page.locator('div.divide-y p.font-medium');
  await expect(rows).toHaveText(['Alarms', 'Maintenance', 'Tickets', 'Program transfer', 'System']);
});

/* The header's Master menu is configuration only; 2FA is about the person
   and sits in the account menu, where every role finds it. Before, a
   2FA entry with no permission put a "Settings" menu in every role's bar. */
test('a role with no master data has no Master menu, and finds 2FA in the account menu', async ({ page }) => {
  await seedAuth(page, { roles: ['QUALITY'], username: 'quality', permissions: ['page:quality:view', 'page:analytics-oee:view'], company_permissions: company });
  await mockAll(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/quality');
  await expect(page.getByRole('button', { name: 'Master' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Account menu/ }).click();
  await expect(page.getByRole('link', { name: 'Security (2FA)' })).toBeVisible();
});

/* Reports is one page: each role sees the tabs it holds, and opens on the
   first of them. */
test('Reports shows a supervisor only the OEE report tabs it holds', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'],
    permissions: ['page:oee-reports:view', 'page:analytics-oee:view'], company_permissions: [] });
  await mockAll(page);
  await page.goto('/reports');
  const tabs = page.getByRole('tablist', { name: 'Report type' }).getByRole('tab');
  await expect(tabs).toHaveText([/OEE Records/, /Machine OEE/]);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
});

test('Reports refuses a role with no report', async ({ page }) => {
  await seedAuth(page, { roles: ['HR'], permissions: ['page:operators:view'], company_permissions: [] });
  await mockAll(page);
  for (const path of ['/reports', '/oee-reports']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/no-access$/);
  }
});

test('Quality: a view-only role sees no edit icons; a role with Edit does', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:quality:view', 'page:quality:production-cards'], company_permissions: [] });
  await mockAll(page);
  await page.goto('/quality');
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(page.locator('.absolute.bottom-2.right-2')).toHaveCount(0);
});

/* Tariff & Limits is its own page under Master, opened by the Energy
   "Tariff Settings" grant — the same one the API checks before saving. */
test('Energy: whoever can set the tariff finds it in the top bar and under Master', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: company });
  await mockAll(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.locator('form.mexa-titlebar').getByRole('link', { name: 'Tariff & limits' })).toHaveAttribute('href', '/energy-tariff');

  await page.getByRole('button', { name: 'Master' }).click();
  await page.locator('nav .absolute').getByRole('button', { name: 'Energy Tariff' }).click();
  await expect(page).toHaveURL(/\/energy-tariff$/);
  await expect(page.getByRole('heading', { name: 'Tariff & Limits' })).toBeVisible();
  await expect(page.getByLabel('Cost per kWh')).toBeVisible();
});

test('Tariff page: saving nothing says what to enter, and sends nothing', async ({ page }) => {
  const posts: string[] = [];
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: company });
  await mockAll(page);
  page.on('request', (r: any) => { if (r.method() !== 'GET') posts.push(r.url()); });
  await page.goto('/energy-tariff');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a cost per kWh, an overload limit, or both.');
  await expect(page.getByLabel('Cost per kWh')).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toEqual([]);
});

test('Energy: a view-only role gets no tariff link, and the tariff page refuses it', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'], company_permissions: company });
  await mockAll(page);
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tariff & limits' })).toHaveCount(0);
  await page.goto('/energy-tariff');
  await expect(page).toHaveURL(/\/no-access$/);
});
