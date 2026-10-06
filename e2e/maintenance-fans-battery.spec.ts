import { test, expect } from './fixtures/auth';

/*
 * The Maintenance screen's fans and batteries, from what the collector now
 * stores (Oct 2026, machine 192.168.200.1):
 *
 *   fan_status          {"CNC_FAN1": {"on": true, "fault": false, "rpm": 10206}, ...}   from cnc_fans
 *   apc_battery_status  {"X": false, "Y": false, "Z": false}                         from battery
 *
 * No battery voltage at all. Before this, the fans of these payloads were
 * stored as "[object Object]" and the battery was dropped.
 */

const ok = (data: any) => ({ status: 'success', data });

const meta = { success: true, data: {
  machines: [{ id: 19, machine_serial_no: 'VMC - 2 - F' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

const row = (o: any = {}) => ({
  machine_id: 19, machine_serial_no: 'VMC - 2 - F', component_id: null, part_name: null,
  target_qty: null, operator_name: null, machine_status: 'RUNNING', alarm: false,
  spindle_load: 3, feed_rate: 65, spindle_speed: 850, spindle_motor_temp: 51,
  sequence_number: null, received_at: new Date().toISOString(), run_seconds: 382,
  servo_load_x: 4, servo_load_y: 7, servo_load_z: 25,
  servo_temp_x: null, servo_temp_y: null, servo_temp_z: 42,
  encoder_temp_x: 31, encoder_temp_y: 34, encoder_temp_z: 43,
  cnc_battery_voltage: null, apc_battery_voltage: null,
  fan_status: {
    CNC_FAN1: { on: true, fault: false, rpm: 10206 },
    CNC_FAN2: { on: true, fault: false, rpm: 10213 }
  },
  apc_battery_status: { X: false, Y: false, Z: false },
  ...o
});

const payload = (r: any) => ok({
  filters: { date: '2026-10-06', shift_id: null, machine_id: 19 },
  updated_at: new Date().toISOString(),
  machines: { total: 1, running: 1, idle: 0, breakdown: 0, offline: 0 },
  health: { healthy: 1, unhealthy: 0, percent: 100, basis: 'Reporting within 60s and not in alarm' },
  alarms: { total: 0, open: 0, critical: 0, non_critical: 0, information: 0 },
  oee: { availability: null, performance: null, quality: null, oee: null },
  production: { produced: 19, run_seconds: 382, idle_seconds: 0 },
  unavailable: ['insulation_resistance'],
  rows: [r],
  condition_trend: [],
  cycle_trend: []
});

async function mockApi(page: any, r: any) {
  await page.route('**/api/**', (x: any) => x.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (x: any) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/maintenance*', (x: any) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(r)) }));
}

const tile = (page: any, label: string) => page.locator(`section[aria-label="${label}"]`);

test('each fan shows its speed and state; the battery its axes', async ({ authedPage: page }) => {
  await mockApi(page, row());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  const fans = tile(page, 'Cooling fans');
  await expect(fans.locator('.mt-fan')).toHaveCount(2);
  await expect(fans.locator('.mt-fan').nth(0)).toContainText('CNC Fan 1');
  await expect(fans.locator('.mt-fan').nth(0)).toContainText('10,206 rpm');
  await expect(fans.locator('.mt-fan').nth(1)).toContainText('10,213 rpm');
  await expect(fans.locator('.mt-word')).toHaveText(['Healthy', 'Healthy']);
  await expect(page.locator('body')).not.toContainText('object Object');

  await expect(tile(page, 'CNC fans').locator('.mt-word')).toHaveText('Healthy');
  await expect(tile(page, 'APC battery')).toContainText('X Y Z OK');
  await expect(tile(page, 'APC battery').locator('.mt-word')).toHaveText('Healthy');
  // the collector sends no voltage, and the CNC battery is not one of the flags
  await expect(tile(page, 'CNC battery').locator('.mt-word')).toHaveText('Not reported');

  await page.waitForTimeout(800);
  await page.locator('.mt-cooling').screenshot({ path: 'mexa-maintenance-fans.png' });
});

test('a faulted fan and a low battery axis read Critical, and say which', async ({ authedPage: page }) => {
  await mockApi(page, row({
    fan_status: {
      CNC_FAN1: { on: true, fault: false, rpm: 10206 },
      CNC_FAN2: { on: false, fault: true, rpm: 0 },
      CNC_FAN3: { on: false, fault: false }
    },
    apc_battery_status: { X: false, Y: true, Z: false }
  }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  const fans = tile(page, 'Cooling fans').locator('.mt-fan');
  await expect(fans.nth(1)).toContainText('Fault · 0 rpm');
  await expect(fans.nth(1).locator('.mt-word')).toHaveText('Critical');
  // off but not faulted: worth a look, not an alarm
  await expect(fans.nth(2)).toContainText('Off');
  await expect(fans.nth(2).locator('.mt-word')).toHaveText('Stable');
  await expect(tile(page, 'CNC fans').locator('.mt-word')).toHaveText('Critical');

  await expect(tile(page, 'APC battery')).toContainText('Y low');
  await expect(tile(page, 'APC battery').locator('.mt-word')).toHaveText('Critical');

  await page.waitForTimeout(800);
  await page.locator('.mt-cooling').screenshot({ path: 'mexa-maintenance-fans-critical.png' });
});

test('older controllers: a word per fan and a battery voltage still read as before', async ({ authedPage: page }) => {
  await mockApi(page, row({
    fan_status: { radiator_fan1: 'OK', radiator_fan2: 'NG' },
    apc_battery_status: null, apc_battery_voltage: 2.9, cnc_battery_voltage: 3.1
  }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  const fans = tile(page, 'Cooling fans');
  await expect(fans.locator('.mt-fan-name')).toHaveText(['Radiator Fan 1', 'Radiator Fan 2']);
  await expect(fans.locator('.mt-word')).toHaveText(['Healthy', 'Critical']);
  await expect(tile(page, 'APC battery')).toContainText('2.90 v');
  await expect(tile(page, 'APC battery').locator('.mt-word')).toHaveText('Stable');
  await expect(tile(page, 'CNC battery')).toContainText('3.10 v');
});

test('on a phone the fan and battery tiles fit, nothing clipped or pushed sideways', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { X: true, Y: true, Z: false } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maintenance-dashboard');
  await expect(tile(page, 'APC battery')).toContainText('X, Y low');

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: [...document.querySelectorAll('.mt-cooling .mt-tile-value, .mt-cooling .mt-fan-reading')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent?.trim())
  }));
  expect(overflow.page, 'horizontal overflow in px').toBeLessThanOrEqual(1);
  expect(overflow.clipped).toEqual([]);
  await page.locator('.mt-cooling').screenshot({ path: 'mexa-maintenance-fans-phone.png' });
});

/* ── motion: lightweight, and only ever saying what is live ── */

const spinOf = (el: any) => el.evaluate((e: Element) => {
  const cs = getComputedStyle(e);
  return { name: cs.animationName, state: cs.animationPlayState };
});

test('a turning fan turns; an off or faulted fan is still', async ({ authedPage: page }) => {
  await mockApi(page, row({ fan_status: {
    CNC_FAN1: { on: true, fault: false, rpm: 10206 },
    CNC_FAN2: { on: true, fault: true, rpm: 3100 },
    CNC_FAN3: { on: false, fault: false, rpm: 0 }
  } }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  const icons = tile(page, 'Cooling fans').locator('.mt-fan-icon');
  await expect(icons).toHaveCount(3);

  await expect(icons.nth(0)).toHaveClass(/is-spinning/);
  const spin = await spinOf(icons.nth(0));
  expect(spin.name).toContain('mt-fan-spin');
  expect(spin.state).toBe('running');
  // a faulted fan may still be turning slowly, but it reads as a fault, not as motion
  await expect(icons.nth(1)).not.toHaveClass(/is-spinning/);
  await expect(icons.nth(2)).not.toHaveClass(/is-spinning/);
  expect((await spinOf(icons.nth(2))).name).toBe('none');
  // the summary icon turns while any fan does
  await expect(tile(page, 'CNC fans').locator('.mt-fan-icon')).toHaveClass(/is-spinning/);
});

test('a machine that has stopped reporting shows its fans still', async ({ authedPage: page }) => {
  await mockApi(page, row({ received_at: new Date(Date.now() - 10 * 60_000).toISOString() }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-state')).toContainText('Offline');
  await expect(tile(page, 'Cooling fans').locator('.mt-fan-icon')).toHaveCount(2);
  await expect(page.locator('.mt-fan-icon.is-spinning')).toHaveCount(0);
});

test('off-screen the fans pause; back on screen they turn again', async ({ authedPage: page }) => {
  await mockApi(page, row());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maintenance-dashboard');
  const cooling = page.locator('.mt-cooling');
  const icon = tile(page, 'Cooling fans').locator('.mt-fan-icon').first();
  await expect(icon).toHaveClass(/is-spinning/);

  // on a phone the fan cards start below the fold
  await expect(cooling).toHaveClass(/is-paused/);
  expect((await spinOf(icon)).state).toBe('paused');

  await cooling.scrollIntoViewIfNeeded();
  await expect(cooling).not.toHaveClass(/is-paused/);
  expect((await spinOf(icon)).state).toBe('running');
});

test('for anyone who asked for less motion, nothing turns or slides', async ({ authedPage: page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, row());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  const icon = tile(page, 'Cooling fans').locator('.mt-fan-icon').first();
  // still marked as running — only the motion is withheld
  await expect(icon).toHaveClass(/is-spinning/);
  expect((await spinOf(icon)).name).toBe('none');
  const fill = tile(page, 'APC battery').locator('.mt-battery-fill');
  expect(await fill.evaluate((e: Element) => getComputedStyle(e).transitionDuration)).toBe('0s');
});

test('turning fans stay off the main thread: no style work per frame', async ({ authedPage: page }) => {
  await mockApi(page, row());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(tile(page, 'Cooling fans').locator('.mt-fan-icon.is-spinning')).toHaveCount(2);
  await page.waitForTimeout(1500);   // first paint and the charts settle

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const recalcs = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'RecalcStyleCount')!.value;
  /* An animation run on the main thread recalculates style every frame, 60–120
     times a second, for as long as it turns; an IntersectionObserver anywhere
     on the page causes exactly that. Three one-second windows, judged by the
     quietest, so a chart finishing its first draw on a busy machine cannot
     fail this — a per-frame cost shows in every window. */
  const perSecond: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = await recalcs();
    await page.waitForTimeout(1000);
    perSecond.push(await recalcs() - before);
  }
  expect(Math.min(...perSecond), `style recalculations per second: ${perSecond}`).toBeLessThan(10);
});

test('the battery icons fill to their band', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { X: false, Y: false, Z: false }, cnc_battery_voltage: null }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(tile(page, 'APC battery').locator('.mt-battery-fill')).toHaveAttribute('style', /scaleY\(1\)/);
  // nothing reported: an empty outline, not three bars that look like a full battery
  await expect(tile(page, 'CNC battery').locator('.mt-battery-fill')).toHaveAttribute('style', /scaleY\(0\)/);
  await page.locator('.mt-tiles').screenshot({ path: 'mexa-maintenance-battery.png' });
});

test('a refresh keeps each fan\'s element, so a turning icon never snaps back', async ({ authedPage: page }) => {
  let served = 0;
  await mockApi(page, row());
  await page.route('**/api/dashboard/maintenance*', (x: any) => {
    served++;
    return x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(row())) });
  });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  const icon = tile(page, 'Cooling fans').locator('.mt-fan-icon').first();
  await expect(icon).toHaveClass(/is-spinning/);
  await icon.evaluate((e: any) => { e.__sameElement = true; });

  const before = served;
  await page.locator('#mtShift').selectOption({ index: 1 });
  await expect.poll(() => served).toBeGreaterThan(before);
  await expect(tile(page, 'Cooling fans').locator('.mt-fan')).toHaveCount(2);
  expect(await icon.evaluate((e: any) => e.__sameElement === true)).toBe(true);
});

test('nothing reported: the design\'s six fan positions, each "Not reported"', async ({ authedPage: page }) => {
  await mockApi(page, row({ fan_status: null, apc_battery_status: null }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  await expect(tile(page, 'Cooling fans').locator('.mt-fan')).toHaveCount(6);
  await expect(tile(page, 'Cooling fans').locator('.mt-word').first()).toHaveText('Not reported');
  await expect(tile(page, 'APC battery')).toContainText('--');
  await expect(tile(page, 'APC battery').locator('.mt-word')).toHaveText('Not reported');
});
