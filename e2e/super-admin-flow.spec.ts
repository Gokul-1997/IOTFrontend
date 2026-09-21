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
 *     although every backend route already supported them. (Since reversed
 *     on purpose: each company now owns and manages its roles, and the page
 *     had nothing left for S&T — see the test below.)
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

  // S&T adds a company's admin; the admin creates everyone else
  await page.getByRole('button', { name: '+ Add Company Admin' }).click();
  const companySelect = page.locator('#createFormCompany');
  await expect(companySelect).toBeVisible();

  // the bug: this dropdown held nothing but "Select a company"
  const optionCount = await companySelect.locator('option').count();
  expect(optionCount, 'company dropdown must list real companies, not just the placeholder').toBeGreaterThan(1);
  await expect(companySelect.locator('option', { hasText: 'S AND T' })).toHaveCount(1);
  await expect(companySelect.locator('option', { hasText: 'Precision Auto Components' })).toHaveCount(1);

  // the role is fixed and shown, not chosen
  await expect(page.locator('#createFormRole')).toHaveCount(0);
  await expect(page.locator('.ui-dialog').getByText('Company Admin', { exact: true })).toBeVisible();

  await page.screenshot({ path: 'mexa-admin-users-create.png', fullPage: true });
});

/* The AWS model: S&T sets up a company's admin; the company admin gives out
   every other role. So S&T's request carries COMPANY_ADMIN, whatever else
   the form held. */
test('Users: S&T creates a company admin, with the Company Admin role', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  const posted: any[] = [];
  await page.route('**/api/users', (r: any) => {
    if (r.request().method() === 'POST') {
      posted.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 50 }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) });
  });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '+ Add Company Admin' }).click();

  await page.locator('#createFormCompany').selectOption({ label: 'S AND T' });
  const dialog = page.locator('.ui-dialog');
  await dialog.getByPlaceholder('e.g., john_doe').fill('newadmin');
  await dialog.getByPlaceholder('user@company.com').fill('newadmin@sandt.com');
  await dialog.getByPlaceholder('Minimum 8 characters').fill('Passw0rd!');
  await dialog.getByRole('button', { name: 'Create User' }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].role_ids).toEqual([1]);          // COMPANY_ADMIN's id in the fixture
  expect(posted[0].company_id).toBe(4);
});

/* Each company owns its roles and its admin manages them; S&T creates the
   company and its admin and sets Manage Access. The Roles page had nothing
   left for S&T, so it is not offered — and the URL sends S&T home. */
test('Roles & Permissions is not on the S&T side — no tab, and the URL goes to Companies', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/companies');
  await expect(page.getByRole('link', { name: 'Companies' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roles & Permissions' })).toHaveCount(0);

  await page.goto('/admin/roles');
  await expect(page).toHaveURL(/\/admin\/companies$/);
});

test('S&T\'s three admin tabs are present and consistent across every S&T admin page', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });

  for (const path of ['/admin/companies', '/admin/plans', '/admin/users']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Plans' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles & Permissions' })).toHaveCount(0);
    // no leftover dead nav items
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(1);
  }
});

/*
 * Manage Access — what S&T decides a company has paid for.
 *
 * Two regressions worth naming:
 *   - if loading the company's CURRENT grants failed, the modal swallowed it,
 *     showed every box unchecked and left Save live: pressing it replaced the
 *     company's real access with nothing.
 *   - saving with nothing selected looks like "revoke everything" but the
 *     frontend reads an empty grant list as unrestricted — it granted everything.
 */
const catalogue = [
  { module: 'dashboard', label: 'Dashboards', group: 'Main', permissions: [
      { id: 1, permission_key: 'page:dashboard:view', action: 'view', actionLabel: 'View' },
      { id: 2, permission_key: 'page:dashboard:export', action: 'export', actionLabel: 'Export' } ] },
  { module: 'reports', label: 'Reports', group: 'Main', permissions: [
      { id: 3, permission_key: 'page:reports:view', action: 'view', actionLabel: 'View' } ] },
  { module: 'programs', label: 'Program Transfer', group: 'Setup', permissions: [
      { id: 4, permission_key: 'page:programs:view', action: 'view', actionLabel: 'View' },
      { id: 5, permission_key: 'page:programs:transfer', action: 'transfer', actionLabel: 'Transfer' } ] }
];

