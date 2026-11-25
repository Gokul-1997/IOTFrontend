import { test, expect } from './fixtures/auth';

const machines = [{ id: 81, machine_serial_no: 'VMC - 19 - F' }];
const shifts = [{ id: 5, shift_name: 'Morning', shift_code: 'A', start_time: '08:00', end_time: '16:00' }];
const ok = (data: any) => ({ status: 'success', success: true, data });
async function base(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({ json: ok([]) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ json: ok({ machines, shifts }) }));
  await page.route('**/api/master/machines*', (r: any) => r.fulfill({ json: ok(machines) }));
  await page.route('**/api/master/shifts*', (r: any) => r.fulfill({ json: ok(shifts) }));
}

test('quality shows separate recorded reasons and saves them with the selected quantities', async ({ authedPage: page }) => {
  await base(page);
  let reasons = { rejection: 'Diameter out of tolerance', rework: 'Burr removal' };
  let saved: any;
  await page.route('**/api/quality*', r => r.fulfill({ json: ok({
    machine: { machine_serial_no: machines[0].machine_serial_no },
    production: { produced: 50, reject: 2, rework: 1, accepted: 47, quality_percent: 94 },
    quality_reasons: reasons, oee: {}, hourly: []
  }) }));
  await page.route('**/api/quality/entry', async r => {
    saved = r.request().postDataJSON();
    reasons = { rejection: saved.rejection_reason, rework: saved.rework_reason };
    await r.fulfill({ json: { success: true } });
  });
  await page.goto('/quality');
  const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Reason', exact: true }) });
  await expect(table).toContainText('Diameter out of tolerance');
  await expect(table).toContainText('Burr removal');
  await page.getByRole('button', { name: 'Edit rejected quantity', exact: true }).click();
  await page.getByLabel('Rejection reason', { exact: true }).fill('Surface finish');
  await page.getByRole('dialog').getByRole('button', { name: /Save/ }).click();
  await expect.poll(() => saved?.rejection_reason).toBe('Surface finish');
  expect(saved).toMatchObject({ machine_id: 81, shift_id: 5, reject_qty: 2, rework_qty: 1, rework_reason: 'Burr removal' });
  await expect(table).toContainText('Surface finish');
});

test('maintenance shows the machine condition score and no cycle chart on desktop and phone', async ({ authedPage: page }) => {
  await base(page);
  await page.route('**/api/dashboard/maintenance*', r => r.fulfill({ json: ok({
    filters: { machine_id: 81 }, updated_at: new Date().toISOString(),
    machines: { total: 1, running: 1, idle: 0, breakdown: 0, offline: 0 },
    health: { percent: 100 }, machine_health: { score: 75, status: 'Good', stale: false,
      observed_at: new Date().toISOString(), reported_checks: 2, basis: 'Mean of reported checks', checks: [] },
    alarms: {}, oee: {}, production: {}, condition_trend: [],
    rows: [{ machine_id: 81, machine_serial_no: machines[0].machine_serial_no, machine_status: 'RUNNING',
      received_at: new Date().toISOString(), servo_temp_x: 25, servo_temp_y: 65 }]
  }) }));
  await page.goto('/maintenance-dashboard');
  const card = page.locator('section[aria-labelledby="mtHealth"]');
  await expect(card).toContainText('75');
  await expect(card).toContainText('Good: 70');
  await expect(page.getByRole('heading', { name: /Cycle Time/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await card.screenshot({ path: test.info().outputPath('machine-health.png') });
});

test('production live contains the hourly cycle chart with gaps for hours without output', async ({ authedPage: page }) => {
  await base(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Unrelated live panels receive a normal unavailable response, rather than
  // a successful response with the wrong data shape from the generic fallback.
  await page.route('**/api/dashboard/live/81/*', r => r.fulfill({ status: 404,
    json: { status: 'error', message: 'No readings in this fixture' } }));
  await page.route('**/api/dashboard/live/81', r => r.fulfill({ json: ok({
    machine: { id: 81, machine_serial_no: machines[0].machine_serial_no }, live: { machine_status: 'RUNNING' }, kpis: {}, production: {}, oee: {}
  }) }));
  await page.route('**/api/dashboard/live/81/cycle-time*', r => r.fulfill({ json: ok({ points: [
    { hour_start: '2026-11-24T03:00:00Z', cycle_seconds: 120 },
    { hour_start: '2026-11-24T04:00:00Z', cycle_seconds: null },
    { hour_start: '2026-11-24T05:00:00Z', cycle_seconds: 180 }
  ] }) }));
  await page.goto('/dashboard/live/81');
  await expect(page.getByRole('heading', { name: 'Cycle Time (Sec)' })).toBeVisible();
  await expect(page.locator('app-cycle-time-panel')).toContainText('Latest hourly average: 180 Sec');
  await page.locator('app-cycle-time-panel').scrollIntoViewIfNeeded();
  await expect(page.locator('app-cycle-time-panel .apexcharts-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('alarm Pareto draws occurrence bars and cumulative percentage from the filtered response', async ({ authedPage: page }) => {
  await base(page);
  await page.route('**/api/dashboard/alarms?*', r => r.fulfill({ json: ok({
    kpis: { total: 10 }, by_severity: {}, by_machine: [], by_shift: [], trend: [],
    pareto: [{ alarm_type: 'EX', alarm_code: '1071', total: 6, cumulative_pct: 60 },
      { alarm_type: 'SV', alarm_code: '401', total: 4, cumulative_pct: 100 }]
  }) }));
  await page.goto('/alarm-report');
  const card = page.locator('section[aria-labelledby="alParetoTitle"]');
  await expect(card.getByRole('heading', { name: 'Alarm-wise Pareto' })).toBeVisible();
  await expect(card.locator('.apexcharts-canvas')).toBeVisible();
  await expect(card).toContainText('Cumulative %');
  await expect(card).toContainText('1071');
  await card.screenshot({ path: test.info().outputPath('alarm-pareto.png') });
});

test('operator estimate and report PDF action are visible; renamed dashboards keep their routes', async ({ authedPage: page }) => {
  await base(page);
  await page.route('**/api/dashboard/operators?*', r => r.fulfill({ json: ok({
    kpis: { estimated_production: 120, missing_cycle_machines: 0 }, top: [], bottom: [], operator_list: [],
    operators: { data: [], total: 0 }
  }) }));
  await page.goto('/operator-performance');
  await expect(page.getByRole('heading', { name: 'Estimated Production' })).toBeVisible();
  await expect(page.locator('.mexa-card').filter({ has: page.getByRole('heading', { name: 'Estimated Production' }) })).toContainText('120');
  await page.goto('/reports?tab=production');
  await expect(page.getByRole('button', { name: 'Export PDF: Production', exact: true })).toBeVisible();
  await page.goto('/preventive-maintenance');
  await expect(page.getByRole('heading', { name: 'Breakdown Dashboard', exact: true })).toBeVisible();
  await page.goto('/periodic-maintenance');
  await expect(page.getByRole('heading', { name: 'Schedule Dashboard', exact: true })).toBeVisible();
});
