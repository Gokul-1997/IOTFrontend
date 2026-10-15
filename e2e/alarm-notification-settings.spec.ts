import { Page } from '@playwright/test';
import { test, expect, seedAuth } from './fixtures/auth';

async function mockSettings(page: Page) {
  const machines = Array.from({ length: 25 }, (_, index) => ({ machine_id: index + 1,
    machine_serial_no: `CNC-${String(index + 1).padStart(3, '0')}`, plant_name: 'Main plant', enabled: false, delay_seconds: 600 }));
  const state = { receive: false, preferenceFailure: false, ruleFailure: false, listFailure: false,
    listQueries: [] as URL[], preferenceWrites: [] as any[], ruleWrites: [] as any[] };
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/notifications/unread-count', route => route.fulfill({ json: { success: true, count: 0 } }));
  await page.route('**/api/notifications/preferences', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      state.preferenceWrites.push(body);
      if (state.preferenceFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Cannot save your preference right now.' } });
      state.receive = body.notify_alarm;
    }
    return route.fulfill({ json: { success: true, data: { notify_alarm: state.receive } } });
  });
  await page.route('**/api/alarms/notification-rules**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      const id = Number(url.pathname.split('/').pop());
      state.ruleWrites.push({ id, ...body });
      if (state.ruleFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Machine rule was not saved.' } });
      const row = machines.find(machine => machine.machine_id === id)!;
      Object.assign(row, body);
      return route.fulfill({ json: { success: true, data: row } });
    }
    state.listQueries.push(url);
    if (state.listFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Machine rules are temporarily unavailable.' } });
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const filtered = machines.filter(machine => `${machine.machine_serial_no} ${machine.plant_name}`.toLowerCase().includes(search));
    const number = Number(url.searchParams.get('page') || 1);
    return route.fulfill({ json: { success: true, data: filtered.slice((number - 1) * 20, number * 20),
      pagination: { page: number, limit: 20, total: filtered.length, totalPages: Math.ceil(filtered.length / 20) } } });
  });
  return state;
}

test('an admin explicitly saves a 30-second rule and it survives a reload', async ({ authedPage: page }) => {
  const state = await mockSettings(page);
  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Alarm notifications' });
  const row = card.getByRole('listitem', { name: 'CNC-001', exact: true });
  await expect(row).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveCount(20);
  await row.getByRole('switch', { name: 'Alarm alerts for CNC-001' }).click();
  await row.getByRole('combobox', { name: 'Notify after for CNC-001' }).selectOption({ label: '30 seconds' });
  expect(state.ruleWrites).toEqual([]);
  await row.getByRole('button', { name: 'Save alarm rule for CNC-001' }).click();
  await expect(row.getByRole('status')).toHaveText('Saved');
  expect(state.ruleWrites).toEqual([{ id: 1, enabled: true, delay_seconds: 30 }]);
  expect(state.listQueries[0].searchParams.get('limit')).toBe('20');
  await page.reload();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(row.getByRole('combobox')).toHaveValue('0: 30');
  await expect(row.getByRole('button')).toBeDisabled();
});

test('custom delay validation prevents a write and server failures leave changes ready to retry', async ({ authedPage: page }) => {
  const state = await mockSettings(page);
  await page.goto('/settings');
  const row = page.getByRole('listitem', { name: 'CNC-001', exact: true });
  await row.getByRole('combobox').selectOption({ label: 'Custom seconds' });
  const seconds = row.getByRole('spinbutton', { name: 'Delay in seconds for CNC-001' });
  await seconds.fill('0.5');
  await row.getByRole('button', { name: 'Save alarm rule for CNC-001' }).click();
  await expect(row.getByRole('alert')).toHaveText('Enter whole seconds from 1 to 86,400.');
  expect(state.ruleWrites).toEqual([]);
  await seconds.fill('45');
  state.ruleFailure = true;
  await row.getByRole('button', { name: 'Save alarm rule for CNC-001' }).click();
  await expect(row.getByRole('alert')).toHaveText('Machine rule was not saved.');
  await expect(seconds).toHaveValue('45');
  state.ruleFailure = false;
  await row.getByRole('button', { name: 'Save alarm rule for CNC-001' }).click();
  await expect(row.getByRole('status')).toHaveText('Saved');
  expect(state.ruleWrites.at(-1)).toEqual({ id: 1, enabled: false, delay_seconds: 45 });
});