/** The company holds 1, 2, 3 — and one legacy key the modal cannot show. */
const heldByCompany = [
  { id: 1, permission_key: 'page:dashboard:view' },
  { id: 2, permission_key: 'page:dashboard:export' },
  { id: 3, permission_key: 'page:reports:view' },
  { id: 901, permission_key: 'machine.view' }
];

async function mockAccessApi(page: any, opts: { failCurrent?: boolean } = {}) {
  await mockAdminApi(page);
  await page.route('**/api/plans/permissions', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(catalogue) }));

  const state = { failCurrent: !!opts.failCurrent, puts: [] as any[] };
  await page.route('**/api/companies/4/permissions', (route: any) => {
    if (route.request().method() === 'PUT') {
      state.puts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ company_id: 4, permission_count: 2, granted: 0, revoked: 1, revoked_from_roles: 2 }) });
    }
    if (state.failCurrent) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(heldByCompany) });
  });
  return state;
}

const openAccess = async (page: any) => {
  await page.goto('/admin/companies');
  await page.getByRole('row', { name: /S AND T/ }).getByRole('button', { name: 'Access' }).click();
};

test('Manage Access: opens with the company\'s current grants ticked, Save waits for a change', async ({ sntSuperPage: page }) => {
  await mockAccessApi(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);

  await expect(page.getByText('Manage Access:')).toBeVisible();
  // 3 page grants — the legacy machine.view the modal cannot show is not counted
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Access' })).toBeDisabled();
  await page.screenshot({ path: 'mexa-admin-access.png', fullPage: true });
});

