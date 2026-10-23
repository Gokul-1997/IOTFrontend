import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The EB bill (23 Oct 2026). Tariff & Rates keeps each service connection's
 * bills as printed (S AND T: SC 1212 and SC 2309) and its EB meter readings;
 * the Energy Dashboard shows this bill's forecast — a tile, and the bill line
 * by line on Charts, the last bill under it. The server does every sum.
 */
const ok = (data: any) => ({ status: 'success', data });
const json = (body: any, status = 200) => (route: any) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const energy = ok({
  updated_at: '2026-10-23T05:00:00.000Z', currency: 'INR', rate_per_kwh: 10.95,
  kpis: { total_kwh: 1248.6, total_operating_seconds: 475200, total_produced: 12560, kwh_per_part: 0.099,
          total_cost: 13672.17, avg_voltage: null, avg_current: null, kwh_vs_yesterday_pct: 2.5, overload_alerts: 0, overload_top: null },
  coverage: { machines: 20, reporting: 3, tariff_configured: true, note: '' },
  trend: [], by_shift: [], by_month: [], top_consumers: [], overloads: [],
  machines: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
});

const bill1212 = { id: 11, connection_id: 1, from: '2026-07-26', to: '2026-08-26', days: 31, units: 55952, rate: 8.13,
  electricity_charges: 455093, peak_charges: 0, fixed_charges: 91200, penalty_charges: 16372, welding_charges: 68264,
  tax_charges: 29512, other_charges: 0, net_amount: 660441 };
const bill2309 = { id: 12, connection_id: 2, from: '2026-07-26', to: '2026-08-27', days: 32, units: 68988, rate: 8.25,
  electricity_charges: 569151, peak_charges: 0, fixed_charges: 89984, penalty_charges: 15593, welding_charges: 0,
  tax_charges: 32622, other_charges: 0, net_amount: 707350 };

const supply = (sc: string, id: number, last: any, forecast: any, over: any = {}) => ({
  id, sc_number: sc, name: null, meter: null, status: 'ok', cycle: 'Every month',
  period: { start: sc === '1212' ? '2026-09-26' : '2026-09-27', end: sc === '1212' ? '2026-10-26' : '2026-10-27', days: 30, day: 28, days_left: 2.5 },
  source: 'bills', units: { so_far: 0, as_of: null, rest: 0, total: forecast.units, per_day: last.units / last.days, measured: false, bills: 1 },
  forecast, range: null,
  tariff: { rate: last.electricity_charges / last.units, printed_rate: last.rate, fixed_charges: last.fixed_charges,
            peak_pct: 0, penalty_pct: 3.6, welding_pct: last.welding_charges ? 15 : 0, tax_pct: 6.48 },
  last_bill: last, change_pct: -2.8, ...over
});
const f1212 = { units: 54147, electricity_charges: 440413, peak_charges: 0, fixed_charges: 91200, penalty_charges: 15844,
  welding_charges: 66062, tax_charges: 28560, net_amount: 642079 };
const f2309 = { units: 64676, electricity_charges: 533577, peak_charges: 0, fixed_charges: 89984, penalty_charges: 14618,
  welding_charges: 0, tax_charges: 30585, net_amount: 668764 };

const forecast = (over: any = {}) => ok({
  configured: true, restricted: false, currency: 'INR',
  connections: [supply('1212', 1, bill1212, f1212), supply('2309', 2, bill2309, f2309)],
  total: { units: 118823, net_amount: 1310843, low: null, high: null, last_net: 1367791, ends: '2026-10-27', measured: false },
  ...over
});

async function openEnergy(page: any, body: any) {
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/dashboard/energy/meter*', json(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, json(energy));
  await page.route('**/api/dashboard/energy/bill', json(body));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/energy-dashboard');
  await expect(page.locator('.mexa-kpi')).toHaveCount(7);
}

const tile = (page: any) => page.locator('.mexa-kpi.is-bill');
const card = (page: any) => page.getByRole('region', { name: /^This Bill — EB forecast/ });

test('the tile: this bill for every supply, and that it is an estimate', async ({ authedPage: page }) => {
  await openEnergy(page, forecast());
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('₹13,10,843');
  await expect(tile(page)).toContainText('2 supplies · to 27 Oct · estimate');
});

