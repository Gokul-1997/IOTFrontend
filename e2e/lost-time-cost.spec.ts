import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Lost time in rupees (6 Oct 2026). S AND T sent a ₹/hour rate per machine;
 * it is entered on the machine (Master → Machines → Cost), and the Downtime
 * and OEE screens price idle and alarm time with it. A machine with no rate
 * is not counted as free: the screens say how many machines a figure
 * covers, or that no rate is set.
 */

const ok = (data: any) => ({ status: 'success', data });
const meta = { success: true, data: { machines: [{ id: 25, machine_serial_no: 'HMC - 7 - F' }], shifts: [] } };

const downtime = (k: any = {}) => ok({
  updated_at: new Date().toISOString(),
  kpis: { total_downtime_seconds: 0, downtime_events: 0, open_events: 0,
          run_seconds: 475200, idle_seconds: 30000, alarm_seconds: 20400,
          availability_pct: 94, unaccounted_seconds: 30000, reason_coverage_pct: 0,
          idle_cost: 176040, alarm_cost: 61200, cost_machines: { priced: 12, of: 17 }, ...k },
  by_reason: [], top_reasons: [], by_category: [], by_shift: [], hourly: [],
  events: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
});

const oee = (k: any = {}) => ok({
  updated_at: new Date().toISOString(),
  thresholds: { good: 85, fair: 60 },
  kpis: { availability_pct: 89, performance_pct: 88, quality_pct: 96, oee_pct: 82, band: 'FAIR',
          produced: 1360, good: 1306, rejected: 54, run_seconds: 475200, idle_seconds: 30000,
          downtime_seconds: 0, alarm_count: 6, machines_measurable: 2, machines_total: 2,
          idle_cost: 6100, machines_priced: 2, ...k },
  coverage: { machines: 2, with_cycle_time: 2, oee_computable: 2, note: '' },
  status_counts: { RUNNING: 1, IDLE: 1, ALARM: 0, OFFLINE: 0 },
  top_machines: [], bottom_machines: [],
  trend: [],
  machines: { data: [
    { machine_id: 25, machine_serial_no: 'HMC - 7 - F', model: 'HM400', status: 'RUNNING', band: 'GOOD',
      availability_pct: 92, performance_pct: 90, quality_pct: 97, oee_pct: 86, produced: 680, good: 660, rejected: 20,
      alarm_count: 4, downtime_seconds: 0, idle_seconds: 3600, has_cycle_time: true, hour_rate: 500, idle_cost: 500 },
    { machine_id: 19, machine_serial_no: 'VMC - 2 - F', model: 'VL1000', status: 'IDLE', band: 'FAIR',
      availability_pct: 80, performance_pct: 85, quality_pct: 95, oee_pct: 65, produced: 680, good: 646, rejected: 34,
      alarm_count: 2, downtime_seconds: 0, idle_seconds: 7200, has_cycle_time: true, hour_rate: null, idle_cost: null }
  ], total: 2, page: 1, limit: 20, totalPages: 1 }
});

async function mock(page: any, routes: Record<string, any>) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  for (const [pattern, body] of Object.entries(routes)) {
    await page.route(pattern, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  }
}

const kpi = (page: any, label: RegExp) => page.locator('.mexa-kpi').filter({ has: page.locator('.mexa-kpi-label', { hasText: label }) });

test('Downtime: idle and alarm time in rupees, and how many machines that covers', async ({ authedPage: page }) => {
  await mock(page, { '**/api/dashboard/downtime*': downtime() });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/downtime-analysis');
  await expect(kpi(page, /Idle/).locator('.mexa-kpi-cost')).toHaveText('₹1,76,040 · 12 of 17 machines');
  await expect(kpi(page, /Alarm/).locator('.mexa-kpi-cost')).toHaveText('₹61,200 · 12 of 17 machines');
  await expect(kpi(page, /Idle/).locator('.mexa-kpi-cost')).toHaveAttribute('title', /hour rate/);
});

test('Downtime: no machine has a rate — it says so, never ₹0', async ({ authedPage: page }) => {
  await mock(page, { '**/api/dashboard/downtime*': downtime({ idle_cost: null, alarm_cost: null, cost_machines: { priced: 0, of: 17 } }) });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/downtime-analysis');
  await expect(kpi(page, /Idle/).locator('.mexa-kpi-cost')).toHaveText('No hour rates set');
  await expect(page.getByText('₹0')).toHaveCount(0);
});

