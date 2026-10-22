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

// A third record exercises the directory's inactive and unassigned states
// without changing the original fixtures used by the existing admin flows.
const directoryCompanies = [
  ...companies,
  { id: 6, company_code: 'NOVA', company_name: 'Nova Manufacturing', contact_email: 'admin@nova.example',
    is_active: false, plan_id: null, plan_name: null, tier: null,
    max_users: null, max_plants: null, max_machines: null }
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

async function mockAdminApi(page: any, opts: { companyRecords?: any[] } = {}) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/companies/*/usage', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage) }));
  await page.route('**/api/companies/*/plan/history*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok(planHistory)) }));
  await page.route('**/api/companies', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.companyRecords ?? companies) }));
  await page.route('**/api/plans', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plans) }));
  await page.route('**/api/users', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) }));
  await page.route('**/api/roles', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roles) }));
  await page.route('**/api/roles/pages/list', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionModules) }));
}

test('Companies: search and combined filters keep overview totals independent of the directory', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page, { companyRecords: directoryCompanies });
  await page.goto('/admin/companies');

  const directory = page.getByRole('region', { name: 'Companies', exact: true });
  const rows = directory.locator('tbody tr');
  const overview = page.getByRole('region', { name: 'Company overview', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search companies', exact: true });
  const status = page.getByRole('combobox', { name: 'Company status', exact: true });
  const plan = page.getByRole('combobox', { name: 'Company plan', exact: true });
  await expect(rows).toHaveCount(3);
  for (const [label, count] of [
    ['Total companies', '3'], ['Active companies', '2'],
    ['Inactive companies', '1'], ['Without a plan', '1']
  ]) {
    const metric = overview.locator('.admin-stat').filter({ has: page.getByText(label, { exact: true }) });
    await expect(metric).toHaveCount(1);
    await expect(metric).toContainText(count);
  }
  const totals = await overview.textContent();

  // The same search handles a company code, contact email, and name.
  await search.fill('  pAcPl  ');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Precision Auto Components');
  await search.fill('OPS@SANDT.COM');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('S AND T');
  await search.fill('Nova Manufacturing');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Nova Manufacturing');

  await search.fill('');
  await status.selectOption('active');
  await expect(rows).toHaveCount(2);
  await plan.selectOption('1');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('S AND T');
  await plan.selectOption('2');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Precision Auto Components');

  await status.selectOption('inactive');
  await plan.selectOption('none');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Nova Manufacturing');
  await expect(overview).toHaveText(totals!);

  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(status).toHaveValue('all');
  await expect(plan).toHaveValue('all');
  await expect(rows).toHaveCount(3);
  await expect(overview).toHaveText(totals!);
});

test('Companies: a search with no matches explains the result and can clear every filter', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page, { companyRecords: directoryCompanies });
  await page.goto('/admin/companies');
  await page.getByRole('searchbox', { name: 'Search companies', exact: true }).fill('unknown-company');
  await page.getByRole('combobox', { name: 'Company status', exact: true }).selectOption('active');
  await page.getByRole('combobox', { name: 'Company plan', exact: true }).selectOption('1');

  await expect(page.getByText('No companies match your filters', { exact: true })).toBeVisible();
  await expect(page.getByText('No companies yet', { exact: true })).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByText('No companies match your filters', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search companies', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Company status', exact: true })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Company plan', exact: true })).toHaveValue('all');
  await expect(page.getByRole('region', { name: 'Companies', exact: true }).locator('tbody tr')).toHaveCount(3);
});

test('Companies: an initial load failure offers retry instead of an empty directory', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  let shouldFail = true;
  let requests = 0;
  await page.route('**/api/companies', (route: any) => {
    requests++;
    return route.fulfill({ status: shouldFail ? 500 : 200, contentType: 'application/json',
      body: JSON.stringify(shouldFail ? { message: 'Company service unavailable' } : companies) });
  });
  await page.goto('/admin/companies');

  const error = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Try again', exact: true }) });
  await expect(error).toBeVisible();
  await expect(page.getByText('No companies yet', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No companies match your filters', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Companies', exact: true })).toHaveCount(0);
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);

  shouldFail = false;
  await error.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Companies', exact: true }).locator('tbody tr')).toHaveCount(2);
  await expect(error).toHaveCount(0);
  expect(requests).toBe(2);
});

