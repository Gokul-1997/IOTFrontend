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

test('a default role cannot be edited or deleted here', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'MAINTENANCE' });
  await expect(row.getByRole('button', { name: 'Edit Permissions' })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('the company\'s own role is still fully editable', async ({ page }) => {
  await openRoles(page);
  const row = page.locator('tr', { hasText: 'LINE_LEAD' });
  await expect(row.getByRole('button', { name: 'Edit Permissions' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Delete' })).toBeEnabled();
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