test('Manage Access: a revoke says what it will do, then sends only what remains', async ({ sntSuperPage: page }) => {
  const state = await mockAccessApi(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();

  // take Reports away: the "View" boxes run Dashboards, Reports, Program Transfer
  await page.locator('label', { hasText: 'View' }).nth(1).locator('input').uncheck();

  await expect(page.getByText(/Removing 1/)).toBeVisible();
  await expect(page.getByText(/roles in this company that hold them lose them too/)).toBeVisible();
  await page.screenshot({ path: 'mexa-admin-access-revoke.png', fullPage: true });

  await page.getByRole('button', { name: 'Save Access' }).click();

  await expect(page.getByText(/removed from 2 role grants/)).toBeVisible();
  expect(state.puts).toHaveLength(1);
  // page ids only — the legacy key was never in the working set
  expect(state.puts[0].permission_ids.sort()).toEqual([1, 2]);
});

test('Manage Access: saving nothing is blocked, because empty means unrestricted', async ({ sntSuperPage: page }) => {
  const state = await mockAccessApi(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();

  // untick every module
  for (const box of await page.locator('.ui-dialog-lg input[type=checkbox]').all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await expect(page.getByText('0 permission(s) selected')).toBeVisible();
  await expect(page.getByText(/treated as unrestricted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Access' })).toBeDisabled();
  expect(state.puts).toHaveLength(0);
});

test('Manage Access: if the current grants cannot be loaded, nothing is editable and Save cannot wipe them', async ({ sntSuperPage: page }) => {
  const state = await mockAccessApi(page, { failCurrent: true });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);

  // the bug: this failure was swallowed, every box showed unchecked, Save was live
  await expect(page.getByText("Could not load this company's access")).toBeVisible();
  await expect(page.locator('.ui-dialog-lg input[type=checkbox]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Access' })).toBeDisabled();
  expect(state.puts).toHaveLength(0);
  await page.screenshot({ path: 'mexa-admin-access-failed.png', fullPage: true });

  // and it recovers once the request works
  state.failCurrent = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();
  await expect(page.locator('.ui-dialog-lg input[type=checkbox]').first()).toBeVisible();
});


/*
 * The nine analytics dashboards used to share one key with the live dashboard,
 * so S&T could not sell a company "OEE but not Energy". Each is now its own
 * module under an Analytics group, and the modules that have separate Export or
 * Tariff settings carry those as their own boxes.
 */
const analytics = [
  ['factory', 'Factory Overall', ['view']],
  ['maintenance', 'Maintenance Dashboard', ['view']],
  ['preventive', 'Preventive Maintenance', ['view']],
  ['periodic', 'Periodic Maintenance', ['view', 'export']],
  ['alarms', 'Alarm Report', ['view', 'export']],
  ['downtime', 'Downtime Analysis', ['view', 'export']],
  ['operators', 'Operator Performance', ['view', 'export']],
  ['oee', 'OEE Dashboard', ['view', 'export']],
  ['energy', 'Energy Dashboard', ['view', 'export', 'settings']]
] as const;

const actionLabel: Record<string, string> = { view: 'View', export: 'Export', settings: 'Tariff Settings' };
let nextId = 100;
const analyticsModules = analytics.map(([key, label, actions]) => ({
  module: `analytics-${key}`, label, group: 'Analytics',
  permissions: actions.map(a => ({ id: nextId++, permission_key: `page:analytics-${key}:${a}`, action: a, actionLabel: actionLabel[a] }))
}));
const idOf = (key: string) => analyticsModules.flatMap(m => m.permissions).find(p => p.permission_key === key)!.id;

test('Manage Access: the nine dashboards are separate modules under Analytics, each with its own actions', async ({ sntSuperPage: page }) => {
  const state = await mockAccessApi(page);
  // company holds the classic dashboard plus OEE and all three Energy boxes
  const held = [
    { id: 1, permission_key: 'page:dashboard:view' },
    { id: idOf('page:analytics-oee:view'), permission_key: 'page:analytics-oee:view' },
    { id: idOf('page:analytics-energy:view'), permission_key: 'page:analytics-energy:view' },
    { id: idOf('page:analytics-energy:export'), permission_key: 'page:analytics-energy:export' },
    { id: idOf('page:analytics-energy:settings'), permission_key: 'page:analytics-energy:settings' }
  ];
  await page.route('**/api/plans/permissions', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([...catalogue, ...analyticsModules]) }));
  await page.route('**/api/companies/4/permissions', (route: any) => {
    if (route.request().method() === 'PUT') {
      state.puts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ company_id: 4, permission_count: 4, granted: 0, revoked: 1, revoked_from_roles: 0 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(held) });
  });
  await page.setViewportSize({ width: 1400, height: 1400 });
  await openAccess(page);

  // one group, nine modules — each named as the menu names it
  await expect(page.getByText('Analytics', { exact: true })).toBeVisible();
  for (const [, label] of analytics) {
    await expect(page.locator('.ui-dialog-lg').getByText(label, { exact: true }), `${label} module`).toBeVisible();
  }
  // the energy module carries all three actions; the factory module only View
  const energy = page.locator('.ui-dialog-lg .border', { has: page.getByText('Energy Dashboard', { exact: true }) }).last();
  await expect(energy.getByText('Export', { exact: true })).toBeVisible();
  await expect(energy.getByText('Tariff Settings', { exact: true })).toBeVisible();
  const factory = page.locator('.ui-dialog-lg .border', { has: page.getByText('Factory Overall', { exact: true }) }).last();
  await expect(factory.getByText('Export', { exact: true })).toHaveCount(0);

  await expect(page.getByText('5 permission(s) selected')).toBeVisible();
  await page.screenshot({ path: 'mexa-admin-access-analytics.png', fullPage: true });

  // take away only the Tariff Settings box: everything else stays granted
  await energy.getByText('Tariff Settings', { exact: true }).click();
  await expect(page.getByText(/Removing 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Save Access' }).click();
  await expect(page.getByText('Page access updated for S AND T')).toBeVisible();

  expect(state.puts).toHaveLength(1);
  const sent = state.puts[0].permission_ids as number[];
  expect(sent).not.toContain(idOf('page:analytics-energy:settings'));
  expect(sent).toContain(idOf('page:analytics-energy:export'));
  expect(sent).toContain(idOf('page:analytics-oee:view'));
  expect(sent.length).toBe(4);
});