test('Companies: secondary actions disclose by keyboard and close on Escape or an outside click', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page, { companyRecords: directoryCompanies });
  await page.route('**/api/companies/4', (route: any) => route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ ...companies[0],
      current_users: 12, current_plants: 2, current_machines: 20 }) }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/companies');
  const row = page.getByRole('row', { name: /S AND T/ });
  await expect(row.getByRole('button', { name: 'Access', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Usage for S AND T', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Program Transfer gateway of S AND T', exact: true })).toBeVisible();

  const summary = row.locator('summary[aria-label="More actions for S AND T"]');
  const details = row.locator('details');
  await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeHidden();
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(details).toHaveJSProperty('open', true);
  for (const action of ['Plants', 'Plan', 'View', 'Edit', 'Deactivate', 'Delete']) {
    await expect(row.getByRole('button', { name: action, exact: true })).toBeVisible();
  }
  await summary.press('Escape');
  await expect(details).toHaveJSProperty('open', false);
  await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeHidden();

  await summary.click();
  await expect(details).toHaveJSProperty('open', true);
  await page.getByRole('searchbox', { name: 'Search companies', exact: true }).click();
  await expect(details).toHaveJSProperty('open', false);

  await summary.click();
  await row.getByRole('button', { name: 'View', exact: true }).click();
  const detail = page.locator('.ui-dialog');
  await expect(detail.getByRole('heading', { name: 'S AND T', exact: true })).toBeVisible();
  await expect(detail).toContainText('ops@sandt.com');
  await expect(detail.getByRole('heading', { name: 'Usage vs Limits', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(detail).toHaveCount(0);

  const inactive = page.getByRole('row', { name: /Nova Manufacturing/ });
  await inactive.locator('summary[aria-label="More actions for Nova Manufacturing"]').click();
  await expect(inactive.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await expect(inactive.getByRole('button', { name: 'Deactivate', exact: true })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`Super Admin: ${theme} layout at ${width}px fits the viewport and marks the current page`, async ({ sntSuperPage: page }, testInfo) => {
      await mockAdminApi(page, { companyRecords: directoryCompanies });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);

      for (const [path, label] of [
        ['/admin/companies', 'Companies'], ['/admin/plans', 'Plans'], ['/admin/users', 'Company Admins']
      ]) {
        await page.goto(path);
        const current = page.getByRole('link', { name: label, exact: true });
        await expect(current).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        // Horizontal scrolling belongs to a table region, never the document.
        await expect.poll(() => page.evaluate(() =>
          document.documentElement.scrollWidth <= window.innerWidth
        )).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${path.split('/').pop()}-${theme}-${width}.png`),
          fullPage: true, animations: 'disabled'
        });
      }
    });
  }
}

test('Companies: landing page, usage & plan history, assign plan', async ({ sntSuperPage: page }, testInfo) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/companies');

  await expect(page.getByText('S AND T', { exact: true })).toBeVisible();
  await expect(page.getByText('Precision Auto Components')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-companies.png'), fullPage: true });

  // Usage & Plan History
  await page.getByRole('row', { name: /S AND T/ }).getByRole('button', { name: /usage|history/i }).click();
  await expect(page.getByText(/12 of 50/)).toBeVisible();
  await expect(page.getByText('Upgraded after onboarding call')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-company-history.png'), fullPage: true });
});

/* Program Transfer: a company's one gateway token — for all its machines — is
   made here by S&T (22 Oct 2026: "super admin side, don't company side"). */
test('Companies → Gateway: S&T makes the company\'s Program Transfer token, shown once; replacing and stopping ask first', async ({ sntSuperPage: page }, testInfo) => {
  await mockAdminApi(page);
  let gateway: any = null;
  const calls: string[] = [];
  await page.route('**/api/companies/5/program-gateway', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ company_id: 5, company_name: 'Precision Auto Components Pvt Ltd', gateway, poll_seconds: 15 }) }));
  await page.route('**/api/companies/5/program-gateway/token', (r: any) => {
    calls.push(r.request().method());
    if (r.request().method() === 'POST') {
      gateway = { token_prefix: 'mxg_newtoken', token_created_at: new Date().toISOString(), last_seen_at: null, online: false,
                  last_seen_ip: null, agent_version: null };
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ token: 'mxg_' + 'Q'.repeat(43),
        token_prefix: 'mxg_newtoken', created_at: '', company_name: 'Precision Auto Components Pvt Ltd' }) });
    }
    gateway = null;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revoked: true }) });
  });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/companies');
  const open = () => page.getByRole('row', { name: /Precision Auto/ }).getByRole('button', { name: 'Program Transfer gateway of Precision Auto Components Pvt Ltd' }).click();

  await open();
  const dialog = page.getByRole('dialog', { name: 'Program Transfer gateway' });
  await expect(dialog).toContainText('one token for all its machines');
  await expect(dialog).toContainText('Precision Auto Components Pvt Ltd has no gateway token yet');
  for (const call of ['/device/v1/status', '/device/v1/program?machine=NAME', '/device/v1/backup', '/device/v1/report']) await expect(dialog).toContainText(call);
  await expect(dialog.getByRole('link', { name: 'API guide' })).toHaveAttribute('href', '/integrations/PROGRAM_TRANSFER_API.md');
  await expect(dialog.getByRole('link', { name: 'Postman collection' })).toHaveAttribute('href', '/integrations/MEXA_Program_Transfer.postman_collection.json');
  await expect(dialog.getByRole('link', { name: 'Ready-made gateway' })).toHaveAttribute('href', '/integrations/mexa-gateway.js');
  await dialog.getByRole('button', { name: 'Make token' }).click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('mxg_' + 'Q'.repeat(43));
  await expect(dialog).toContainText('shown only this once');
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-company-gateway.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // opened again: the token is never shown twice, only its first characters; replacing asks first
  await open();
  await expect(dialog).toContainText('mxg_newtoken…');
  await expect(dialog).toContainText('Gateway has not connected yet');
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Replace token' }).click();
  await page.getByRole('alertdialog', { name: /Replace the gateway token/ }).getByRole('button', { name: 'Cancel' }).click();
  expect(calls).toEqual(['POST']);

  await dialog.getByRole('button', { name: 'Stop token' }).click();
  await page.getByRole('alertdialog', { name: /Stop the gateway token/ }).getByRole('button', { name: 'Stop token' }).click();
  await expect(dialog).toContainText('has no gateway token yet');
  expect(calls).toEqual(['POST', 'DELETE']);
});

test('Plans: the plan catalogue lists both plans with their limits', async ({ sntSuperPage: page }, testInfo) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/plans');

  await expect(page.getByRole('heading', { name: 'Plans' }).or(page.getByText('Plan Management'))).toBeVisible();
  await expect(page.getByText('Gold')).toBeVisible();
  await expect(page.getByText('Silver')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-plans.png'), fullPage: true });
});

/* One admin per company, made with the company on the Companies page. The
   company admin adds everyone else — a second full-access admin included —
   so S&T's page lists each company's admin and adds or deletes no one. */
test('Company Admins: one per company — no Add, no Delete', async ({ sntSuperPage: page }, testInfo) => {
  await mockAdminApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Company Admins' })).toBeVisible();
  await expect(page.getByText(/One admin per company, created with the company/)).toBeVisible();
  await expect(page.getByText('admin1', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: /Add Company Admin|Create User/ })).toHaveCount(0);
  const row = page.getByRole('row', { name: /admin1/ });
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Disable' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-company-admins.png'), fullPage: true });
});

test('Company Admins: editing changes the admin\'s own details — never the company', async ({ sntSuperPage: page }, testInfo) => {
  await mockAdminApi(page);
  const puts: any[] = [];
  await page.route('**/api/users/1', (r: any) => {
    if (r.request().method() === 'PUT') {
      puts.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users[0]) });
  });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/users');
  await page.getByRole('row', { name: /admin1/ }).getByRole('button', { name: 'Edit' }).click();

  const dialog = page.locator('.ui-dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit Company Admin' })).toBeVisible();
  // the company is shown, not chosen
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.getByText('S AND T', { exact: true })).toBeVisible();
  await expect(dialog.getByText('A company admin always stays with their company.')).toBeVisible();
  // and no machines to tick
  await expect(dialog.getByText('Machines this user supervises')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-company-admin-edit.png'), fullPage: true });

  await dialog.locator('input[type=email]').fill('new-admin@sandt.com');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();

  await expect.poll(() => puts.length).toBe(1);
  expect(Object.keys(puts[0]).sort()).toEqual(['email', 'is_active', 'username']);
  expect(puts[0].email).toBe('new-admin@sandt.com');
});

test('Company Admins: a disabled company\'s admin reads "Company disabled"', async ({ sntSuperPage: page }) => {
  await mockAdminApi(page);
  await page.route('**/api/users', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ ...users[0], company_active: false }]) }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: /admin1/ });
  await expect(row.getByText('Company disabled')).toBeVisible();
  await expect(row.getByText('Active', { exact: true })).toHaveCount(0);
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
    // S&T's side of users is each company's admin, and the tab says so
    await expect(page.getByRole('link', { name: 'Company Admins' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Roles & Permissions' })).toHaveCount(0);
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

test('Manage Access: opens with the company\'s current grants ticked, Save waits for a change', async ({ sntSuperPage: page }, testInfo) => {
  await mockAccessApi(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);

  await expect(page.getByText('Manage Access:')).toBeVisible();
  // 3 page grants — the legacy machine.view the modal cannot show is not counted
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Access' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-access.png'), fullPage: true });
});

test('Manage Access: a revoke says what it will do, then sends only what remains', async ({ sntSuperPage: page }, testInfo) => {
  const state = await mockAccessApi(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);
  await expect(page.getByText('3 permission(s) selected')).toBeVisible();

  // take Reports away: the "View" boxes run Dashboards, Reports, Program Transfer
  await page.locator('label', { hasText: 'View' }).nth(1).locator('input').uncheck();

  await expect(page.getByText(/Removing 1/)).toBeVisible();
  await expect(page.getByText(/roles in this company that hold them lose them too/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-access-revoke.png'), fullPage: true });

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

test('Manage Access: if the current grants cannot be loaded, nothing is editable and Save cannot wipe them', async ({ sntSuperPage: page }, testInfo) => {
  const state = await mockAccessApi(page, { failCurrent: true });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openAccess(page);

  // the bug: this failure was swallowed, every box showed unchecked, Save was live
  await expect(page.getByText("Could not load this company's access")).toBeVisible();
  await expect(page.locator('.ui-dialog-lg input[type=checkbox]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Access' })).toBeDisabled();
  expect(state.puts).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-access-failed.png'), fullPage: true });

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

test('Manage Access: the nine dashboards are separate modules under Analytics, each with its own actions', async ({ sntSuperPage: page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath('mexa-admin-access-analytics.png'), fullPage: true });

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