test('the machine list is paged, debounced and recoverable after an API failure', async ({ authedPage: page }) => {
  const state = await mockSettings(page);
  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Alarm notifications' });
  await expect(card.getByRole('listitem')).toHaveCount(20);
  await card.getByRole('button', { name: 'Next machine rules page' }).click();
  await expect(card.getByRole('listitem')).toHaveCount(5);
  await expect(card.getByText('25 machines · Page 2 of 2')).toBeVisible();
  const search = card.getByRole('searchbox', { name: 'Search machines' });
  await search.fill('C');
  await search.fill('CNC');
  await search.fill('CNC-025');
  await expect(card.getByRole('listitem')).toHaveCount(1);
  await expect(card.getByRole('listitem', { name: 'CNC-025', exact: true })).toBeVisible();
  expect(state.listQueries.map(url => url.searchParams.get('search'))).toEqual(['', '', 'CNC-025']);
  expect(state.listQueries.at(-1)!.searchParams.get('page')).toBe('1');
  state.listFailure = true;
  await search.fill('CNC-001');
  await expect(card.getByRole('alert')).toContainText('Machine rules are temporarily unavailable.');
  state.listFailure = false;
  await card.getByRole('button', { name: 'Retry machine rules' }).click();
  await expect(card.getByRole('listitem', { name: 'CNC-001', exact: true })).toBeVisible();
});

test('a permitted non-admin controls only their personal preference, with rollback on failure', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:alarms:view'], company_permissions: ['page:alarms:view'] });
  const state = await mockSettings(page);
  await page.goto('/settings');
  const receive = page.getByRole('switch', { name: 'Receive alarm notifications' });
  await expect(receive).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('searchbox', { name: 'Search machines' })).toHaveCount(0);
  state.preferenceFailure = true;
  await receive.click();
  await expect(receive).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('alert')).toContainText('Cannot save your preference right now.');
  state.preferenceFailure = false;
  await page.getByRole('button', { name: 'Retry preference' }).click();
  await receive.click();
  await expect(receive).toHaveAttribute('aria-checked', 'true');
  expect(state.preferenceWrites).toEqual([{ notify_alarm: true }, { notify_alarm: true }]);
  expect(state.listQueries).toEqual([]);
});

test('quality-only and setter roles without alarm view grants fetch no alarm settings', async ({ page }) => {
  await seedAuth(page, { roles: ['SETTER'], permissions: ['page:quality:view'], company_permissions: ['page:quality:view'] });
  const state = await mockSettings(page);
  const preferenceRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/notifications/preferences')) preferenceRequests.push(request.url()); });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  expect(state.listQueries).toEqual([]);
  expect(preferenceRequests).toEqual([]);
});

test('S&T has only the local theme switch and no alarm preference traffic', async ({ sntSuperPage: page }) => {
  const state = await mockSettings(page);
  const preferenceRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/notifications/preferences')) preferenceRequests.push(request.url()); });
  await page.goto('/settings');
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Alarm notifications' })).toHaveCount(0);
  expect(state.listQueries).toEqual([]);
  expect(preferenceRequests).toEqual([]);
});

test('alarm settings remain usable at 360px, including custom seconds', async ({ authedPage: page }, testInfo) => {
  await mockSettings(page);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto('/settings');
  const row = page.getByRole('listitem', { name: 'CNC-001', exact: true });
  await row.getByRole('combobox').selectOption({ label: 'Custom seconds' });
  await row.getByRole('spinbutton').fill('60');
  await row.getByRole('button', { name: 'Save alarm rule for CNC-001' }).click();
  await expect(row.getByRole('status')).toHaveText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('alarm-settings-360.png') });
  for (const name of ['Program transfer', 'Tickets', 'Maintenance', 'System']) {
    await expect(page.getByRole('switch', { name, exact: true })).toHaveCount(0);
  }
});
