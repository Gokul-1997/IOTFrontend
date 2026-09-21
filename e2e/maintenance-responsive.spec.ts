import { test, expect } from './fixtures/auth';

/*
 * The Maintenance screen on a phone and in dark mode.
 *
 * This screen is denser than the others — a per-axis table, two donuts and a
 * trend — so it is the one most likely to push the page sideways at 390px.
 */

const ok = (data: any) => ({ status: 'success', data });

const meta = { success: true, data: {
  machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

const maintenance = ok({
  filters: { date: '2026-06-18', shift_id: null, machine_id: 1 },
  updated_at: '2026-06-18T10:30:00.000Z',
  machines: { total: 1, running: 1, idle: 0, breakdown: 0, offline: 0 },
  health: { healthy: 1, unhealthy: 0, percent: 100, basis: 'Reporting within 60s and not in alarm' },
  alarms: { total: 62, open: 7, critical: 5, non_critical: 12, information: 45 },
  oee: { availability: 0.89, performance: 0.88, quality: 0.95, oee: 0.82 },
  production: { produced: 12560, run_seconds: 66600, idle_seconds: 18720 },
  unavailable: ['encoder_temperature', 'battery_status'],
  rows: [{
    machine_id: 1, machine_serial_no: 'CNC-01', component_id: '602004', part_name: 'VALVE_OP20',
    target_qty: 400, operator_name: 'Suresh Babu', machine_status: 'RUNNING', alarm: false,
    spindle_load: 75, feed_rate: 1200, spindle_speed: 70, spindle_motor_temp: 36,
    sequence_number: 100, received_at: new Date().toISOString(), run_seconds: 16338,
    servo_load_x: 5, servo_load_y: 6, servo_load_z: 6, servo_temp_x: 27
  }],
  condition_trend: []
});

async function mockApi(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/maintenance*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(maintenance) }));
}

test('fits a phone without scrolling sideways', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await page.waitForTimeout(1500);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);

  const widest = await page.evaluate(() => Math.max(
    ...Array.from(document.querySelectorAll('.mexa-card, .mexa-kpi'))
      .map(el => Math.round(el.getBoundingClientRect().right))));
  expect(widest).toBeLessThanOrEqual(390);

  await page.screenshot({ path: 'mexa-maintenance-mobile.png', fullPage: true });
});

test('axis readings stay legible in dark mode', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(600);

  const report = await page.evaluate(() => {
    const cell = document.querySelector('.mexa-axistable td') as HTMLElement | null;
    const card = document.querySelector('.mexa-card') as HTMLElement | null;
    if (!cell || !card) return null;
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(getComputedStyle(cell).color), b = lum(getComputedStyle(card).backgroundColor);
    return { color: getComputedStyle(cell).color, card: getComputedStyle(card).backgroundColor,
             ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });

  await page.screenshot({ path: 'mexa-maintenance-dark.png', fullPage: true });
  console.log('dark-mode axis cell:', JSON.stringify(report));
  expect(report, 'no axis table found').not.toBeNull();
  expect(report!.card, 'dark mode did not apply').not.toBe('rgb(255, 255, 255)');
  expect(report!.ratio).toBeGreaterThanOrEqual(4.5);
});

/* Cycle Time was taken off this screen on 2026-09-21: cycle time per part is
   a production measure, and this dashboard is about machine condition. The
   backend no longer computes it either, so a chart left behind would draw
   from a field that is never sent. */
test('there is no Cycle Time chart', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();

  await expect(page.getByText(/Cycle Time/i)).toHaveCount(0);
  await expect(page.getByText(/Seconds per part/i)).toHaveCount(0);
  // the screen still shows what it is for
  await expect(page.getByText('Alarm Summary')).toBeVisible();
});
