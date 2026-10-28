import { test, expect } from './fixtures/auth';

/*
 * The Maintenance screen's fans, batteries and supply voltage, from what the
 * collector now stores (Oct 2026, machine 192.168.200.1):
 *
 *   fan_status          {"CNC_FAN1": {"on": true, "fault": false, "rpm": 10206}, ...}   from cnc_fans
 *   apc_battery_status  {"X": false, "Y": false, "Z": false}                         from battery
 *   supply              the energy meter's latest L-N and L-L voltages (PowerData)
 *
 * No battery voltage at all. Before this, the fans of these payloads were
 * stored as "[object Object]" and the battery was dropped.
 *
 * 8 Oct 2026, the embedded team: show the fan numbers; the battery object
 * holds five or six axes — show them separately; PowerData's LN and LL
 * parameters — show them separately for voltage.
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
  controller_type: 'FANUC', battery_supported: true,
  cnc_battery_voltage: null, apc_battery_voltage: null,
  fan_status: {
    CNC_FAN1: { on: true, fault: false, rpm: 10206 },
    CNC_FAN2: { on: true, fault: false, rpm: 10213 }
  },
  apc_battery_status: { X: false, Y: false, Z: false },
  ...o
});

const supplyOk = () => ({
  read_at: new Date().toISOString(), stale: false,
  ln: { v1n: 242.3, v2n: 243.79, v3n: 242.22, avg: 242.77 },
  ll: { v12: 421.2, v23: 421.16, v31: 419.12, avg: 420.49 },
  limits: { ll_nominal: 415, ln_nominal: 240, tolerance_pct: 10, imbalance_pct: 2 }
});

const payload = (r: any, supply: any = null) => ok({
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
  cycle_trend: [],
  supply
});

async function mockApi(page: any, r: any, supply: any = null) {
  await page.route('**/api/**', (x: any) => x.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (x: any) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/maintenance*', (x: any) => x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(r, supply)) }));
}

const tile = (page: any, label: string) => page.locator(`section[aria-label="${label}"]`);
const axes = (page: any) => tile(page, 'ACC battery').getByRole('listitem');
const apcWord = (page: any) => tile(page, 'ACC battery').locator('.mt-apc-head .mt-word');

test('each fan by its number, with its speed and state; the battery axis by axis', async ({ authedPage: page }) => {
  await mockApi(page, row());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  const fans = tile(page, 'Cooling fans');
  // how many fans, then each by its number: CNC_FAN1 → "Fan 1" under "CNC fans"
  await expect(fans.locator('.mt-fans-head')).toContainText('CNC fans');
  await expect(fans.locator('.mt-fans-head .mt-count')).toHaveText('2');
  await expect(fans.locator('.mt-fan')).toHaveCount(2);
  await expect(fans.locator('.mt-fan-name')).toHaveText(['Fan 1', 'Fan 2']);
  await expect(fans.locator('.mt-fan').nth(0)).toContainText('10,206 rpm');
  await expect(fans.locator('.mt-fan').nth(1)).toContainText('10,213 rpm');
  await expect(fans.locator('.mt-word')).toHaveText(['Healthy', 'Healthy']);
  await expect(page.locator('body')).not.toContainText('object Object');

  // one battery per axis, each named, and the tile's word over all of them
  await expect(axes(page)).toHaveCount(3);
  await expect(axes(page).locator('.axis')).toHaveText(['X', 'Y', 'Z']);
  await expect(axes(page).locator('.word')).toHaveText(['Healthy', 'Healthy', 'Healthy']);
  await expect(axes(page).first()).toHaveAttribute('aria-label', 'X axis battery: Healthy');
  await expect(tile(page, 'ACC battery').locator('.mt-count')).toHaveText('3 axes');
  await expect(apcWord(page)).toHaveText('Healthy');
  // the collector sends no voltage, and the CNC battery is not one of the flags
  await expect(tile(page, 'CNC battery').locator('.mt-word')).toHaveText('Not reported');

  await page.waitForTimeout(800);
  await page.locator('.mt-cooling').screenshot({ path: 'mexa-maintenance-fans.png' });
});

test('a faulted fan remains Critical while a low battery axis asks for a check', async ({ authedPage: page }) => {
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
  // the line under the machine's name names the fan
  await expect(page.locator('.mt-attention')).toContainText('CNC fan 2 Fault · 0 rpm');

  // the low axis, on its own
  await expect(axes(page).nth(1)).toHaveAttribute('aria-label', 'Y axis battery: Battery issue');
  await expect(axes(page).nth(1)).toHaveClass(/is-low/);
  await expect(axes(page).locator('.word')).toHaveText(['Healthy', 'Battery issue', 'Healthy']);
  await expect(apcWord(page)).toHaveText('Battery issue');
  await expect(page.locator('.mt-attention')).toContainText('+');   // more than the fan needs a look

  await page.waitForTimeout(800);
  await page.locator('.mt-cooling').screenshot({ path: 'mexa-maintenance-fans-critical.png' });
});

test('older FANUC controllers keep fan words and report voltage without inferring battery health', async ({ authedPage: page }) => {
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
  await expect(tile(page, 'ACC battery')).toContainText('2.90 V reported');
  await expect(tile(page, 'ACC battery').locator('.mt-word')).toHaveText('Not reported');
  await expect(tile(page, 'CNC battery')).toContainText('Not reported');
});

test('on a phone the fan and battery tiles fit, nothing clipped or pushed sideways', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { X: true, Y: true, Z: false, A: false, B: false, W: false } }), supplyOk());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maintenance-dashboard');
  await expect(axes(page)).toHaveCount(6);
  await expect(axes(page).locator('.word')).toHaveText(['Battery issue', 'Battery issue', 'Healthy', 'Healthy', 'Healthy', 'Healthy']);

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: [...document.querySelectorAll('.mt-cooling .mt-tile-value, .mt-cooling .mt-fan-reading, .mt-cooling li, app-supply-voltage dd')]
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
  await expect(tile(page, 'Cooling fans').locator('.mt-count')).toHaveText('3');
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
  await expect(tile(page, 'ACC battery').locator('.fill')).toHaveCount(0);
});

test('turning fans add no recurring style work to the rest of the dashboard', async ({ authedPage: page }) => {
  await mockApi(page, row());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  const fans = tile(page, 'Cooling fans').locator('.mt-fan-icon.is-spinning');
  await expect(fans).toHaveCount(2);
  await page.waitForTimeout(1500);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const recalcs = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find((metric: any) => metric.name === 'RecalcStyleCount')!.value;
  const samples = async () => {
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = await recalcs();
      await page.waitForTimeout(1000);
      counts.push(await recalcs() - before);
    }
    return Math.min(...counts);
  };
  const running = await samples();
  await fans.evaluateAll(elements => elements.forEach(element => (element as HTMLElement).style.animationPlayState = 'paused'));
  const paused = await samples();
  // Other page animations (machine status / refresh) remain active in both
  // samples. Compare the same page with only the fans paused to isolate them.
  expect(running - paused, `style recalculations: fans running ${running}/s; paused ${paused}/s`).toBeLessThan(10);
});

test('battery warning icons do not imply a measured charge level', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { X: false, Y: false, Z: false }, cnc_battery_voltage: null }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(tile(page, 'ACC battery').locator('.fill')).toHaveCount(0);
  await expect(tile(page, 'CNC battery').locator('.mt-battery-fill')).toHaveCount(0);
  await expect(page.getByText('Battery warning codes', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Controller warnings only; battery charge is not measured.', { exact: true })).toHaveCount(0);
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
  await page.clock.install();
  await page.goto('/maintenance-dashboard');
  const icon = tile(page, 'Cooling fans').locator('.mt-fan-icon').first();
  await expect(icon).toHaveClass(/is-spinning/);
  await icon.evaluate((e: any) => { e.__sameElement = true; });

  const before = served;
  await page.clock.fastForward(60_000);
  await expect.poll(() => served).toBeGreaterThan(before);
  await expect(tile(page, 'Cooling fans').locator('.mt-fan')).toHaveCount(2);
  expect(await icon.evaluate((e: any) => e.__sameElement === true)).toBe(true);
});

test('a slower fan turns visibly slower; a healthy one\'s rpm wobble does not change its pace', async ({ authedPage: page }) => {
  await mockApi(page, row({ fan_status: {
    CNC_FAN1: { on: true, fault: false, rpm: 10206 },
    CNC_FAN2: { on: true, fault: false, rpm: 9950 },
    CNC_FAN3: { on: true, fault: false, rpm: 5000 }
  } }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  const icons = tile(page, 'Cooling fans').locator('.mt-fan-icon');
  await expect(icons).toHaveCount(3);
  const pace = (i: number) => icons.nth(i).evaluate((e: Element) => getComputedStyle(e).animationDuration);
  expect(await pace(0)).toBe('1.2s');
  expect(await pace(1)).toBe('1.2s');
  expect(await pace(2)).toBe('2.4s');
});

test('battery axes read in the machine\'s order, not the database\'s', async ({ authedPage: page }) => {
  // JSONB hands a 4-axis machine's flags back as B, X, Y, Z
  await mockApi(page, row({ apc_battery_status: { B: false, X: false, Y: false, Z: false } }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(axes(page).locator('.axis')).toHaveText(['X', 'Y', 'Z', 'B']);
  await expect(apcWord(page)).toHaveText('Healthy');
});

test('five or six axes (HMC - 15 - F sends B, W, X, Y, Z): each its own battery, in the machine\'s order', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { B: false, W: true, X: false, Y: false, Z: false } }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(axes(page).locator('.axis')).toHaveText(['X', 'Y', 'Z', 'B', 'W']);
  await expect(axes(page).nth(4)).toHaveAttribute('aria-label', 'W axis battery: Battery issue');
  await expect(tile(page, 'ACC battery').locator('.mt-count')).toHaveText('5 axes');
  await expect(page.locator('.mt-attention')).toContainText('ACC battery W');
});

test('nothing reported: the design\'s fan position "Not reported", no count; the battery and supply say so too', async ({ authedPage: page }) => {
  await mockApi(page, row({ fan_status: null, apc_battery_status: null }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();

  await expect(tile(page, 'Cooling fans').locator('.mt-fans-head')).toHaveCount(0);
  await expect(tile(page, 'Cooling fans').locator('.mt-word').first()).toHaveText('Not reported');
  await expect(axes(page)).toHaveCount(0);
  await expect(tile(page, 'ACC battery').locator('.mt-word')).toHaveText('Not reported');
  await expect(page.locator('app-supply-voltage')).toContainText('Not reported — no energy meter reading');
});

/* ── supply voltage: PowerData's L-N and L-L, as two groups ── */