test('OEE: the downtime tile prices idle time; each priced machine shows its own', async ({ authedPage: page }) => {
  await mock(page, { '**/api/dashboard/oee*': oee() });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/oee-dashboard');
  await expect(kpi(page, /Downtime/).locator('.mexa-kpi-cost')).toHaveText('₹6,100');
  const cards = page.locator('.mexa-oeecard');
  await expect(cards.filter({ hasText: 'HMC - 7 - F' })).toContainText('₹500 idle');
  // no rate on this one: no rupee figure rather than ₹0
  await expect(cards.filter({ hasText: 'VMC - 2 - F' })).not.toContainText('₹');
});

test('Machines: the hour rate is set on the machine, and an unchanged rate is not a change', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  let put: any = null;
  await mock(page, {
    '**/api/lines*': ok([{ id: 1, name: 'Line 1' }]),
    '**/api/machines?*': { status: 'success', data: [
      // every column the list API returns, as it returns them (NUMERIC as text)
      { id: 25, machine_serial_no: 'HMC - 7 - F', line_id: 1, name: 'Line 1', image_url: null,
        x_axis: null, y_axis: null, z_axis: null, fourth_axis: null, fifth_axis: null,
        twin_spindle: false, twin_table: false, atc_tool_capacity: null, model: 'HM400', mmc_no: null,
        controller: null, spindle_rpm: null, ip_address: null, program_path: null, hour_rate: '500.00',
        api_key: 'k', is_active: true, created_at: '2026-01-01T00:00:00Z' } ], total: 1 }
  });
  await page.route('**/api/machines/25', (r: any) => {
    put = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data: {} }) });
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/machines');
  await page.getByRole('button', { name: 'Edit HMC - 7 - F' }).click();

  const rate = page.getByLabel('Hour rate');
  await expect(rate).toHaveValue('500');
  // "500.00" from the API and 500 in the field are the same rate
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  await rate.fill('-5');
  await rate.blur();
  await expect(page.getByText('Enter rupees per hour, from 0 to 10,00,000.')).toBeVisible();

  await rate.fill('750');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => put).not.toBeNull();
  expect(put).toEqual({ hour_rate: 750 });
});

test('Tariff & Rates: one page for the EB tariff and every machine\'s hour rate', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  const puts: Record<string, any> = {};
  await mock(page, {
    '**/api/dashboard/energy/settings*': ok([]),
    '**/api/machines?*': { status: 'success', total: 3, data: [
      { id: 35, machine_serial_no: 'VMC - 10 - M', model: 'VL100G', hour_rate: null, is_active: true },
      { id: 19, machine_serial_no: 'VMC - 2 - F', model: 'VL1000', hour_rate: '380.00', is_active: true },
      { id: 25, machine_serial_no: 'HMC - 7 - F', model: 'HM400', hour_rate: null, is_active: true } ] }
  });
  await page.route(/\/api\/machines\/\d+$/, (r: any) => {
    puts[r.request().url().split('/').pop()!] = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data: {} }) });
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/energy-tariff');
  await expect(page.getByRole('heading', { name: 'Tariff & Rates' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /electricity tariff — ₹ per unit/ })).toBeVisible();

  const table = page.getByRole('region', { name: 'Machine hour rates' });
  // in the order the plant counts them, VMC - 2 before VMC - 10
  await expect(table.locator('tbody th')).toHaveText(['HMC - 7 - F', 'VMC - 2 - F', 'VMC - 10 - M']);
  await expect(page.getByLabel('Hour rate of VMC - 2 - F, rupees per hour')).toHaveValue('380');

  const save = page.getByRole('button', { name: 'Save hour rates' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Hour rate of HMC - 7 - F, rupees per hour').fill('1000');
  await page.getByLabel('Hour rate of VMC - 10 - M, rupees per hour').fill('380');
  await expect(page.getByText('2 changed, not saved yet')).toBeVisible();
  await save.click();
  await expect.poll(() => Object.keys(puts).sort()).toEqual(['25', '35']);
  expect(puts['25']).toEqual({ hour_rate: 1000 });
  expect(puts['35']).toEqual({ hour_rate: 380 });
  await expect(save).toBeDisabled();
});

test('Tariff & Rates: a rate out of range is refused before anything is sent', async ({ page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  let sent = 0;
  await mock(page, {
    '**/api/dashboard/energy/settings*': ok([]),
    '**/api/machines?*': { status: 'success', total: 1, data: [
      { id: 25, machine_serial_no: 'HMC - 7 - F', model: 'HM400', hour_rate: null, is_active: true } ] }
  });
  await page.route(/\/api\/machines\/\d+$/, (r: any) => { sent++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/energy-tariff');
  await page.getByLabel('Hour rate of HMC - 7 - F, rupees per hour').fill('-5');
  await page.getByRole('button', { name: 'Save hour rates' }).click();
  await expect(page.getByRole('alert')).toHaveText('An hour rate must be from 0 to 10,00,000 rupees.');
  expect(sent).toBe(0);
});
