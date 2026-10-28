import type { Locator, Page } from '@playwright/test';
import { test, expect, seedAuth, localFixtureOrigin } from './fixtures/auth';

const ok = (data: any) => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ status: 'success', data }) });

/** The API prices machines individually. Its cost deliberately differs from
 *  kWh multiplied by the company default, so a client-side guess cannot pass. */
function energy(over: any = {}) {
  return {
    updated_at: '2026-10-27T06:30:00.000Z', currency: 'INR', rate_per_kwh: 10,
    cost_basis: 'current_tariff_estimate', energy_source: 'telemetry_counter_deltas',
    by_shift_source: 'production_hourly',
    kpis: { total_kwh: 30, total_cost: 480, total_operating_seconds: 3600,
      total_produced: 60, kwh_per_part: 0.5, avg_voltage: null, avg_current: null,
      kwh_vs_yesterday_pct: null, overload_alerts: 0, overload_limit_set: false },
    coverage: { machines: 2, reporting: 2, tariff_configured: true,
      energy_complete: true, cost_complete: true, rejected_intervals: 0 },
    trend: [
      { day: '2026-10-25T00:00:00.000Z', kwh: 10, cost: 150, cost_complete: true },
      { day: '2026-10-26T00:00:00.000Z', kwh: 10, cost: 160, cost_complete: true },
      { day: '2026-10-27T00:00:00.000Z', kwh: 10, cost: 170, cost_complete: true }
    ],
    by_month: [{ month: '2026-10-01T00:00:00.000Z', kwh: 30, cost: 480, cost_complete: true }],
    by_shift: [{ shift_name: 'Shift 1', kwh: 30 }],
    top_consumers: [{ machine_serial_no: 'VMC - 1 - F', kwh: 30 }], overloads: [],
    machines: { data: [{ machine_id: 15, machine_serial_no: 'VMC - 1 - F', model: 'VL850',
      kwh: 30, cost: 480, produced: 60, run_seconds: 3600, kwh_per_part: 0.5,
      peak_kw: 12, energy_complete: true, is_overloaded: false }],
      total: 1, page: 1, limit: 20, totalPages: 1 },
    ...over
  };
}

