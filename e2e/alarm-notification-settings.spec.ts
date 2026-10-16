import { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

async function mockSettings(page: Page) {
  const state = { receive: false, enabled: false, version: 0, preferenceFailure: false, companyFailure: false,
    conflict: false, loadFailure: false, companyReads: 0, preferenceWrites: [] as any[], companyWrites: [] as any[] };
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/notifications/unread-count', route => route.fulfill({ json: { success: true, count: 0 } }));
  await page.route('**/api/notifications/preferences', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); state.preferenceWrites.push(body);
      if (state.preferenceFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Cannot save your preference right now.' } });
      state.receive = body.notify_alarm;
    }
    return route.fulfill({ json: { success: true, data: { notify_alarm: state.receive } } });
  });
  await page.route('**/api/alarms/notification-policy', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); state.companyWrites.push(body);
      if (state.conflict) return route.fulfill({ status: 409, json: { success: false, message: 'Changed elsewhere' } });
      if (state.companyFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Company setting not saved.' } });
      state.enabled = body.enabled; state.version++;
    } else {
      state.companyReads++;
      if (state.loadFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Company setting unavailable.' } });
    }
    return route.fulfill({ json: { success: true, data: { enabled: state.enabled, version: state.version, counts: { machines: 250 } } } });
  });
  return state;
}

const companySwitch = (page: Page) => page.getByRole('switch', { name: 'Company critical alarm alerts', exact: true });

test('an admin explicitly enables critical-only alerts for every current and future company machine', async ({ authedPage: page }) => {
  const state = await mockSettings(page); await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Alarm notifications' });
  await expect(companySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(card.getByText('250 active machines', { exact: true })).toBeVisible();
  await expect(card.getByText('Covers every current and future machine in your company.', { exact: false })).toBeVisible();
  await expect(card.getByRole('combobox')).toHaveCount(0); await expect(card.getByRole('searchbox')).toHaveCount(0);
  await companySwitch(page).click(); expect(state.companyWrites).toEqual([]);
  await expect(page.getByText('Your inbox is off. Turn on Receive alarm notifications to receive these alerts.')).toBeVisible();
  await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(card.getByRole('status')).toContainText('Critical alarm alerts enabled for all company machines');
  expect(state.companyWrites).toEqual([{ enabled: true, expected_version: 0 }]);
  await page.reload(); await expect(companySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Save company setting' })).toHaveCount(0);
});

test('a company can disable alerts while every alarm remains in history', async ({ authedPage: page }) => {
  const state = await mockSettings(page); state.enabled = true; state.version = 2; await page.goto('/settings');
  await expect(companySwitch(page)).toHaveAttribute('aria-checked', 'true');
  await companySwitch(page).click(); await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(page.getByRole('status')).toContainText('Company critical alarm alerts turned off');
  expect(state.companyWrites).toEqual([{ enabled: false, expected_version: 2 }]);
  expect(state.preferenceWrites).toEqual([]);
  await expect(page.getByText('Normal and information alarms stay in history without notifications.', { exact: false })).toBeVisible();
});

test('a failed company save keeps the selected value ready to retry', async ({ authedPage: page }) => {
  const state = await mockSettings(page); await page.goto('/settings');
  await companySwitch(page).click(); state.companyFailure = true;
  await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(page.getByRole('alert')).toContainText('Company setting not saved');
  await expect(companySwitch(page)).toHaveAttribute('aria-checked', 'true');
  state.companyFailure = false; await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(page.getByRole('status')).toContainText('Critical alarm alerts enabled');
});

test('concurrent admin changes require a deliberate reload before another save', async ({ authedPage: page }) => {
  const state = await mockSettings(page); await page.goto('/settings');
  await companySwitch(page).click(); state.conflict = true;
  await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(page.getByRole('alert')).toContainText('Another admin changed this setting');
  await expect(companySwitch(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save company setting' })).toBeDisabled();
  state.conflict = false; await page.getByRole('button', { name: 'Reload company setting' }).click();
  await expect(companySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(companySwitch(page)).toBeEnabled();
  expect(state.companyWrites).toHaveLength(1);
});

test('a failed initial company load can be retried without writing a default', async ({ authedPage: page }) => {
  const state = await mockSettings(page); state.loadFailure = true; await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText('Company setting unavailable');
  await expect(companySwitch(page)).toBeDisabled(); expect(state.companyWrites).toEqual([]);
  state.loadFailure = false; await page.getByRole('button', { name: 'Reload company setting' }).click();
  await expect(companySwitch(page)).toBeEnabled(); expect(state.companyReads).toBe(2);
});

test('a permitted non-admin controls only their inbox preference with rollback on failure', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:alarms:view'], company_permissions: ['page:alarms:view'] });
  const state = await mockSettings(page); await page.goto('/settings');
  const receive = page.getByRole('switch', { name: 'Receive alarm notifications' });
  state.preferenceFailure = true; await receive.click();
  await expect(receive).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('alert')).toContainText('Cannot save your preference');
  state.preferenceFailure = false; await page.getByRole('button', { name: 'Retry preference' }).click(); await receive.click();
  await expect(receive).toHaveAttribute('aria-checked', 'true');
  await expect(companySwitch(page)).toHaveCount(0); expect(state.companyReads).toBe(0); expect(state.companyWrites).toEqual([]);
});

test('roles without alarm grants and S&T have no alarm settings or preference traffic', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:quality:view'], company_permissions: ['page:quality:view'] });
  const state = await mockSettings(page); const prefs: string[] = [];
  page.on('request', request => { if (request.url().includes('/notifications/preferences')) prefs.push(request.url()); });
  await page.goto('/settings'); await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  expect(state.companyReads).toBe(0); expect(prefs).toEqual([]);
});

test('S&T sees only the local theme switch', async ({ sntSuperPage: page }) => {
  const state = await mockSettings(page); await page.goto('/settings');
  await expect(page.getByRole('switch')).toHaveCount(1); await expect(companySwitch(page)).toHaveCount(0);
  expect(state.companyReads).toBe(0);
});

test('critical-only settings stay balanced on desktop and usable at 360px in both themes', async ({ authedPage: page }, testInfo) => {
  await mockSettings(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/settings');
  await expect(companySwitch(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('critical-alarm-settings-1440.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 360, height: 844 });
  await companySwitch(page).click(); await page.getByRole('button', { name: 'Save company setting' }).click();
  await expect(page.getByRole('status')).toContainText('Critical alarm alerts enabled');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('critical-alarm-settings-360.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('switch', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('critical-alarm-settings-360-dark.png'), fullPage: true, animations: 'disabled' });
});
