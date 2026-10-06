import { test, expect, seedAuth } from './fixtures/auth';

/*
 * 6 Oct 2026, the client's requests:
 *   1. no light/dark button in the header — the switch is in Settings;
 *   2. a company admin's Admin (Users, Roles & Permissions) moves from the
 *      header bar into Settings;
 *   3. two-step sign-in is removed entirely.
 * S&T keeps Admin in its bar (Companies is all S&T has) and now opens
 * Settings for light/dark alone.
 */

const ok = (data: any) => ({ status: 'success', data });

async function mockCommon(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/notifications/unread-count', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, count: 0 }) }));
  await page.route('**/api/notifications/preferences', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ok({ notify_alarm: true, notify_maintenance: true, notify_ticket: true, notify_program_transfer: true, notify_system: true })) }));
}

const header = (page: any) => page.locator('header');

test('the header has no light/dark button, at any width', async ({ authedPage: page }) => {
  await mockCommon(page);
  for (const width of [1500, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(header(page).getByRole('button', { name: /theme/i })).toHaveCount(0);
    await expect(header(page).locator('.material-icons', { hasText: /^(dark_mode|light_mode)$/ })).toHaveCount(0);
  }
});

test('a saved dark theme applies on the first page, with no header button to start it', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/profile');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('a company admin finds Users and Roles in Settings, not in the header bar', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await mockCommon(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/settings');

  await expect(header(page).getByRole('link', { name: /^\s*admin_panel_settings\s*Admin\s*$/ })).toHaveCount(0);
  await expect(header(page).locator('nav[aria-label="Main"] >> text=Admin')).toHaveCount(0);

  const admin = page.getByRole('region', { name: 'Administration' });
  await expect(admin.getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users');
  await expect(admin.getByRole('link', { name: /Roles & Permissions/ })).toHaveAttribute('href', '/admin/roles');
  await expect(page.locator('.mexa-subtitle')).toHaveText('( Appearance, notifications and administration )');

  await admin.getByRole('link', { name: /Users/ }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test('on a phone the menu has no Admin entry for a company admin either; Settings is there', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await mockCommon(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.locator('#mobile-menu');
  await expect(menu.getByRole('link', { name: /Admin/ })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('a person who is not an admin sees no Administration in Settings', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:quality:view'], company_permissions: [] });
  await mockCommon(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/settings');
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Administration' })).toHaveCount(0);
});

test('S&T keeps Admin in its bar and opens Settings for light/dark alone', async ({ sntSuperPage: page }) => {
  let prefsCalls = 0;
  await mockCommon(page);
  await page.route('**/api/notifications/preferences', (r: any) => { prefsCalls++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Notification types' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Administration' })).toHaveCount(0);
  await expect(page.locator('.mexa-subtitle')).toHaveText('( Appearance )');
  expect(prefsCalls).toBe(0);
  await expect(header(page).getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin/companies');
});

test('two-step sign-in is gone: no page, no link, no Security tab', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.route('**/api/auth/me', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ok({ id: 1, username: 'test', email: 'test@example.com', user_type: 'ADMIN', company_name: 'S AND T' })) }));
  await page.setViewportSize({ width: 1500, height: 900 });

  await page.goto('/security/2fa');
  await expect(page).not.toHaveURL(/security\/2fa/);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Security/ })).toHaveCount(0);
  await expect(page.getByText(/two-step/i)).toHaveCount(0);

  await page.getByRole('button', { name: /Account menu/ }).click();
  await expect(page.getByRole('link', { name: /2-step|two-step/i })).toHaveCount(0);
});