async function openEnergy(page: Page, respond: (url: URL) => any = () => energy(),
  options: { view?: string; time?: string; asked?: URL[]; completed?: URL[] } = {}) {
  await page.clock.install({ time: new Date(options.time || '2026-10-27T12:00:00+05:30') });
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  const origin = localFixtureOrigin();
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill(ok([])));
  await page.route('**/api/charts/meta*', route => route.fulfill(ok({ machines: [
    { id: 15, machine_serial_no: 'VMC - 1 - F' },
    { id: 34, machine_serial_no: 'VMC - 13 - M' }
  ] })));
  await page.route('**/api/dashboard/energy/meter*', route => route.fulfill(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, async route => {
    const url = new URL(route.request().url());
    options.asked?.push(url);
    const response = await respond(url);
    await route.fulfill(response === 'fail'
      ? { status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Energy temporarily unavailable.' }) }
      : ok(response));
    options.completed?.push(url);
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/energy-dashboard' + (options.view ? '?view=' + options.view : ''));
}

const costCard = (page: Page) => page.locator('section[aria-labelledby="enCostTitle"]');
const consumptionCard = (page: Page) => page.locator('section', {
  has: page.getByRole('heading', { name: 'Energy Consumption Over Time (kWh)', exact: true })
});
const barValues = (card: Locator) => card.locator('.apexcharts-bar-area').evaluateAll(paths =>
  paths.map(path => path.getAttribute('val')).map(value => value === null ? null : Number(value)));
const chooseMachine = (page: Page, name: string) => page.locator('#enMachine').selectOption({ label: name });

test('the API cost survives Day, Week and Month regrouping without another request', async ({ page }) => {
  const asked: URL[] = [];
  await openEnergy(page, () => energy(), { asked });
  await expect(page.locator('#enk2-value')).toHaveText('₹480');
  await expect(costCard(page).getByRole('heading', { name: /^Energy Cost Trend/ })).toBeVisible();
  await expect.poll(() => barValues(costCard(page))).toEqual([150, 160, 170]);
  const requests = asked.length;

  await costCard(page).getByRole('button', { name: 'Week', exact: true }).click();
  await expect.poll(() => barValues(costCard(page))).toEqual([150, 330]);
  await costCard(page).getByRole('button', { name: 'Month', exact: true }).click();
  await expect.poll(() => barValues(costCard(page))).toEqual([480]);
  await costCard(page).getByRole('button', { name: 'Day', exact: true }).click();
  await expect.poll(() => barValues(costCard(page))).toEqual([150, 160, 170]);
  expect(asked).toHaveLength(requests);
  await expect(page.getByText('Estimate at configured tariffs', { exact: true })).toBeVisible();
});

test('a missing day stays a gap while a measured zero remains zero and incomplete costs stay unavailable', async ({ page }) => {
  const base = energy();
  await openEnergy(page, () => energy({
    kpis: { ...base.kpis, total_kwh: 10, total_cost: null, kwh_per_part: null },
    coverage: { ...base.coverage, energy_complete: false, cost_complete: false, reporting: 1 },
    trend: [
      { day: '2026-10-23', kwh: 10, cost: null, cost_complete: false },
      { day: '2026-10-24', kwh: null, cost: null, cost_complete: false },
      { day: '2026-10-25', kwh: 0, cost: 0, cost_complete: true }
    ],
    by_month: [{ month: '2026-10-01', kwh: 10, cost: null, cost_complete: false }]
  }));
  await expect(page.locator('#enk2-value')).toHaveText('--');
  await expect(page.locator('#enk3-value')).toHaveText('--');
  await expect(page.getByText('Partial readings', { exact: true })).toBeVisible();
  await expect(page.getByText('Cost unavailable for the full selection', { exact: true })).toBeVisible();
  await expect(costCard(page).getByRole('heading', { name: /^Energy Trend \(kWh\)/ })).toBeVisible();
  await expect(costCard(page).locator('.apexcharts-bar-area[j="0"]')).toHaveAttribute('val', '10');
  // Apex marks an unknown point with no fill; the genuinely measured zero has
  // its own numeric value. They must never become two zero-consumption claims.
  await expect(costCard(page).locator('.apexcharts-bar-area[j="1"]')).toHaveAttribute('fill', 'none');
  await expect(costCard(page).locator('.apexcharts-bar-area[j="2"]')).toHaveAttribute('val', '0');
  await costCard(page).getByRole('button', { name: 'Week', exact: true }).click();
  await expect(costCard(page).locator('apx-chart')).toHaveCount(0);
  await expect(costCard(page).getByText('Nothing recorded for this period.', { exact: true })).toBeVisible();
});

test('unknown readings show no invented charts, but measured zero is rendered as zero', async ({ page }) => {
  const base = energy();
  let measured = false;
  await openEnergy(page, () => energy({
    kpis: { ...base.kpis, total_kwh: measured ? 0 : null, total_cost: measured ? 0 : null, kwh_per_part: measured ? 0 : null },
    coverage: { ...base.coverage, reporting: measured ? 2 : 0 },
    trend: [{ day: '2026-10-27', kwh: measured ? 0 : null, cost: measured ? 0 : null, cost_complete: measured }],
    by_month: [{ month: '2026-10-01', kwh: measured ? 0 : null, cost: measured ? 0 : null, cost_complete: measured }],
    top_consumers: [], by_shift: [{ shift_name: 'Shift 1', kwh: measured ? 0 : null }]
  }));
  await expect(page.locator('#enk1-value')).toHaveText('--');
  await expect(consumptionCard(page).locator('apx-chart')).toHaveCount(0);
  await expect(costCard(page).locator('apx-chart')).toHaveCount(0);
  await expect(page.getByText('Nothing measured by shift.', { exact: true })).toBeVisible();

  measured = true;
  await chooseMachine(page, 'VMC - 1 - F');
  await expect(page.locator('#enk1-value')).toHaveText('0kWh');
  await expect(page.locator('#enk2-value')).toHaveText('₹0');
  await expect(consumptionCard(page).locator('apx-chart')).toHaveCount(1);
  await expect.poll(() => barValues(costCard(page))).toEqual([0]);
  await expect(page.getByText('Recorded shift energy is zero.', { exact: true })).toBeVisible();
  await expect(page.getByText('No measured energy in this selection.', { exact: true })).toHaveCount(1); // empty top-consumer card only
});

test.describe('plant calendar dates with a browser in California', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('plant midnight selects the new plant day and does not move chart dates to yesterday', async ({ page }) => {
    const asked: URL[] = [];
    await openEnergy(page, () => energy(), { time: '2026-10-27T00:15:00+05:30', asked });
    await expect(page.locator('#enFrom')).toHaveValue('2026-10-21');
    await expect(page.locator('#enTo')).toHaveValue('2026-10-27');
    await expect.poll(() => asked[0]?.searchParams.get('to')).toBe('2026-10-27');
    await expect(costCard(page).locator('.apexcharts-xaxis-texts-g')).toContainText('25 Oct');
    await expect(costCard(page).locator('.apexcharts-xaxis-texts-g')).toContainText('27 Oct');
    await expect(costCard(page).locator('.apexcharts-xaxis-texts-g')).not.toContainText('24 Oct');
    await costCard(page).getByRole('button', { name: 'Month', exact: true }).click();
    await expect(costCard(page).locator('.apexcharts-xaxis-texts-g')).toContainText('Oct');
    await expect(costCard(page).locator('.apexcharts-xaxis-texts-g')).not.toContainText('Sep');
  });
});

test('failed machine and date changes hide the values belonging to the previous selection', async ({ page }) => {
  await openEnergy(page, url => url.searchParams.has('machine_id') ? 'fail' : energy());
  await expect(page.locator('#enk1-value')).toHaveText('30kWh');
  await expect(costCard(page).locator('apx-chart')).toHaveCount(1);
  await chooseMachine(page, 'VMC - 13 - M');
  await expect(page.getByRole('alert')).toContainText('Energy temporarily unavailable.');
  await expect(page.locator('#enk1-value')).toHaveCount(0);
  await expect(page.locator('#dashPanel-charts apx-chart')).toHaveCount(0);

  // The detail tab is protected too: a failed new range must not relabel the
  // old machine rows as data from that range.
  await page.goto('/energy-dashboard?view=details');
  await expect(page.locator('#dashPanel-details tbody')).toContainText('VMC - 1 - F');
  await page.route(/\/api\/dashboard\/energy(\?|$)/, route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Energy temporarily unavailable.' })
  }));
  await page.locator('#enFrom').fill('2026-10-22');
  await page.locator('#enFrom').dispatchEvent('change');
  await expect(page.getByRole('alert')).toContainText('Energy temporarily unavailable.');
  await expect(page.locator('#enk1-value')).toHaveCount(0);
  await expect(page.locator('#dashPanel-details table')).toHaveCount(0);
});