const supplyCard = (page: any) => page.locator('app-supply-voltage');

test('the supply voltage: phase to neutral and phase to phase, each phase, average and how far apart', async ({ authedPage: page }) => {
  await mockApi(page, row(), supplyOk());
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');

  const ln = supplyCard(page).getByRole('group', { name: 'Phase to neutral voltage' });
  const ll = supplyCard(page).getByRole('group', { name: 'Phase to phase voltage' });
  await expect(ln.locator('dt')).toHaveText(['L1-N', 'L2-N', 'L3-N', 'Average']);
  await expect(ln.locator('dd')).toHaveText(['242.3 volts', '243.8 volts', '242.2 volts', '242.8 volts']);
  await expect(ll.locator('dt')).toHaveText(['L1-L2', 'L2-L3', 'L3-L1', 'Average']);
  await expect(ll.locator('dd')).toHaveText(['421.2 volts', '421.2 volts', '419.1 volts', '420.5 volts']);
  await expect(ln).toContainText('Phases apart 0.4 %');
  await expect(ll).toContainText('Phases apart 0.3 %');
  await expect(supplyCard(page).locator('.word')).toHaveText('Healthy');
  await expect(supplyCard(page).locator('.at')).toContainText('Reading');
  await expect(supplyCard(page).getByRole('button', { name: 'What is Supply voltage?' })).toBeVisible();
  await page.locator('app-supply-voltage').screenshot({ path: 'mexa-maintenance-supply.png' });
});

