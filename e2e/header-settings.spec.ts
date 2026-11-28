import { test, expect, seedAuth } from './fixtures/auth';

/*
 * 6 Oct 2026, the client's requests:
 *   1. no light/dark button in the header — the switch is in Settings
 *      (reversed 28 Nov 2026, the user: "dark mode button on the header top,
 *      easy to switch" — the bar has the button again; Settings keeps its
 *      switch, and the two are one choice);
 *   2. a company admin's Admin (Users, Roles & Permissions) moves from the
 *      header bar into Settings;
 *   3. two-step sign-in is removed entirely.
 * S&T keeps Admin in its bar (Companies is all S&T has) and now opens
 * Settings for light/dark alone.
 */

const ok = (data: any) => ({ status: 'success', data });

async function mockCommon(page: any) {
  await page.routeWebSocket(/.*/, (socket: any) => socket.close());
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/alarms/notification-policy', (r: any) => r.fulfill({ json: { success: true,
    data: { enabled: false, version: 0, counts: { machines: 0 } } } }));
  await page.route('**/api/notifications/unread-count', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, count: 0 }) }));
}

const header = (page: any) => page.locator('header');

test('the header\'s light/dark button, at every width: one tap switches, it is remembered, and Settings agrees', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('theme', 'light'); sessionStorage.setItem('seeded', '1'); } });
  const html = page.locator('html');
  const button = header(page).getByRole('button', { name: 'Dark theme' });
  for (const width of [1500, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', String(await html.evaluate(el => el.classList.contains('dark'))));
  }

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  const settingsSwitch = page.getByRole('switch', { name: 'Dark mode' });
  await expect(html).not.toHaveClass(/dark/);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('title', 'Switch to dark theme');
  await expect(button.locator('.material-icons')).toHaveText('dark_mode');

  await button.click();                                            // dark, at once
  await expect(html).toHaveClass(/dark/);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('title', 'Switch to light theme');
  await expect(button.locator('.material-icons')).toHaveText('light_mode');
  await expect(settingsSwitch).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  await page.reload();                                             // remembered
  await expect(html).toHaveClass(/dark/);
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  await settingsSwitch.click();                                    // Settings switches the same choice
  await expect(html).not.toHaveClass(/dark/);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('a saved dark theme applies on the first page — the app applies it, not the header button', async ({ authedPage: page }) => {
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
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await expect(page.locator('app-settings .mexa-subtitle')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Receive alarm notifications' })).toHaveCount(1);

  await admin.getByRole('link', { name: /Users/ }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test('on a phone the menu has no Admin entry for a company admin either; Settings is there', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await mockCommon(page);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/settings');
    await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Administration' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Dark mode' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.locator('#mobile-menu');
    await expect(menu.getByRole('link', { name: /Admin/ })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
    await menu.getByRole('link', { name: 'Settings' }).click();
    await expect(menu).toHaveCount(0);
  }
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
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await expect(page.locator('app-settings .mexa-subtitle')).toHaveCount(0);
  expect(prefsCalls).toBe(0);
  await expect(header(page).getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin/companies');
  await expect(header(page).getByRole('button', { name: 'Dark theme' })).toBeVisible();   // its bar has the light/dark button too
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
