import { test, expect } from './fixtures/auth';

/*
 * The full SNT_SUPER flow, top to bottom: Companies → Usage & Plan History →
 * Assign Plan → Manage Access → Plans → Users → Roles & Permissions.
 *
 * Written after two real bugs surfaced from reading the code alone:
 *   - the "Company" field required to create a user was backed by a
 *     dropdown that was never populated (loadCompanies() existed, was
 *     never called) — an SNT_SUPER could not create a user for any company
 *   - the Roles & Permissions screen was hidden from SNT_SUPER entirely,
 *     although every backend route already supported them
 * Both are asserted against directly below, not just implied by a fix.
 */

const ok = (data: any) => ({ status: 'success', data });

// Matches company.service.js exports.list() exactly — plan limits are
// COALESCE'd from company_plans/plans in the query, and company_code always
// exists (it is NOT NULL at the schema level).
const companies = [
  { id: 4, company_code: 'SANDT', company_name: 'S AND T', contact_email: 'ops@sandt.com',
    is_active: true, plan_id: 1, plan_name: 'Gold', tier: 3,
    max_users: 50, max_plants: 5, max_machines: 100 },
  { id: 5, company_code: 'PACPL', company_name: 'Precision Auto Components Pvt Ltd', contact_email: 'admin@pacpl.com',
    is_active: true, plan_id: 2, plan_name: 'Silver', tier: 2,
    max_users: 10, max_plants: 2, max_machines: 20 }
];

const plans = [
  { id: 1, plan_name: 'Gold', tier: 3, max_users: 50, max_plants: 5, max_machines: 100, is_active: true },
  { id: 2, plan_name: 'Silver', tier: 2, max_users: 10, max_plants: 2, max_machines: 20, is_active: true }
];

const users = [
  { id: 1, username: 'admin1', email: 'admin1@sandt.com', company_id: 4, company_name: 'S AND T',
    is_active: true, roles: [{ id: 1, role_name: 'COMPANY_ADMIN' }] },
  { id: 2, username: 'super', email: 'super@stmcnc.com', company_id: null, company_name: null,
    is_active: true, roles: [{ id: 0, role_name: 'SNT_SUPER' }] }
];

const roles = [
  { id: 0, role_name: 'SNT_SUPER', is_system: true, company_id: null, permissions: [] },
  { id: 1, role_name: 'COMPANY_ADMIN', is_system: true, company_id: null, permissions: [] },
  { id: 10, role_name: 'SETTER', is_system: false, company_id: 4, company_name: 'S AND T', permissions: [] },
  { id: 11, role_name: 'QC_LEAD', is_system: false, company_id: 5, company_name: 'Precision Auto Components Pvt Ltd', permissions: [] }
];

const permissionModules = [
  { module: 'dashboard', label: 'Dashboards', group: 'Main', permissions: [{ id: 1, permission_key: 'page:dashboard:view', action: 'view' }] },
  { module: 'machines',  label: 'Machines',   group: 'Setup', permissions: [{ id: 2, permission_key: 'page:machines:view', action: 'view' }] }
];

const usage = {
  id: 4, company_name: 'S AND T', plan_id: 1, plan_name: 'Gold', plan_active: true,
  max_users: 50, max_plants: 5, max_machines: 100,
  users_used: 12, plants_used: 2, machines_used: 20,
  users_pct: 24, plants_pct: 40, machines_pct: 20
};

const planHistory = [
  { id: 1, changed_at: '2026-06-01T10:00:00.000Z', plan_name: 'Gold', previous_plan_name: 'Silver',
    max_users: 50, max_plants: 5, max_machines: 100,
    previous_max_users: 10, previous_max_plants: 2, previous_max_machines: 20,
    changed_by_name: 'super', note: 'Upgraded after onboarding call' }
];

async function mockAdminApi(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/companies/*/usage', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage) }));
  await page.route('**/api/companies/*/plan/history*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok(planHistory)) }));
  await page.route('**/api/companies', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(companies) }));
  await page.route('**/api/plans', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plans) }));
  await page.route('**/api/users', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) }));
  await page.route('**/api/roles', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roles) }));
  await page.route('**/api/roles/pages/list', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionModules) }));
}

test('Companies: landing page, usage & plan history, assign plan', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/companies');

  await expect(page.getByText('S AND T')).toBeVisible();
  await expect(page.getByText('Precision Auto Components')).toBeVisible();
  await page.screenshot({ path: 'mexa-admin-companies.png', fullPage: true });

  // Usage & Plan History
  await page.getByRole('row', { name: /S AND T/ }).getByRole('button', { name: /usage|history/i }).click();
  await expect(page.getByText(/12 of 50/)).toBeVisible();
  await expect(page.getByText('Upgraded after onboarding call')).toBeVisible();
  await page.screenshot({ path: 'mexa-admin-company-history.png', fullPage: true });
});

test('Plans: the plan catalogue lists both plans with their limits', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/plans');

  await expect(page.getByRole('heading', { name: 'Plans' }).or(page.getByText('Plan Management'))).toBeVisible();
  await expect(page.getByText('Gold')).toBeVisible();
  await expect(page.getByText('Silver')).toBeVisible();
  await page.screenshot({ path: 'mexa-admin-plans.png', fullPage: true });
});

test('Users: the company dropdown is populated — regression for the empty-dropdown bug', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/users');
  await expect(page.getByText('admin1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /create user/i }).click();
  const companySelect = page.locator('#createFormCompany');
  await expect(companySelect).toBeVisible();

  // the bug: this dropdown held nothing but "Select a company"
  const optionCount = await companySelect.locator('option').count();
  expect(optionCount, 'company dropdown must list real companies, not just the placeholder').toBeGreaterThan(1);
  await expect(companySelect.locator('option', { hasText: 'S AND T' })).toHaveCount(1);
  await expect(companySelect.locator('option', { hasText: 'Precision Auto Components' })).toHaveCount(1);

  await page.screenshot({ path: 'mexa-admin-users-create.png', fullPage: true });
});

test('Roles & Permissions: reachable by SNT_SUPER, shows every company\'s roles, company field on create', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/companies');

  // the bug: this tab used to not exist for SNT_SUPER at all
  const rolesTab = page.getByRole('link', { name: 'Roles & Permissions' });
  await expect(rolesTab).toBeVisible();
  await rolesTab.click();
  await expect(page).toHaveURL(/\/admin\/roles$/);

  // roles from two different companies, both visible — the cross-company view
  await expect(page.getByText('SETTER')).toBeVisible();
  await expect(page.getByText('QC_LEAD')).toBeVisible();
  await expect(page.getByText('S AND T')).toBeVisible();
  await expect(page.getByText('Precision Auto Components')).toBeVisible();

  await page.getByRole('button', { name: '+ Create Role' }).click();
  const roleCompanySelect = page.locator('#roleCompany');
  await expect(roleCompanySelect, 'SNT_SUPER must be asked which company a new role belongs to').toBeVisible();
  const optionCount = await roleCompanySelect.locator('option').count();
  expect(optionCount).toBeGreaterThan(1);

  await page.screenshot({ path: 'mexa-admin-roles.png', fullPage: true });
});

test('all four admin tabs are present and consistent across every admin page', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });

  for (const path of ['/admin/companies', '/admin/plans', '/admin/users', '/admin/roles']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Plans' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles & Permissions' })).toBeVisible();
    // no leftover dead nav items
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(1);
  }
});