test('a phase outside the supply tolerance is red, Critical, and named on the attention line; an old reading says so', async ({ authedPage: page }) => {
  await mockApi(page, row({ apc_battery_status: { X: false, Y: false, Z: false } }), {
    ...supplyOk(), read_at: new Date(Date.now() - 30 * 60_000).toISOString(), stale: true,
    ln: { v1n: 242.3, v2n: 205.1, v3n: 242.2, avg: 229.9 }
  });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');

  const ln = supplyCard(page).getByRole('group', { name: 'Phase to neutral voltage' });
  await expect(ln.locator('.phase.is-out dt')).toHaveText(['L2-N']);
  await expect(ln.locator('.phase.is-out dd')).toHaveText('205.1 volts, outside the supply tolerance');
  await expect(supplyCard(page).locator('.word')).toHaveText('Critical');
  await expect(supplyCard(page).locator('.at')).toHaveClass(/is-stale/);
  await expect(supplyCard(page).locator('.at')).toContainText('Last reading');
  await expect(page.locator('.mt-attention')).toContainText('Supply voltage L2-N 205.1 V');
});

test('phases more than 2 % apart but all in tolerance: Stable', async ({ authedPage: page }) => {
  await mockApi(page, row(), { ...supplyOk(), ll: { v12: 430, v23: 410, v31: 405, avg: 415 } });
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(supplyCard(page).locator('.phase.is-out')).toHaveCount(0);
  await expect(supplyCard(page).locator('.word')).toHaveText('Stable');
  await expect(page.locator('.mt-attention')).toContainText('Supply voltage L-L 3.6 % apart');
});

