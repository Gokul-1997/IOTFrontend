import { test, expect } from './fixtures/auth';

/*
 * The Maintenance screen's polish (Oct 2026): what needs a look is said at the
 * top of the machine card, a reading that has just got worse pulses briefly
 * and is announced once, a live running machine's dot breathes, and the
 * charts are drawn again only when their data changes — without leaving
 * ApexCharts tooltips behind, which updateSeries does.
 *
 * Data shaped like production's HMC - 7 - F.
 */

const ok = (data: any) => ({ status: 'success', data });
const meta = { success: true, data: {
  machines: [{ id: 25, machine_serial_no: 'HMC - 7 - F' }, { id: 19, machine_serial_no: 'VMC - 2 - F' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }, { id: 11, shift_code: 'S2', shift_name: 'Shift 2' }] } };

const hour = (h: number) => new Date(Date.UTC(2026, 9, 6, h - 6, 30)).toISOString();   // IST hours

const row = (o: any = {}) => ({
  machine_id: 25, machine_serial_no: 'HMC - 7 - F', image_url: null, component_id: '74', part_name: 'FEED BOX',
  target_qty: 40, operator_name: 'MANICKAM', machine_status: 'RUNNING', alarm: false,
  spindle_load: 0, feed_rate: 1200, received_at: new Date().toISOString(), run_seconds: 36900,
  spindle_speed: 1800, spindle_motor_temp: 47, spindle_insulation_res: null,
  servo_load_x: 3, servo_load_y: 20, servo_load_z: 41,
  servo_temp_x: 33, servo_temp_y: 37, servo_temp_z: 34,
  encoder_temp_x: 39, encoder_temp_y: 42, encoder_temp_z: 38,
  cnc_battery_voltage: null, apc_battery_voltage: null, sequence_number: null,
  fan_status: { CNC_FAN1: { on: true, fault: false, rpm: 10206 }, CNC_FAN2: { on: true, fault: false, rpm: 10394 } },
  apc_battery_status: { B: false, X: false, Y: false, Z: false },
  ...o
});

const payload = (r: any, o: any = {}) => ok({
  filters: { date: '2026-10-06', shift_id: null, machine_id: 25 },
  updated_at: new Date().toISOString(),
  machines: { total: 18, running: 9, idle: 4, breakdown: 1, offline: 4 },
  health: { healthy: 13, unhealthy: 5, percent: 72, basis: 'Reporting within 60s and not in alarm' },
  alarms: { total: 8, open: 2, critical: 0, non_critical: 8, information: 0 },
  oee: { availability: 0.82, performance: 0.74, quality: 0.99, oee: 0.6 },
  production: { produced: 24, run_seconds: 36900, idle_seconds: 3000 },
  unavailable: ['insulation_resistance'],
  rows: [r],
  condition_trend: [8, 9, 10, 11, 12].map((h, i) => ({ hour_start: hour(h),
    servo_temp_x: 30 + i * 0.4, servo_temp_y: 34 + i * 0.7, servo_temp_z: 30.5 + i * 0.6, spindle_motor_temp: 46 + i * 0.3 })),
  cycle_trend: [8, 9, 10, 11].map((h, i) => ({ hour_start: hour(h), produced: 2, cycle_seconds: [1440, 1580, 1470, 1470][i] })),
  ...o
});

/** Serves `api.body` — change it, then refresh — and counts the calls. (Opening
 *  the page makes two: one to pick a reporting machine, then the first poll.) */
async function serve(page: any, body: any) {
  const api = { body, n: 0 };
  await page.route('**/api/**', (x: any) => x.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (x: any) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/maintenance*', (x: any) => {
    api.n++;
    return x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api.body) });
  });
  return api;
}

/** A refresh with `body`, as a filter change makes one; resolves once it is shown. */
async function refresh(page: any, api: { body: any; n: number }, body: any, shift: number) {
  api.body = body;
  const before = api.n;
  await page.locator('#mtShift').selectOption({ index: shift });
  await expect.poll(() => api.n).toBeGreaterThan(before);
  await page.waitForTimeout(400);
}

const attention = (page: any) => page.locator('.mt-attention');

test('the machine card says what needs a look, worst first — or that nothing does', async ({ authedPage: page }) => {
  await serve(page, payload(row({ servo_load_z: 121, spindle_motor_temp: 64 })));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  await expect(attention(page)).toHaveClass(/is-critical/);
  await expect(attention(page)).toContainText('Servo load Z 121% · Critical');
  await expect(attention(page)).toContainText('+1 more');
  // the full list for a screen reader and the tooltip
  await expect(attention(page)).toHaveAttribute('title', /Servo load Z 121% \(critical\), Spindle temp 64 °C \(stable\)/);
});

test('all readings within limits: one calm line, no list', async ({ authedPage: page }) => {
  await serve(page, payload(row()));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  await expect(attention(page)).toHaveText('All reported readings normal');
  await expect(attention(page)).not.toHaveClass(/is-critical|is-stable/);
});

