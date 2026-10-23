import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The electricity bill (23 Oct 2026): its dates are set on Tariff & Rates,
 * from the EB bill; the Energy Dashboard shows what this bill will cost —
 * a tile in the row, and its card on Charts with the running total, the
 * forecast and its likely range. The server does every sum; these check
 * what is shown, what is asked, and what is said when there is no answer.
 */
const ok = (data: any) => ({ status: 'success', data });
const json = (body: any, status = 200) => (route: any) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const energy = ok({
  updated_at: '2026-10-23T05:00:00.000Z', currency: 'INR', rate_per_kwh: 10.95,
  kpis: { total_kwh: 1248.6, total_operating_seconds: 475200, total_produced: 12560, kwh_per_part: 0.099,
          total_cost: 13672.17, avg_voltage: null, avg_current: null, kwh_vs_yesterday_pct: 2.5,
          overload_alerts: 0, overload_top: null },
  coverage: { machines: 20, reporting: 3, tariff_configured: true, note: '' },
  trend: [], by_shift: [], by_month: [], top_consumers: [], overloads: [],
  machines: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
});

/* 12 Oct – 11 Nov; today the 23rd (day 12): 11 days over, today, 19 to come. */
function perDay() {
  const out: any[] = [];
  let used = 0;
  for (let i = 0; i < 31; i++) {
    const d = new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10);
    const kind = i < 11 ? 'past' : i === 11 ? 'today' : 'coming';
    if (kind !== 'coming') used += i === 11 ? 600 : 1600;
    const ahead = kind === 'past' ? null : 18382.09 + (i - 10) * 1560;
    out.push({ day: d, kind,
      to_date_kwh: kind === 'coming' ? null : used / 10, to_date_cost: kind === 'coming' ? null : used,
      forecast_kwh: ahead == null ? null : ahead / 10, forecast_cost: ahead,
      low_kwh: ahead == null ? null : ahead / 10 - 50, high_kwh: ahead == null ? null : ahead / 10 + 50,
      low_cost: ahead == null ? null : ahead - (i - 10) * 40, high_cost: ahead == null ? null : ahead + (i - 10) * 40 });
  }
  return out;
}

const dates = { configured: true, entered: { start: '2026-10-12', end: '2026-11-11' },
  current: { start: '2026-10-12', end: '2026-11-11', days: 31 }, next: { start: '2026-11-12', end: '2026-12-11', days: 30 },
  repeats: 'Every month' };

const bill = (over: any = {}) => ok({
  ...dates, currency: 'INR', scope: { machine_id: null, machine: null }, preparing: false,
  period: { start: '2026-10-12', end: '2026-11-11', days: 31, day: 12, days_left: 19.6 },
  so_far: { kwh: 1811.24, cost: 18382.09 }, rest: { kwh: 2700.5, cost: 30169.12 },
  forecast: { kwh: 4511.74, cost: 48551.21, low_kwh: 4400, high_kwh: 4600, low_cost: 47300, high_cost: 49800 },
  per_day: perDay(),
  machines: { in_scope: 20, metered: 3, forecast: 3, too_new: 0, unpriced: 0 },
  history: { from: '2026-09-12', weeks: 4 },
  accuracy: { from: '2026-10-16', to: '2026-10-23', forecast_kwh: 1065.3, actual_kwh: 1043.4, error_pct: 2.1 },
  previous: { start: '2026-09-12', end: '2026-10-11', kwh: 4300, cost: 45210 },
  ...over
});