/* FANUC diagnostics introduced by the embedded collector on 28 Oct 2026. */
const clearAxis = () => ({ low: false, ABP: false, INP: false, EXP: false, raw: 0 });

test('FANUC ACC shows every reported axis and the specific active detector warnings', async ({ authedPage: page }) => {
  await mockApi(page, row({ acc_battery_status: {
    B: { low: null, ABP: null, INP: null, EXP: null },
    A: clearAxis(), X: { ...clearAxis(), low: true, ABP: true },
    Y: { ...clearAxis(), low: true, INP: true }, Z: { ...clearAxis(), low: true, EXP: true }
  }, cnc_battery_warning: { warning: true, raw_alarm_value: 0 } }));
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/maintenance-dashboard');
  await expect(axes(page).locator('.axis')).toHaveText(['X', 'Y', 'Z', 'A', 'B']);
  await expect(axes(page).locator('.word')).toHaveText(['Battery issue', 'Battery issue', 'Battery issue', 'Healthy', 'Not reported']);
  await expect(axes(page).locator('.flag')).toHaveText(['ABP', 'INP', 'EXP']);
  await expect(apcWord(page)).toHaveText('Battery issue');
  await expect(axes(page).first()).toHaveAttribute('aria-label', /A\/B phase detector battery low \(bit 3\)/);
  await expect(tile(page, 'CNC battery')).toContainText('Battery warning');
  await expect(tile(page, 'CNC battery')).toContainText('Check battery');
  await expect(page.locator('.mt-state')).toHaveText('Running');
  await expect(axes(page).nth(1)).toHaveAttribute('aria-label', /Built-in serial pulse coder battery low/);
  await expect(axes(page).nth(2)).toHaveAttribute('aria-label', /Separate \/ external serial detector battery low/);
});