test('a machine in alarm leads the line', async ({ authedPage: page }) => {
  await serve(page, payload(row({ alarm: true, servo_load_z: 121 })));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-state')).toContainText('Alarm');
  await expect(attention(page)).toContainText('Machine in alarm · +1 more');
});

test('a reading that just got worse pulses and is announced once; the next refresh is calm', async ({ authedPage: page }) => {
  const api = await serve(page, payload(row()));      // first look: nothing is "new"
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  const servoZ = page.locator('.mt-gauge').filter({ hasText: 'Servo Load Z' });
  await expect(servoZ).toBeVisible();
  await expect(page.locator('.is-new-alert')).toHaveCount(0);

  await refresh(page, api, payload(row({ servo_load_z: 121 })), 1);   // got worse
  await expect(servoZ).toHaveClass(/is-new-alert/);
  const pulse = await servoZ.locator('.mt-word').evaluate((e: Element) => {
    const cs = getComputedStyle(e);
    return { name: cs.animationName, count: cs.animationIterationCount };
  });
  expect(pulse.name).toContain('mt-alert');
  expect(pulse.count).toBe('3');                      // a few times, then still — never a blink loop
  await expect(page.locator('[role="status"]').first()).toHaveText('Now critical: Servo load Z 121%');

  await refresh(page, api, payload(row({ servo_load_z: 122 })), 2);   // still critical: nothing new
  await expect(servoZ).not.toHaveClass(/is-new-alert/);
  await expect(page.locator('[role="status"]').first()).toHaveText('');
});

test('a running, live machine\'s dot breathes; an offline machine\'s is hollow and still', async ({ authedPage: page }) => {
  const api = await serve(page, payload(row()));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  const dot = page.locator('.mt-state-dot');
  const after = () => dot.evaluate((e: Element) => getComputedStyle(e, '::after').animationName);
  expect(await after()).toContain('mt-live');

  await refresh(page, api, payload(row({ received_at: new Date(Date.now() - 600_000).toISOString() })), 1);
  await expect(page.locator('.mt-state')).toContainText('Offline');
  expect(await after()).toBe('none');
  expect(await dot.evaluate((e: Element) => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('a refresh with the same data draws no chart again; new data redraws without leaving tooltips behind', async ({ authedPage: page }) => {
  const changed = payload(row({ servo_temp_x: 35, encoder_temp_y: 44 }));
  changed.data.cycle_trend[3].cycle_seconds = 1530;
  const api = await serve(page, payload(row()));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('apx-chart svg.apexcharts-svg')).toHaveCount(5);
  await page.waitForTimeout(500);

  const svgs = () => page.evaluate(() => Array.from(document.querySelectorAll('apx-chart svg.apexcharts-svg'))
    .map((s: any) => (s.__seen ??= Math.random().toString(36).slice(2))));
  const tooltips = () => page.evaluate(() => document.querySelectorAll('.apexcharts-tooltip').length);
  const first = await svgs();
  const tips = await tooltips();

  await refresh(page, api, payload(row()), 1);       // same data
  expect(await svgs()).toEqual(first);

  await refresh(page, api, changed, 2);              // new readings and a new cycle time
  await refresh(page, api, changed, 1);              // and the same again
  const after = await svgs();
  expect(after.filter((id, i) => id !== first[i]).length).toBeGreaterThan(0);   // the changed charts were redrawn
  expect(await tooltips()).toBe(tips);               // and left nothing behind
});

test('dark mode: the readings above the bars take the card\'s ink, switched without a reload', async ({ authedPage: page }) => {
  await serve(page, payload(row()));
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.goto('/maintenance-dashboard');
  const label = page.locator('.mt-bars .apexcharts-datalabel').first();
  await expect(label).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const fill = await label.evaluate((e: Element) => getComputedStyle(e).fill);
  const ink = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--mexa-ink)';
    document.querySelector('app-maintenance-dashboard')!.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove(); return c;
  });
  expect(fill).toBe(ink);
});

test('tablet: cycle time and alarms side by side, the trend across both under them', async ({ authedPage: page }) => {
  await serve(page, payload(row()));
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('/maintenance-dashboard');
  const box = (sel: string) => page.locator(sel).boundingBox();
  await expect(page.locator('.mt-trend')).toBeVisible();
  const [cycle, alarms, trend] = [await box('.mt-cycle'), await box('.mt-alarms'), await box('.mt-trend')];
  expect(Math.abs(cycle!.y - alarms!.y)).toBeLessThan(2);
  expect(trend!.y).toBeGreaterThan(cycle!.y + cycle!.height - 1);
  expect(trend!.width).toBeGreaterThan(cycle!.width * 1.8);
  // the machine photo no longer fills a half-width card
  expect((await box('.mt-machine-img'))!.height).toBeLessThanOrEqual(201);
});