test('an older delayed machine response cannot replace the currently selected machine', async ({ page }) => {
  let release: (() => void) | undefined;
  const asked: URL[] = [];
  const completed: URL[] = [];
  await openEnergy(page, async url => {
    if (url.searchParams.get('machine_id') === '15') {
      await new Promise<void>(resolve => { release = resolve; });
      return energy({ kpis: { ...energy().kpis, total_kwh: 111 } });
    }
    return energy({ kpis: { ...energy().kpis, total_kwh: url.searchParams.get('machine_id') === '34' ? 222 : 30 } });
  }, { asked, completed });
  await expect(page.locator('#enk1-value')).toHaveText('30kWh');
  await chooseMachine(page, 'VMC - 1 - F');
  await expect.poll(() => !!release).toBe(true);
  await chooseMachine(page, 'VMC - 13 - M');
  await expect(page.locator('#enk1-value')).toHaveText('222kWh');
  release!();
  // Ensure the cancelled request has completed at the fixture boundary before
  // checking that the visible selection and value still agree.
  await expect.poll(() => completed.some(url => url.searchParams.get('machine_id') === '15')).toBe(true);
  expect(asked.filter(url => url.searchParams.has('machine_id'))).toHaveLength(2);
  await expect(page.locator('#enMachine option:checked')).toHaveText('VMC - 13 - M');
  await expect(page.locator('#enk1-value')).toHaveText('222kWh');
});
