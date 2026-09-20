import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The nine analytics dashboards are individually grantable in Manage Access
 * (page:analytics-<name>). Three things have to hold on the tenant side, and
 * all three were missing when every dashboard hung off one shared key:
 *
 *   1. the menu offers only the dashboards the company was granted,
 *   2. a dashboard that was not granted cannot be opened by typing its URL,
 *   3. a page the company has does not imply Export or Tariff settings —
 *      those are separate grants, and their buttons stay hidden without them.
 */

const NINE = ['factory', 'maintenance', 'preventive', 'periodic', 'alarms', 'downtime', 'operators', 'oee', 'energy'];
const roleHoldsEverything = [
  'page:dashboard:view',
  ...NINE.map(m => `page:analytics-${m}:view`),
  'page:analytics-energy:export', 'page:analytics-energy:settings'
];

async function mockApi(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
}

async function openDashboardsMenu(page: any) {
  await page.getByRole('button', { name: 'Dashboards' }).first().click();
  return page.locator('nav .absolute');
}

test('menu offers only the dashboards the company was granted', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything,
    company_permissions: ['page:analytics-oee:view', 'page:analytics-alarms:view']
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/oee-dashboard');

  const menu = await openDashboardsMenu(page);
  await expect(menu.getByRole('button', { name: 'OEE' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Alarms' })).toBeVisible();

  // every other dashboard is gone — including Live, which is a different grant
  for (const label of ['Live Dashboard', 'Factory Overall', 'Maintenance', 'Preventive',
                       'Periodic', 'Downtime', 'Operators', 'Energy']) {
    await expect(menu.getByRole('button', { name: label, exact: true }), `${label} must be hidden`).toHaveCount(0);
  }
  await page.screenshot({ path: 'mexa-dashboard-menu-restricted.png' });
});

test('a dashboard that was not granted cannot be opened by URL', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything,
    company_permissions: ['page:analytics-oee:view']
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });

  for (const path of ['/energy-dashboard', '/factory', '/maintenance-dashboard', '/preventive-maintenance',
                      '/periodic-maintenance', '/alarm-report', '/downtime-analysis', '/operator-performance']) {
    await page.goto(path);
    await expect(page, `${path} must be refused`).toHaveURL(/\/no-access/);
  }

  await page.goto('/oee-dashboard');
  await expect(page).toHaveURL(/\/oee-dashboard/);
});

test('each dashboard needs its own grant — the role alone is not enough', async ({ page }) => {
  // the role holds Energy, the company was never given it
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: ['page:analytics-energy:view'],
    company_permissions: ['page:analytics-oee:view']
  });
  await mockApi(page);
  await page.goto('/energy-dashboard');
  await expect(page).toHaveURL(/\/no-access/);
});

test('a company with no grants at all is unrestricted, as before', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything, company_permissions: []
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/oee-dashboard');
  const menu = await openDashboardsMenu(page);
  for (const label of ['Live Dashboard', 'Factory Overall', 'Operators', 'Energy']) {
    await expect(menu.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

test('Energy: view alone hides Export and Tariff settings', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything,
    company_permissions: ['page:analytics-energy:view']
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/energy-dashboard');

  await expect(page.getByText('Machine Detail')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Export the filtered list' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tariff & limits' })).toHaveCount(0);
});

test('Energy: export granted shows Export but still not Tariff settings', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything,
    company_permissions: ['page:analytics-energy:view', 'page:analytics-energy:export']
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/energy-dashboard');

  await expect(page.getByRole('group', { name: 'Export the filtered list' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tariff & limits' })).toHaveCount(0);
});

test('Energy: all three grants show everything', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MANAGER'], user_type: 'MANAGER',
    permissions: roleHoldsEverything,
    company_permissions: ['page:analytics-energy:view', 'page:analytics-energy:export', 'page:analytics-energy:settings']
  });
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/energy-dashboard');

  await expect(page.getByRole('group', { name: 'Export the filtered list' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tariff & limits' })).toBeVisible();
});
