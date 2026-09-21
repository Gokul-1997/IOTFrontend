import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The Roles page, as a company admin sees it.
 *
 * The bug this covers: role.service.list filtered on company_id alone, and
 * every system role carries company_id NULL — so the five default roles
 * (Supervisor, Maintenance, Quality, Setter, HR) were invisible, and a
 * company admin had nothing to assign a new user to.
 *
 * The other half is what must NOT be offered: SNT_SUPER is never listed to a
 * company, and a default role cannot be edited here — it is defined in the
 * backend and re-applied on every restart, so an edit would be undone.
 */

const DEFAULTS = ['SUPERVISOR', 'MAINTENANCE', 'QUALITY', 'SETTER', 'HR'];

const systemRole = (id: number, role_name: string, keys = 4) => ({
  id, role_name, is_system: true, company_id: null,
  description: `${role_name} default`,
  permissions: Array.from({ length: keys }, (_, i) => ({
    id: id * 100 + i, permission_key: `page:thing-${i}:view`, description: 'View' }))
});

// what the API returns to a company admin: system roles + their own, no SNT_SUPER
const roles = [
  systemRole(7, 'COMPANY_ADMIN', 25),
  ...DEFAULTS.map((n, i) => systemRole(51 + i, n, 6 + i)),
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

/* The AWS model: default roles are the same everywhere and locked. The
   company admin's way to change one is to copy it. */
test('a default role offers Copy — not Edit or Delete', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'MAINTENANCE' });
  await expect(row.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit Permissions' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
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
