import { test, expect } from './fixtures/auth';

const reading = {
  machine_id: 19, machine_serial_no: 'VMC - 19 - F', machine_status: 'RUNNING', received_at: new Date().toISOString(),
  spindle_speed: 1800, spindle_load: 40, spindle_motor_temp: 65, spindle_insulation_res: 150,
  servo_load_x: 55, servo_load_y: 60, servo_load_z: 70, fan_status: null, battery_supported: false
};
const health = {
  score: 75, status: 'Good', stale: false, observed_at: new Date().toISOString(), reported_checks: 6,
  basis: 'Mean of reported condition checks; missing readings are excluded.',
  checks: [
    { label: 'Spindle load', score: 100 }, { label: 'Spindle temperature', score: 50 },
    { label: 'Spindle insulation resistance', score: 100 }, { label: 'Servo X load', score: 100 },
    { label: 'Servo Y load', score: 50 }, { label: 'Servo Z load', score: 50 }
  ]
};

async function serve(page: any, score: any = health) {
  const api = { row: { ...reading }, health: score };
  await page.route('**/api/**', (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/charts/meta') return route.fulfill({ json: { success: true, data: { machines: [{ id: 19, machine_serial_no: 'VMC - 19 - F' }], shifts: [] } } });
    if (path === '/api/dashboard/maintenance') return route.fulfill({ json: { status: 'success', data: {
      filters: { machine_id: 19 }, updated_at: new Date().toISOString(), rows: [api.row], machine_health: api.health,
      machines: { total: 1, running: 1 }, alarms: { total: 0, open: 0 }, health: {}, production: {}, condition_trend: [], unavailable: [], supply: null
    } } });
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('app-machine-health-card')).toBeVisible();
  return api;
}

test('health card clearly shows the score, status, check counts and breakdown at phone and desktop widths', async ({ authedPage: page }, info) => {
  await serve(page);
  const card = page.locator('app-machine-health-card');
  await expect(card.getByRole('img')).toHaveAttribute('aria-label', /75 percent, Good/);
  await expect(card.locator('.mh-status')).toHaveText('Good');
  await expect(card.locator('dd')).toHaveText(['3', '3', '0']);
  for (const width of [390, 820, 1280, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await card.scrollIntoViewIfNeeded();
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 390) await expect(page.locator('.last-updated-vertical')).toHaveCSS('position', 'static');
    if (width === 390 || width === 1600) await card.screenshot({ path: info.outputPath('health-' + width + '.png') });
  }
  await card.getByText('View score breakdown', { exact: true }).click();
  await expect(card.getByText('Spindle insulation resistance', { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(card.locator('.mh-status')).toHaveCSS('color', 'rgb(167, 243, 208)');
});

test('zero is a real bad score; missing health is unavailable; stale results say last recorded', async ({ authedPage: page }) => {
  const api = await serve(page, { ...health, score: 0, status: 'Bad', stale: true });
  const card = page.locator('app-machine-health-card');
  await expect(card.getByRole('img')).toHaveAttribute('aria-label', /0 percent, Bad/);
  await expect(card.locator('.mh-status')).toHaveClass(/is-bad/);
  await expect(card.getByText(/Last recorded/)).toBeVisible();
  api.health = null;
  await page.locator('form.mexa-titlebar').dispatchEvent('submit');
  await expect(card.getByText('Health score unavailable', { exact: true })).toBeVisible();
  await expect(card.getByRole('img')).toHaveCount(0);
});

test('load and spindle temperature share 60/80 bands; IR keeps low resistance critical', async ({ authedPage: page }) => {
  const api = await serve(page);
  const gauges = ['Spindle Load', 'Spindle Temp', 'Servo Load X', 'Servo Load Y', 'Servo Load Z'];
  for (const [value, word, color] of [[59.9, 'Healthy', 'rgb(4, 120, 87)'], [60, 'Normal', 'rgb(180, 83, 9)'], [79.9, 'Normal', 'rgb(180, 83, 9)'], [80, 'Critical', 'rgb(185, 28, 28)'], [100, 'Critical', 'rgb(185, 28, 28)']] as const) {
    Object.assign(api.row, { spindle_load: value, spindle_motor_temp: value, servo_load_x: value, servo_load_y: value, servo_load_z: value });
    await page.locator('form.mexa-titlebar').dispatchEvent('submit');
    for (const label of gauges) {
      const gauge = page.locator('.mt-gauge').filter({ has: page.getByText(label, { exact: true }) });
      await expect(gauge.locator('.mt-word')).toHaveText(word);
      await expect(gauge.locator('.mt-word')).toHaveCSS('color', color);
    }
  }
  for (const [value, word] of [[5, 'Critical'], [50, 'Normal'], [150, 'Healthy']] as const) {
    api.row.spindle_insulation_res = value;
    await page.locator('form.mexa-titlebar').dispatchEvent('submit');
    await expect(page.locator('.mt-gauge').filter({ has: page.getByText('Spindle IR', { exact: true }) }).locator('.mt-word')).toHaveText(word);
  }
});