async function openEnergy(page: any, body: any, asked: URL[] = []) {
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/charts/meta*', json(ok({ machines: [{ id: 1, machine_serial_no: 'VMC - 1 - F' }, { id: 2, machine_serial_no: 'VMC - 2 - F' }] })));
  await page.route('**/api/dashboard/energy/meter*', json(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, json(energy));
  await page.route('**/api/dashboard/energy/bill*', (r: any) => { asked.push(new URL(r.request().url())); return json(body)(r); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/energy-dashboard');
  await expect(page.locator('.mexa-kpi')).toHaveCount(7);
}

const tile = (page: any) => page.locator('.mexa-kpi.is-bill');
const card = (page: any) => page.getByRole('region', { name: /^This Bill/ });

test('the tile: where this bill is heading, and what is used so far', async ({ authedPage: page }) => {
  await openEnergy(page, bill());
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('₹48,551');
  await expect(tile(page)).toContainText('₹18,382 so far · 19.6 days left');
  await expect(tile(page).getByRole('button', { name: /^What is/ })).toHaveCount(1);
});

test('the tile opens its card on Charts: forecast and range, so far, still to come, the bill before, and how it was checked', async ({ authedPage: page }) => {
  await openEnergy(page, bill());
  await page.getByRole('tab', { name: 'Machine Detail' }).click();
  await tile(page).getByRole('button', { name: /^This bill's forecast:/ }).click();

  await expect(page.getByRole('tab', { name: 'Charts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /^This Bill · 12 Oct – 11 Nov 2026/ })).toBeFocused();
  const c = card(page);
  await expect(c).toContainText('Day 12 of 31');
  const fig = (name: string) => c.locator('.bill-fig').filter({ has: page.locator('dt', { hasText: name }) });
  await expect(fig('Forecast')).toContainText('₹48,551');
  await expect(fig('Forecast')).toContainText('likely ₹47,300 – ₹49,800');
  await expect(fig('Used so far')).toContainText('₹18,382');
  await expect(fig('Used so far')).toContainText('1,811 kWh since 12 Oct');
  await expect(fig('Still to come')).toContainText('₹30,169');
  await expect(fig('Still to come')).toContainText('19.6 days left · ends 11 Nov');
  await expect(fig('Last bill')).toContainText('₹45,210');
  await expect(fig('Last bill')).toContainText('12 Sep – 11 Oct 2026 · this bill +7.4%');

  await expect(c).toContainText('Checked on the last 7 days: within 2.1%');
  await expect(c).toContainText('Usual use from 4 weeks of readings');
  await expect(c).toContainText('3 of 20 machines have an energy meter; the others are not in it');
  // the running total: the range, what was used, the forecast — and today marked
  for (const name of ['Likely range', 'Used so far', 'Forecast']) await expect(c.locator('.apexcharts-legend')).toContainText(name);
  await expect(c.locator('.apexcharts-xaxis-annotations')).toContainText('Today');
});

test('the machine filter asks for that machine\'s bill; the dates above do not ask again', async ({ authedPage: page }) => {
  const asked: URL[] = [];
  await openEnergy(page, bill(), asked);
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].searchParams.get('machine_id')).toBeNull();

  await page.locator('#enMachine').selectOption({ label: 'VMC - 2 - F' });
  await expect.poll(() => asked.at(-1)?.searchParams.get('machine_id')).toBe('2');
  const after = asked.length;

  await page.locator('#enFrom').fill('2026-10-01');
  await page.locator('#enFrom').dispatchEvent('change');
  await page.waitForTimeout(800);
  expect(asked).toHaveLength(after);
});

test('no bill dates yet: said on the tile and the card, with the way to set them', async ({ authedPage: page }) => {
  await openEnergy(page, ok({ configured: false, entered: null, current: null, next: null, repeats: null,
                              currency: 'INR', scope: { machine_id: null, machine: null } }));
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('--');
  await expect(tile(page).getByRole('link', { name: 'Set bill dates' })).toHaveAttribute('href', '/energy-tariff');
  await expect(card(page)).toContainText('Enter the dates of your electricity bill to see what this bill will cost.');
  await expect(card(page).getByRole('link', { name: 'Set bill dates' })).toHaveAttribute('href', '/energy-tariff');
});

test('no bill dates, for someone who cannot set them: said, with who does', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'] });
  await openEnergy(page, ok({ configured: false, currency: 'INR', scope: { machine_id: null, machine: null } }));
  await expect(tile(page)).toContainText('No bill dates');
  await expect(tile(page).getByRole('link')).toHaveCount(0);
  await expect(card(page)).toContainText('Your company admin sets them on Tariff & Rates.');
});

test('the readings still being worked out: said, not a short total', async ({ authedPage: page }) => {
  await openEnergy(page, bill({ preparing: true, so_far: null, rest: null, forecast: null, per_day: [], accuracy: null, previous: null }));
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('--');
  await expect(tile(page)).toContainText('Getting the readings ready');
  await expect(card(page).getByRole('status')).toContainText('the first time takes a few minutes');
});

test('no tariff: the bill in kWh', async ({ authedPage: page }) => {
  await openEnergy(page, bill({ so_far: { kwh: 1811.24, cost: null }, rest: { kwh: 2700.5, cost: null },
    forecast: { kwh: 4511.74, cost: null, low_kwh: 4400, high_kwh: 4600, low_cost: null, high_cost: null },
    previous: { start: '2026-09-12', end: '2026-10-11', kwh: 4300, cost: null } }));
  await expect(tile(page).locator('.mexa-kpi-value')).toHaveText('4,512 kWh');
  await expect(card(page).locator('.bill-fig').first()).toContainText('likely 4,400 kWh – 4,600 kWh');
});

test('Tariff & Rates: the bill dates set from the EB bill, checked as typed, then shown with the next bill; removed after asking', async ({ authedPage: page }) => {
  let saved: any = null, removed = false;
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/dashboard/energy/bill-period', (r: any) => {
    const m = r.request().method();
    if (m === 'PUT') { saved = r.request().postDataJSON(); return json(ok(dates))(r); }
    if (m === 'DELETE') { removed = true; return json(ok({ configured: false, entered: null, current: null, next: null, repeats: null }))(r); }
    return json(ok({ configured: false, entered: null, current: null, next: null, repeats: null }))(r);
  });
  await page.goto('/energy-tariff');
  const section = page.getByRole('region', { name: 'Electricity bill dates' });
  await expect(section).toContainText('No bill dates yet');

  await section.getByRole('button', { name: 'Set bill dates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set bill dates' });
  await dialog.getByLabel('First day').fill('2026-10-12');
  await dialog.getByLabel('Last day').fill('2026-10-15');
  await expect(dialog).toContainText('A bill runs at least 7 days');
  await dialog.getByRole('button', { name: 'Save bill dates' }).click();
  await expect(dialog.getByRole('alert')).toContainText('at least 7 days');
  expect(saved).toBeNull();

  await dialog.getByLabel('Last day').fill('2026-11-11');
  await expect(dialog).toContainText('31 days');
  await dialog.getByRole('button', { name: 'Save bill dates' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toEqual({ period_start: '2026-10-12', period_end: '2026-11-11' });
  await expect(section).toContainText('This bill12 Oct – 11 Nov 2026 · 31 days');
  await expect(section).toContainText('Next bill12 Nov – 11 Dec 2026');
  await expect(section).toContainText('RepeatsEvery month');

  await section.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog', { name: 'Remove the bill dates?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(section).toContainText('No bill dates yet');
  expect(removed).toBe(true);
});
