import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The Roles page, as a company admin sees it.
 *
 * The flow the customer asked for: each company starts with its OWN copy of
 * the five default roles (created with the company), and its admin manages
 * them completely — adds or removes pages, copies, deletes. S&T takes no
 * action on roles. Company Admin is the one shared role, and its access is
 * Manage Access rather than a page list.
 *
 * What must NOT be offered: SNT_SUPER is never listed to a company.
 */

const DEFAULTS = ['SUPERVISOR', 'MAINTENANCE', 'QUALITY', 'SETTER', 'HR'];

const withPages = (keys: number, base: number) => Array.from({ length: keys }, (_, i) => ({
  id: base * 100 + i, permission_key: `page:thing-${i}:view`, description: 'View' }));

// what the API returns to a company admin: Company Admin, plus the company's own roles
const roles = [
  { id: 7, role_name: 'COMPANY_ADMIN', is_system: true, company_id: null, description: 'admin', permissions: withPages(5, 7) },
  ...DEFAULTS.map((n, i) => ({ id: 51 + i, role_name: n, is_system: false, company_id: 4,
                               description: `${n} default`, permissions: withPages(6 + i, 51 + i) })),
  { id: 80, role_name: 'LINE_LEAD', is_system: false, company_id: 4,
    description: 'ours', permissions: [{ id: 1, permission_key: 'page:machines:view' }] }
];

async function openRoles(page: any) {
  await seedAuth(page, {
    roles: ['COMPANY_ADMIN'], user_type: 'COMPANY_ADMIN', company_id: 4, company_permissions: []
  });
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/roles', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(roles) }));
  await page.route('**/api/roles/pages/list', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([]) }));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/admin/roles');
}

test('a company admin sees all five default roles', async ({ page }) => {
  await openRoles(page);
  for (const name of DEFAULTS) {
    await expect(page.getByText(name, { exact: true }), `${name} must be listed`).toBeVisible();
  }
  await expect(page.getByText('LINE_LEAD', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'mexa-roles-defaults.png', fullPage: true });
});

test('SNT_SUPER is not offered to a company', async ({ page }) => {
  await openRoles(page);
  await expect(page.getByText('SNT_SUPER', { exact: true })).toHaveCount(0);
});

/* The company's default roles are its own: the admin changes them directly. */
test('a default role is fully editable — it is the company\'s own', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'MAINTENANCE' });
  await expect(row.getByRole('button', { name: 'Edit Permissions' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Copy' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Delete' })).toBeEnabled();
});

test('changing a default role saves to that company role', async ({ page }) => {
  await openRoles(page);
  const sent: any[] = [];
  await page.route('**/api/roles/52/permissions', (r: any) => {
    sent.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: 7 }) });
  });
  await page.locator('tr', { hasText: 'MAINTENANCE' }).getByRole('button', { name: 'Edit Permissions' }).click();
  await page.getByRole('button', { name: 'Save Permissions' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].permission_ids).toHaveLength(7);
});

test('Company Admin cannot be copied — its access is Manage Access', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'COMPANY_ADMIN' });
  await expect(row.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await expect(row.getByText('Everything the company has access to')).toBeVisible();
});

test('the company\'s own role is fully editable', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'LINE_LEAD' });
  await expect(row.getByRole('button', { name: 'Edit Permissions' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Copy' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Delete' })).toBeEnabled();
});

test('copying a default role creates the company\'s own version, and says what it left out', async ({ page }) => {
  await openRoles(page);
  const posted: any[] = [];
  await page.route('**/api/roles/51/copy', (r: any) => {
    posted.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
      role: { id: 90, role_name: 'NIGHT SUPERVISOR' }, copied: 5, skipped: 1, from: 'SUPERVISOR' }) });
  });

  await page.locator('tr', { hasText: 'SUPERVISOR' }).first().getByRole('button', { name: 'Copy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy SUPERVISOR' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#copyName')).toHaveValue('SUPERVISOR COPY');
  await page.screenshot({ path: 'mexa-roles-copy.png', fullPage: true });

  await dialog.locator('#copyName').fill('NIGHT SUPERVISOR');
  await dialog.getByRole('button', { name: 'Copy Role' }).click();

  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({ role_name: 'NIGHT SUPERVISOR' });
  await expect(page.getByText(/NIGHT SUPERVISOR" created from SUPERVISOR/)).toBeVisible();
  await expect(page.getByText(/1 permission left out because your plan does not include it/)).toBeVisible();
});

test('a name the server refuses shows the server\'s reason', async ({ page }) => {
  await openRoles(page);
  await page.route('**/api/roles/51/copy', (r: any) => r.fulfill({ status: 409, contentType: 'application/json',
    body: JSON.stringify({ message: '"supervisor" is a default role. Copy it instead, or choose another name.' }) }));

  await page.locator('tr', { hasText: 'SUPERVISOR' }).first().getByRole('button', { name: 'Copy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy SUPERVISOR' });
  await dialog.locator('#copyName').fill('supervisor');
  await dialog.getByRole('button', { name: 'Copy Role' }).click();
  await expect(page.getByText(/is a default role/)).toBeVisible();
  await expect(dialog).toBeVisible();     // stays open to fix the name
});

test('permissions saved from the editor are pages only — the server adds the rest', async ({ page }) => {
  await openRoles(page);
  const sent: any[] = [];
  await page.route('**/api/roles/80/permissions', (r: any) => {
    sent.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: 1 }) });
  });
  await page.locator('tr', { hasText: 'LINE_LEAD' }).getByRole('button', { name: 'Edit Permissions' }).click();
  await page.getByRole('button', { name: 'Save Permissions' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].permission_ids).toEqual([1]);   // the page id; no machine.view-style ids
});

test('the default roles are offered when creating a user', async ({ page }) => {
  await openRoles(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: /create user/i }).click();

  const select = page.locator('#createFormRole').or(page.locator('select').filter({ hasText: 'Select a role' })).first();
  for (const name of DEFAULTS) {
    await expect(select.locator('option', { hasText: name })).toHaveCount(1);
  }
  await expect(select.locator('option', { hasText: 'SNT_SUPER' })).toHaveCount(0);
});

test('a company admin sees just Users and Roles in the admin tabs', async ({ page }) => {
  await openRoles(page);
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Roles & Permissions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Companies' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync Pages' })).toHaveCount(0);
});
