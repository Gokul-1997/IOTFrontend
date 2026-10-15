import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The account surfaces that did not exist before this change: Profile,
 * Settings, and a real Notifications page behind the bell's "View all"
 * link, which pointed at a route that had never been registered.
 *
 * Routed through /factory rather than /dashboard: /dashboard is the legacy
 * Live Dashboard, which opens a real SocketService connection — unrelated
 * to anything under test here, and not worth mocking just to reach the
 * header. /factory is the minimal, already-proven-safe surface every other
 * spec in this session uses for the same reason.
 */

const ok = (data: any) => ({ status: 'success', data });

const meta = { success: true, data: {
  machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

async function mockCommon(page: any) {
  await page.routeWebSocket(/.*/, (socket: any) => socket.close());
  await page.route('**/socket.io/**', (r: any) => r.abort());
  // Broad fallback registered first, as every other spec in this session
  // does — specific routes below win because Playwright matches last-added
  // first. Without it, any unmocked call hits the real (absent) backend.
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/factory*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok({
    filters: { date: '2026-09-20', shift_id: null }, updated_at: new Date().toISOString(),
    machines: { total: 1, running: 1, idle: 0, breakdown: 0, offline: 0 },
    production: { produced: 1, planned: 1, percent: 100 }, time: { run_seconds: 1, idle_seconds: 0, down_seconds: 0 },
    oee: { availability: 1, performance: 1, quality: 1, oee: 1, target: 1 },
    energy: { kwh: 1, month_kwh: 1, currency: 'INR', rate_per_kwh: 1, cost_day: 1, cost_month: 1 },
    shiftwise: [], downtime: { total_seconds: 0, planned_seconds: 0, unplanned_seconds: 0, by_reason: [] },
    alarms: { total: 0, critical: 0, non_critical: 0, information: 0, open: 0 }, trend: []
  })) }));
  await page.route('**/api/notifications/unread-count', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, count: 2 }) }));
  await page.route('**/api/notifications?**', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      success: true, unread_count: 2,
      data: [
        { id: 1, type: 'ALARM', title: 'CNC-01 in alarm', message: 'Servo overload', is_read: false, created_at: new Date().toISOString(), link: null },
        { id: 2, type: 'SYSTEM', title: 'Welcome', message: 'Your account was created', is_read: true, created_at: new Date().toISOString(), link: null }
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 }
    }) }));
}

test('the user menu reaches Profile, Settings and Notifications', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.route('**/api/auth/me', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ok({ id: 1, username: 'test', email: 'test@example.com', mobile: null,
      user_type: 'ADMIN', company_name: 'S AND T', plant_name: null, last_login_at: null })) }));

  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();

  // the dropdown used to hold nothing but a name, an email and Sign Out
  await page.getByRole('button', { name: 'Account menu for test' }).click();
  await expect(page.getByRole('link', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible();

  await page.getByRole('link', { name: 'My Profile' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByText('test@example.com')).toBeVisible();
});

test('the notification bell\'s "View all" link now lands on a real page', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();

  const bellButton = page.locator('button:has-text("2")').first();
  await bellButton.click();
  await page.getByRole('link', { name: 'View all' }).click();

  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('CNC-01 in alarm')).toBeVisible();
});

test('dark mode, switched in Settings, survives a reload and applies on other pages', async ({ authedPage: page }) => {
  await mockCommon(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();

  // Force a known starting state — headless Chromium's own colour-scheme
  // preference is not this test's concern, only whether a choice persists.
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto('/settings');
  const html = page.locator('html');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  const darkMode = appearance.getByRole('switch', { name: 'Dark mode' });
  const themeIcon = appearance.locator('.set-icon');
  await expect(html).not.toHaveClass(/dark/);
  await expect(darkMode).toHaveAttribute('aria-checked', 'false');
  await expect(themeIcon).toHaveText('light_mode');

  // the switch lives in Settings only since 6 Oct 2026 — the header has no theme button
  await darkMode.click();
  await expect(html).toHaveClass(/dark/);
  await expect(darkMode).toHaveAttribute('aria-checked', 'true');
  await expect(themeIcon).toHaveText('dark_mode');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await expect(html).toHaveClass(/dark/);

  await page.goto('/settings');
  await expect(darkMode).toHaveAttribute('aria-checked', 'true');
  await expect(themeIcon).toHaveText('dark_mode');
  // The decorative icon must not create a second, unsaved theme state.
  await themeIcon.click();
  await expect(html).toHaveClass(/dark/);
  await expect(darkMode).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await darkMode.click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(themeIcon).toHaveText('light_mode');
});

test('Settings keeps local appearance, useful alarm controls and administration', async ({ authedPage: page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await mockCommon(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  const preferenceRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/notifications/preferences')) preferenceRequests.push(request.url());
  });

  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Receive alarm notifications' })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Notification types' })).toHaveCount(0);
  const darkMode = page.getByRole('switch', { name: 'Dark mode' });
  await darkMode.click();
  await expect(darkMode).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  const admin = page.getByRole('region', { name: 'Administration' });
  await expect(admin.getByRole('link', { name: /Users/ })).toBeVisible();
  await expect(admin.getByRole('link', { name: /Roles & Permissions/ })).toBeVisible();
  expect(preferenceRequests).toHaveLength(1);
});

test('visual check: profile, settings and notifications render cleanly, light and dark', async ({ authedPage: page }, testInfo) => {
  await mockCommon(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  await page.route('**/api/auth/me', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ok({ id: 1, username: 'test', email: 'test@example.com', mobile: '9876543210',
      user_type: 'COMPANY_ADMIN', company_name: 'S AND T', plant_name: 'Plant 1', last_login_at: new Date().toISOString() })) }));
  await page.setViewportSize({ width: 1400, height: 1000 });

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account-profile-light.png'), fullPage: true });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account-settings-light.png'), fullPage: true });

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account-notifications-light.png'), fullPage: true });

  // Use the Settings switch so the saved choice survives a real navigation.
  await page.goto('/settings');
  await page.getByRole('switch', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('account-settings-dark-mobile.png'), fullPage: true });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('account-profile-dark.png'), fullPage: true });
});