test('the tile opens the bill on Charts, line by line as the EB prints it, the last bill under each', async ({ authedPage: page }) => {
  await openEnergy(page, forecast());
  await page.getByRole('tab', { name: 'Machine Detail' }).click();
  await tile(page).getByRole('button', { name: /^This bill's forecast:/ }).click();
  await expect(page.getByRole('tab', { name: 'Charts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /^This Bill — EB forecast/ })).toBeFocused();

  const rows = card(page).locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('SC 1212');
  await expect(rows.nth(0)).toContainText('26 Sep – 26 Oct 2026');
  for (const v of ['54,147', '8.13', '4,40,413', '91,200', '15,844', '66,062', '28,560', '₹6,42,079', '−2.8%']) await expect(rows.nth(0)).toContainText(v);
  await expect(rows.nth(0).locator('.bill-est')).toHaveText('est.');
  await expect(rows.nth(1)).toContainText('Last bill');
  for (const v of ['26 Jul – 26 Aug 2026', '55,952', '4,55,093', '68,264', '₹6,60,441']) await expect(rows.nth(1)).toContainText(v);
  await expect(rows.nth(2)).toContainText('SC 2309');
  await expect(card(page).locator('tfoot')).toContainText('₹13,10,843');

  await expect(card(page)).toContainText('SC 1212: Estimate: 1,805 units a day, as on the last bill. Enter EB meter readings for exact units.');
  await expect(card(page)).toContainText('welding surcharge ₹68,264 on the last bill (15% of the electricity charges)');
  await expect(card(page)).toContainText('ED/LPF penalty ₹16,372 on the last bill');
});

test('from EB meter readings: measured, said so, no estimate mark', async ({ authedPage: page }) => {
  const measured = supply('1212', 1, bill1212, f1212, { source: 'readings',
    units: { so_far: 48700, as_of: '2026-10-23', rest: 5400, total: 54100, per_day: 1800, measured: true, bills: null } });
  await openEnergy(page, forecast({ connections: [measured], total: { units: 54100, net_amount: 641599, low: null, high: null,
    last_net: 660441, ends: '2026-10-26', measured: true } }));
  await expect(tile(page)).toContainText('SC 1212 · to 26 Oct');
  await expect(tile(page)).not.toContainText('estimate');
  await expect(card(page).locator('.bill-est')).toHaveCount(0);
  await expect(card(page)).toContainText('48,700 units so far, from EB meter readings to 23 Oct; the rest at 1,800 a day');
});

test('no EB bill yet: said on the tile and the card, with the way to add one', async ({ authedPage: page }) => {
  await openEnergy(page, ok({ configured: false, restricted: false, currency: 'INR', connections: [], total: null }));
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('--');
  await expect(tile(page).getByRole('link', { name: 'Add EB bill' })).toHaveAttribute('href', '/energy-tariff');
  await expect(card(page).getByRole('link', { name: 'Add EB bill' })).toHaveAttribute('href', '/energy-tariff');
});

test('no EB bill, for someone who cannot add one: said, with who does', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'] });
  await openEnergy(page, ok({ configured: false, restricted: false, currency: 'INR', connections: [], total: null }));
  await expect(tile(page).getByRole('link')).toHaveCount(0);
  await expect(card(page)).toContainText('Your company admin enters them on Tariff & Rates.');
});

test('the bill is the whole company\'s: someone who sees one plant is told so', async ({ authedPage: page }) => {
  await openEnergy(page, ok({ configured: false, restricted: true, currency: 'INR', connections: [], total: null }));
  await expect(tile(page)).toContainText('For company administration');
  await expect(card(page)).toContainText('it shows to company administration');
});

test('Tariff & Rates: a service connection, its bill as printed — checked as typed — and its EB meter readings', async ({ authedPage: page }) => {
  const sent: any[] = [];
  let connections: any[] = [];
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/dashboard/energy/connections**', (r: any) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/energy\/connections/, '');
    if (req.method() === 'GET') return json(ok(connections))(r);
    sent.push({ method: req.method(), path, body: req.postData() ? req.postDataJSON() : null });
    if (req.method() === 'POST' && path === '') {
      connections = [{ id: 1, sc_number: '1212', name: null, meter: null, bills: [], readings: [], current: null, cycle: null }];
      return json(ok({ id: 1 }))(r);
    }
    if (req.method() === 'POST' && path === '/1/bills') {
      connections = [{ ...connections[0], bills: [bill1212], current: { start: '2026-09-26', end: '2026-10-26', days: 30 }, cycle: 'Every month' }];
      return json(ok({ bill: bill1212, checks: { rate_difference: 203.24, net_difference: 0 } }))(r);
    }
    if (req.method() === 'POST' && path === '/1/readings') {
      const body = req.postDataJSON();
      if (body.kwh < 1000) return json({ status: 'error', message: 'The reading on 21 Oct 2026 was 1045100: this one cannot be lower' }, 400)(r);
      connections = [{ ...connections[0], readings: [{ id: 5, read_on: body.read_on, kwh: body.kwh }] }];
      return json(ok({ id: 5 }))(r);
    }
    if (req.method() === 'DELETE') { connections = []; return json(ok({ id: 1 }))(r); }
    return json(ok({}))(r);
  });
  await page.goto('/energy-tariff');
  const section = page.getByRole('region', { name: 'Electricity bills (EB)' });
  await expect(section).toContainText('No service connection yet');

  await section.getByRole('button', { name: 'Add service connection' }).click();
  const conn = page.getByRole('dialog', { name: 'Add service connection' });
  await conn.getByLabel('Service connection no.').fill('1212');
  await conn.getByRole('button', { name: 'Save' }).click();
  await expect(conn).toHaveCount(0);
  expect(sent[0]).toEqual({ method: 'POST', path: '', body: { sc_number: '1212', name: null, meter_machine_id: null } });
  await expect(section).toContainText('Service connection 1212');
  await expect(section).toContainText('Add its latest bill to start the forecast');

  await section.getByRole('button', { name: 'Add bill' }).click();
  const dialog = page.getByRole('dialog', { name: /^Add bill · SC 1212/ });
  await dialog.getByLabel('Billing period From').fill('2026-07-26');
  await dialog.getByLabel('To', { exact: true }).fill('2026-08-26');
  await expect(dialog).toContainText('31 days');
  const fill = async (label: string, v: string) => dialog.getByLabel(label).fill(v);
  await fill('Assessed units', '55952');
  await fill('Rate per unit (₹)', '8.13');
  await fill('Electricity charges (₹)', '455093');
  await fill('Fixed charges (₹)', '91200');
  await fill('ED/LPF penalty (₹)', '16372');
  await fill('Welding surcharge (₹)', '68264');
  await fill('E Tax & TCS (₹)', '29152');                           // a slip: 29512 on the bill
  await fill('Net bill value (₹)', '660441');
  await expect(dialog).toContainText('₹360 less than the net bill: check the figures');
  await fill('E Tax & TCS (₹)', '29512');
  await expect(dialog).toContainText('The charges add up to ₹6,60,441 — the same as the net bill.');
  await expect(dialog).toContainText('Units × rate is ₹203.24 less than the electricity charges');
  await dialog.getByRole('button', { name: 'Save bill' }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent[1]).toMatchObject({ method: 'POST', path: '/1/bills', body: { from: '2026-07-26', to: '2026-08-26', units: 55952, rate: 8.13,
    electricity_charges: 455093, fixed_charges: 91200, penalty_charges: 16372, welding_charges: 68264, tax_charges: 29512, net_amount: 660441 } });
  await expect(section).toContainText('This bill 26 Sep – 26 Oct 2026 · 30 days · Every month');
  const billRow = section.getByRole('region', { name: 'Bills of service connection 1212' }).locator('tbody tr');
  await expect(billRow).toContainText('6,60,441');

  await section.getByRole('button', { name: /^Meter readings/ }).click();
  const readings = page.getByRole('dialog', { name: /^EB meter readings · SC 1212/ });
  await readings.getByLabel('Date').fill('2026-10-22');
  await readings.getByLabel('Reading (kWh)').fill('100');
  await readings.getByRole('button', { name: 'Add reading' }).click();
  await expect(readings.getByRole('alert')).toContainText('this one cannot be lower');
  await readings.getByLabel('Reading (kWh)').fill('1048700');
  await readings.getByRole('button', { name: 'Add reading' }).click();
  await expect(readings.locator('tbody')).toContainText('10,48,700');
  await readings.getByRole('button', { name: 'Close' }).click();

  await section.getByRole('button', { name: 'Remove service connection 1212' }).click();
  await page.getByRole('alertdialog', { name: 'Remove service connection 1212?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(section).toContainText('No service connection yet');
  expect(sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/1' });
});
