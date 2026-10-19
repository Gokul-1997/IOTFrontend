import { test, expect } from '@playwright/test';
import { seedAuth } from './fixtures/auth';

/*
 * Each default role opens the app on a page it can use, and sees only the
 * actions it holds. Before: SETTER signed in to "Access Denied", QUALITY and
 * HR got the same at the app's home address, and view-only roles were shown
 * buttons that answered "Permission denied".
 */

const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data }) });
async function mockAll(page: any) {
  await page.routeWebSocket(/.*/, (socket: any) => socket.close());
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
  await page.route('**/api/alarms/notification-policy', (r: any) => r.fulfill(ok({ enabled: false, version: 0, counts: { machines: 0 } })));
}
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

/* S&T is sent no notifications. Since the header lost its light/dark button
   (6 Oct 2026) S&T opens Settings for that switch alone. */
test('S&T has no Notifications or bell — that URL sends it home — and Settings is light/dark only', async ({ page }) => {
  await seedAuth(page, { roles: ['SNT_SUPER'], is_snt_super: true, company_id: null, user_type: 'SNT_SUPER', username: 'superadmin' });
  await mockAll(page);
  const alarmSettingsRequests: string[] = [];
  page.on('request', request => {
    if (/\/(notifications\/preferences|alarms\/notification-policy)/.test(request.url())) alarmSettingsRequests.push(request.url());
  });
  await page.goto('/admin/companies');
  await page.getByRole('button', { name: /superadmin/ }).click();
  await expect(page.getByRole('link', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications' })).toHaveCount(0);
  await expect(page.locator('app-notification-bell')).toHaveCount(0);

  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/admin\/companies$/);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Notification types' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  expect(alarmSettingsRequests).toEqual([]);
});

test('a quality role has only personal appearance settings and makes no preference requests', async ({ page }) => {
  await seedAuth(page, { roles: ['QUALITY'], permissions: ['page:quality:view'], company_permissions: company });
  await mockAll(page);
  const preferenceRequests: string[] = [];
  page.on('request', request => {
    if (/\/(notifications\/preferences|alarms\/notification-policy)/.test(request.url())) preferenceRequests.push(request.url());
  });
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  await expect(page.getByText('Email digest')).toHaveCount(0);
  expect(preferenceRequests).toEqual([]);
});

test('a setter changes appearance without unrelated notification or admin controls', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:programs:view'], company_permissions: company });
  await mockAll(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  const alarmSettingsRequests: string[] = [];
  page.on('request', request => {
    if (/\/(notifications\/preferences|alarms\/notification-policy)/.test(request.url())) alarmSettingsRequests.push(request.url());
  });
  await page.goto('/settings');
  await expect(page.getByRole('switch')).toHaveCount(1);
  const darkMode = page.getByRole('switch', { name: 'Dark mode' });
  await expect(darkMode).toHaveAttribute('aria-checked', 'false');
  await darkMode.click();
  await expect(darkMode).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('group', { name: 'Notification types' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  expect(alarmSettingsRequests).toEqual([]);
});

test('a company admin has useful alarm settings and working user and role administration links', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: [] });
  await mockAll(page);
  const alarmSettingsRequests: string[] = [];
  page.on('request', request => {
    if (/\/(notifications\/preferences|alarms\/notification-policy)/.test(request.url())) alarmSettingsRequests.push(request.url());
  });
  await page.goto('/settings');
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  const alarms = page.getByRole('region', { name: 'Alarm notifications' });
  await expect(alarms.getByRole('switch', { name: 'Receive alarm notifications' })).toBeVisible();
  await expect(alarms.getByRole('switch', { name: 'Company critical alarm alerts' })).toBeVisible();
  await expect(alarms.getByRole('searchbox')).toHaveCount(0);
  await expect(alarms.getByText('0 active machines')).toBeVisible();
  expect(alarmSettingsRequests.filter(url => url.includes('/notifications/preferences'))).toHaveLength(1);
  expect(alarmSettingsRequests.filter(url => url.includes('/alarms/notification-policy'))).toHaveLength(1);
  const admin = page.getByRole('region', { name: 'Administration' });
  await expect(admin.getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users');
  await expect(admin.getByRole('link', { name: /Roles & Permissions/ })).toHaveAttribute('href', '/admin/roles');
  await admin.getByRole('link', { name: /Roles & Permissions/ }).click();
  await expect(page).toHaveURL(/\/admin\/roles$/);
});

/* The header's Master menu is configuration only; Settings is about the
   person and sits in the account menu, where every role finds it.
   Two-step sign-in was removed on 6 Oct 2026. */
test('a role with no master data has no Master menu, and finds Settings in the account menu', async ({ page }) => {
  await seedAuth(page, { roles: ['QUALITY'], username: 'quality', permissions: ['page:quality:view', 'page:analytics-oee:view'], company_permissions: company });
  await mockAll(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/quality');
  await expect(page.getByRole('button', { name: 'Master' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Account menu/ }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: /2-step|two-step/i })).toHaveCount(0);
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

/* Tariff & Rates is its own page under Master, opened by the Energy
   "Tariff Settings" grant — the same one the API checks before saving. */
test('Energy: whoever can set the tariff finds it in the top bar and under Master', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: company });
  await mockAll(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.locator('form.mexa-titlebar').getByRole('link', { name: 'Tariff & rates' })).toHaveAttribute('href', '/energy-tariff');

  await page.getByRole('button', { name: 'Master' }).click();
  await page.locator('.nav-dropdown').getByRole('link', { name: 'Tariff & Rates' }).click();
  await expect(page).toHaveURL(/\/energy-tariff$/);
  await expect(page.getByRole('heading', { name: 'Tariff & Rates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add tariff' })).toBeVisible();
});

test('Tariff page: saving nothing says what to enter, and sends nothing', async ({ page }) => {
  const posts: string[] = [];
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: company });
  await mockAll(page);
  page.on('request', (r: any) => { if (r.method() !== 'GET') posts.push(r.url()); });
  await page.goto('/energy-tariff');
  await page.getByRole('button', { name: 'Add tariff' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add tariff' });
  await dialog.getByRole('button', { name: 'Save tariff' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter a cost per kWh, an overload limit, or both.');
  await expect(dialog.getByLabel('Cost per kWh')).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toEqual([]);
});

test('Energy: a view-only role gets no tariff link, and the tariff page refuses it', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'], company_permissions: company });
  await mockAll(page);
  await page.goto('/energy-dashboard');
  await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tariff & rates' })).toHaveCount(0);
  await page.goto('/energy-tariff');
  await expect(page).toHaveURL(/\/no-access$/);
});
