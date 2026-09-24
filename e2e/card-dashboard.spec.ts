import { test, expect } from './fixtures/auth';
import { mkdirSync } from 'node:fs';

// Test readings are never included in the application bundle.
const machines = Array.from({ length: 6 }, (_, i) => ({
  machine_id: i + 1, machine_serial_no: ['VMC-01', 'CNC-02', 'VMC-03', 'CNC-04', 'VMC-05', 'CNC-06'][i],
  status: i === 4 ? 'OFFLINE' : i === 2 ? 'IDLE' : 'RUNNING', alarm: i === 3,
  operator_name: ['Gokul', 'Arun', 'Praveen', 'Kumar', null, 'Raj'][i],
  part_name: ['Valve housing', 'Drive shaft', 'Motor bracket', 'Bearing block', null, 'Pump body'][i],
  achieved_qty: [380, 420, 215, 310, 0, 465][i], target_qty: 400,
  utilization: [91, 87, 63, 78, null, 94][i],
  image_url: 'images/product/machine_01.png', component_id: 'CMP-' + (i + 100), idle_time: '00:35:20',
  run_minutes: [210, 250, 180, 200, 0, 270][i], run_time: ['03:30:00', '04:10:00', '03:00:00', '03:20:00', '00:00:00', '04:30:00'][i]
}));
const live = { success: true, data: { shift: { shift_code: 'Day shift' }, machines } };

test.beforeEach(async ({ authedPage: page }) => {
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    user.roles = ['COMPANY_ADMIN']; user.username = 'Gokul';
    localStorage.setItem('user', JSON.stringify(user));
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/dashboard?*', route => route.fulfill({ json: live }));
});

test('cards are the first content and retain machine image, details, times and output', async ({ authedPage: page }) => {
  const errors: string[] = [], analyticsRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/dashboard/factory')) analyticsRequests.push(request.url()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/dashboard');
  const cards = page.locator('.machine-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toContainText('VMC-01');
  await expect(cards.first()).toContainText('Valve housing');
  await expect(cards.first()).toContainText('CMP-100');
  await expect(cards.first()).toContainText('03:30:00');
  await expect(cards.first()).toContainText('00:35:20');
  await expect(cards.first().locator('.machine-quantities')).toContainText('380');
  expect((await cards.first().boundingBox())!.y).toBeLessThan(350);
  expect(await page.locator('.machine-picture img').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
  await expect(page.locator('app-operations-analytics')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dashboards', exact: true })).toBeVisible();
  mkdirSync('dist/previews', { recursive: true });
  await page.screenshot({ path: 'dist/previews/gokul-card-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.screenshot({ path: 'dist/previews/gokul-card-dashboard-dark.png', fullPage: true });
  expect(analyticsRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('Running, Idle, Offline and Alarm filters match their displayed counts', async ({ authedPage: page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  for (const [name, count] of [['Running', 4], ['Idle', 1], ['Offline', 1], ['Alarm', 1]] as const) {
    await page.getByRole('button', { name: new RegExp('^' + name + ' ' + count) }).click();
    await expect(page.locator('.machine-card')).toHaveCount(count);
    if (name !== 'Running') await expect(page.locator('.machine-state')).toHaveText(name.toUpperCase());
  }
  await expect(page.locator('.machine-card')).toContainText('Machine running · alarm active');
  await page.getByRole('button', { name: /^Total 6/ }).click();
  await expect(page.locator('.machine-card')).toHaveCount(6);
});

test('phone cards keep all readings and status filters without sideways scrolling', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: /^Alarm 1/ })).toBeVisible();
  mkdirSync('dist/previews', { recursive: true });
  await page.screenshot({ path: 'dist/previews/gokul-card-dashboard-mobile.png' });
  await page.locator('.machine-card').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/live\/1$/);
});

test('a missing machine image uses the neutral placeholder', async ({ authedPage: page }) => {
  await page.route('**/missing-machine.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/dashboard?*', route => route.fulfill({ json: { success: true, data: { machines: [{ ...machines[0], image_url: '/missing-machine.png' }] } } }));
  await page.goto('/dashboard');
  const image = page.locator('.machine-picture img');
  await expect(image).toHaveAttribute('src', /machine-placeholder.svg$/);
  expect(await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBeTruthy();
});

test('preserves six-card pagination and automatic page advance with a pause control', async ({ authedPage: page }) => {
  await page.clock.install();
  const extra = [...machines, { ...machines[0], machine_id: 7, machine_serial_no: 'VMC-07' }];
  await page.route('**/api/dashboard?*', route => route.fulfill({ json: { success: true, data: { machines: extra } } }));
  await page.goto('/dashboard');
  await expect(page.locator('.machine-card')).toHaveCount(6);
  await page.clock.fastForward(11000);
  await expect(page.locator('.machine-card')).toHaveCount(1);
  await expect(page.locator('.machine-card')).toContainText('VMC-07');
  await page.getByRole('button', { name: 'Pause auto-advance' }).click();
  await page.clock.fastForward(11000);
  await expect(page.locator('.machine-card')).toContainText('VMC-07');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.machine-card')).toHaveCount(6);
});

test('top navigation retains the original dashboard destinations', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Dashboards', exact: true }).click();
  await page.getByRole('link', { name: 'Factory Overall', exact: false }).click();
  await expect(page).toHaveURL(/\/factory$/);
  await expect(page.locator('.nav-dropdown')).toHaveCount(0);
});