test('CNC false warning remains clear even when the general alarm mask is nonzero', async ({ authedPage: page }) => {
  await mockApi(page, row({ acc_battery_status: { X: clearAxis() },
    cnc_battery_warning: { warning: false, raw_alarm_value: 56 } }));
  await page.goto('/maintenance-dashboard');
  await expect(tile(page, 'CNC battery').locator('.mt-word')).toHaveText('No warning reported');
  await expect(apcWord(page)).toHaveText('Healthy');
  await expect(page.locator('.mt-attention')).not.toContainText('battery');
});

test('unknown warnings and raw diagnostics do not become clear or faulty batteries', async ({ authedPage: page }) => {
  await mockApi(page, row({ acc_battery_status: { X: { raw: 56, status: 'LOW' }, Y: clearAxis() },
    cnc_battery_warning: { warning: null, raw_alarm_value: 0 } }));
  await page.goto('/maintenance-dashboard');
  await expect(axes(page).locator('.word')).toHaveText(['Not reported', 'Healthy']);
  await expect(apcWord(page)).toHaveText('Not reported');
  await expect(tile(page, 'CNC battery').locator('.mt-word')).toHaveText('Not reported');
  await expect(page.locator('.mt-attention')).not.toContainText('battery');
});

for (const controller of ['MITSUBISHI', null]) {
  test(`battery diagnostics are hidden for ${controller || 'an unknown controller'}`, async ({ authedPage: page }) => {
    await mockApi(page, row({ controller_type: controller, battery_supported: false,
      acc_battery_status: { X: { ...clearAxis(), low: true, ABP: true } },
      cnc_battery_warning: { warning: true } }));
    await page.goto('/maintenance-dashboard');
    await expect(page.locator('.mt-machine')).toBeVisible();
    await expect(tile(page, 'ACC battery')).toHaveCount(0);
    await expect(tile(page, 'CNC battery')).toHaveCount(0);
    await expect(page.locator('.mt-attention')).not.toContainText('battery');
  });
}

test('failed machine selection removes the previous machine battery diagnostics', async ({ authedPage: page }) => {
  await mockApi(page, row({ acc_battery_status: { X: { ...clearAxis(), low: true, ABP: true } } }));
  await page.route('**/api/charts/meta*', route => route.fulfill({ json: { ...meta, data: {
    ...meta.data, machines: [...meta.data.machines, { id: 20, machine_serial_no: 'VMC - 3 - F' }]
  } } }));
  await page.goto('/maintenance-dashboard');
  await expect(axes(page).locator('.word')).toHaveText('Battery issue');
  await page.route('**/api/dashboard/maintenance*', route => route.fulfill({ status: 500,
    json: { status: 'error', message: 'Unable to load this machine.' } }));
  await page.locator('#mtMachine').selectOption({ label: 'VMC - 3 - F' });
  await expect(page.getByRole('alert')).toContainText('Unable to load this machine.');
  await expect(page.locator('.mt-machine')).toHaveCount(0);
  await expect(tile(page, 'ACC battery')).toHaveCount(0);
});

test('five-axis FANUC battery diagnostics fit on a narrow phone', async ({ authedPage: page }) => {
  await mockApi(page, row({ acc_battery_status: { X: { ...clearAxis(), ABP: true, INP: true, EXP: true },
    Y: clearAxis(), Z: clearAxis(), A: clearAxis(), B: {} }, cnc_battery_warning: { warning: true } }));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/maintenance-dashboard');
  await expect(axes(page)).toHaveCount(5);
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: [...document.querySelectorAll('.mt-tiles li, .mt-battery-warning')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent?.trim())
  }));
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.clipped).toEqual([]);
});
