import { test, expect, localFixtureOrigin } from './fixtures/auth';

/**
 * Phase 2 · Screen 1 — Factory Overall Dashboard.
 * Mocks /api/dashboard/factory and /api/charts/meta so the test runs
 * without a live backend, mirroring dashboard.spec.ts.
 */

const metaResponse = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }, { id: 2, machine_serial_no: 'VMC-2-F' }],
    shifts:   [{ id: 10, shift_code: 'MS01', shift_name: 'Morning' }]
  }
};

const factoryResponse = {
  status: 'success',
  data: {
    filters: { date: '2026-08-10', shift_id: null, shift_code: null, machine_id: null },
    updated_at: '2026-08-10T09:30:00.000Z',
    machines: { total: 12, running: 8, idle: 3, breakdown: 1, offline: 0 },
    production: { produced: 420, actual: 380, target: 600, target_pct: 63.3, machines_with_target: 6 },
    time: { run_seconds: 29520, idle_seconds: 7200, down_seconds: 3600 },
    oee: { availability: 82, performance: 76, quality: 98, oee: 61, target: 85 },
    energy: {
      kwh: 148.25, month_kwh: 3120.5, currency: 'INR',
      rate_per_kwh: 8, cost_day: 1186, cost_month: 24964
    },
    shiftwise: [
      { shift_id: 1, shift_code: 'MS01', start_time: '06:00:00', end_time: '14:00:00', produced: 220, actual: 200, target: 300 },
      { shift_id: 2, shift_code: 'MS02', start_time: '14:00:00', end_time: '22:00:00', produced: 200, actual: 180, target: 300 }
    ],
    downtime: {
      total_seconds: 3600, planned_seconds: 1200, unplanned_seconds: 2400,
      by_reason: [
        { reason: 'Tool Change', category: 'PLANNED',   seconds: 1200, events: 3 },
        { reason: 'Breakdown',   category: 'UNPLANNED', seconds: 2400, events: 2 }
      ]
    },
    alarms: { total: 9, critical: 2, non_critical: 4, information: 3, open: 5 },
    trend: [
      { hour: '2026-08-10T02:00:00.000Z', kwh: 12.5, produced: 40, target: 37 },
      { hour: '2026-08-10T03:00:00.000Z', kwh: 14.1, produced: 52, target: 37 }
    ]
  }
};

/**
 * Registered first so the specific routes below win (Playwright uses the
 * most recently registered matching route). Without this, any unmocked
 * call — the layout's notification poll, for one — 401s against the real
 * API, and the auth interceptor logs the stub user out mid-test.
 */
async function mockApi(page: any, factory: any = factoryResponse) {
  const origin = localFixtureOrigin();
  await page.route('**/*', (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route('**/api/**', (route: any) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', success: true, data: [] })
    })
  );
  await page.route('**/api/charts/meta*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metaResponse) })
  );
  await page.route('**/api/dashboard/factory*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factory) })
  );
}

test.describe('Factory Overall Dashboard', () => {

  test('renders machine states, production, OEE, energy and alarms', async ({ authedPage: page }) => {
    await mockApi(page);
    await page.goto('/factory');

    await expect(page.getByRole('heading', { name: /Overall Factory Dashboard/i })).toBeVisible();

    // machine state tiles: running and idle are the headline figures, and
    // the fleet size rides with them so the counts have a denominator
    await expect(page.getByText('8', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('3', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/of 12 machines/i)).toBeVisible();

    // production against the job targets, as the mock shows it (92%), with
    // the counts behind the percentage
    const prod = page.locator('.mexa-kpi', { hasText: 'Production' });
    await expect(prod.getByText('63.3%')).toBeVisible();
    await expect(prod).toContainText('420 total pieces');
    await expect(prod).toContainText('380 of 600 target');

    // Actual vs Target uses the same output as each shift's chart.
    await expect(page.getByRole('heading', { name: 'Actual vs Target' })).toBeVisible();
    await expect(page.getByText('200 / 300 Units')).toBeVisible();
    await expect(page.getByText('180 / 300 Units')).toBeVisible();

    // the Production Trend is actual against target; energy has its own trend
    await expect(page.getByRole('heading', { name: 'Energy Consumption Trend' })).toBeVisible();
    await expect(page.locator('section', { hasText: 'Production Trend' }).getByText('Target', { exact: true })).toBeVisible();

    // OEE headline + target. The figure now appears twice by design — the
    // KPI tile and the radial's centre label — so the tile is named.
    await expect(page.locator('.mexa-kpi', { hasText: 'Overall' })
                     .getByText('61%')).toBeVisible();
    await expect(page.getByText(/Target 85%/i)).toBeVisible();

    // energy, with the configured tariff applied
    await expect(page.getByText(/148\.25/)).toBeVisible();
    await expect(page.getByText(/₹1,186/)).toBeVisible();

    // alarm classes from the agreement
    // the agreement hyphenates it, MEXA_DS_dashboard_UI_02.pdf does not;
    // either spelling names the same class
    await expect(page.getByText(/Non[- ]Critical/i).first()).toBeVisible();
    await expect(page.getByText(/Information/i).first()).toBeVisible();
  });

  test('shows "Tariff not set" instead of zero when no rate is configured', async ({ authedPage: page }) => {
    const noTariff = JSON.parse(JSON.stringify(factoryResponse));
    noTariff.data.energy.rate_per_kwh = null;
    noTariff.data.energy.cost_day = null;
    noTariff.data.energy.cost_month = null;

    await mockApi(page, noTariff);
    await page.goto('/factory');

    await expect(page.getByText(/Tariff not set/i).first()).toBeVisible();
  });

  test('surfaces an error message when the API fails', async ({ authedPage: page }) => {
    await mockApi(page);
    // 500, not 401 — a 401 would trip the auth interceptor's logout path
    // rather than surfacing an error on the page.
    await page.route('**/api/dashboard/factory*', (route: any) =>
      route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'Shift not found or access denied' })
      })
    );

    await page.goto('/factory');
    await expect(page.getByText(/Shift not found or access denied/i)).toBeVisible();
  });

});

test('no job targets: the production tile counts pieces and says why there is no percentage', async ({ authedPage: page }) => {
  const noTarget = JSON.parse(JSON.stringify(factoryResponse));
  noTarget.data.production = { produced: 420, actual: 0, target: null, target_pct: null, machines_with_target: 0 };
  noTarget.data.shiftwise = noTarget.data.shiftwise.map((s: any) => ({ ...s, target: null }));
  await mockApi(page, noTarget);
  await page.goto('/factory');
  const prod = page.locator('.mexa-kpi', { hasText: 'Production' });
  await expect(prod.getByText('420')).toBeVisible();
  await expect(prod.getByText(/no job target set/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Actual vs Target' })).toHaveCount(0);
});

const todayResponse = () => {
  const response = structuredClone(factoryResponse);
  response.data.filters.date = '2026-10-27';
  response.data.updated_at = '2026-10-27T07:04:00.000Z';
  response.data.production = { produced: 149, actual: 149, target: 1724, target_pct: 8.6, machines_with_target: 6 };
  response.data.time.run_seconds = 37.75 * 3600;
  response.data.energy.kwh = 30.52;
  response.data.shiftwise = [
    { shift_id: 1, shift_code: 'Shift 1', start_time: '08:00:00', end_time: '20:00:00', produced: 149, actual: 149, target: 862, status: 'in_progress' },
    { shift_id: 2, shift_code: 'Shift 2', start_time: '20:00:00', end_time: '08:00:00', produced: 0, actual: 0, target: 862, status: 'upcoming' }
  ] as any;
  return response;
};

test('shift chart keeps simple names and tonight stays not started until its own output arrives', async ({ authedPage: page }) => {
  await page.clock.install({ time: new Date('2026-10-27T12:34:00+05:30') });
  await page.setViewportSize({ width: 1600, height: 1000 });
  const response = todayResponse();
  await mockApi(page, response);
  await page.goto('/factory');
  const card = page.locator('section[aria-labelledby="fxShiftTitle"]');
  await expect(card.locator('.apexcharts-xaxis-label tspan')).toHaveText(['Shift 1', 'Shift 2']);
  await expect(card).not.toContainText(/\d{1,2}:\d{2}/);
  await expect(card.locator('.fx-shift-row').nth(1)).toContainText('Not started');
  await expect(card.locator('.fx-shift-row').nth(1)).toContainText('0 / 862 Units');
  await expect(page.locator('.mexa-kpi', { hasText: 'Production' })).toContainText('149 total pieces');
  await expect(page.locator('.mexa-kpi', { hasText: 'Production' })).toContainText('149 of 1,724 target');
  await page.clock.runFor(1200);
  await card.screenshot({ path: '/private/tmp/mexa-factory-shifts.png' });
  await card.getByRole('button', { name: 'What is Shift-wise production?' }).click();
  await expect(page.getByRole('dialog', { name: 'Shift-wise production' })).toContainText('Output after midnight stays with the date that shift started');
  await page.keyboard.press('Escape');

  response.data.updated_at = '2026-10-27T15:30:00.000Z';
  Object.assign(response.data.shiftwise[1], { produced: 60, actual: 60, status: 'in_progress' });
  Object.assign(response.data.production, { produced: 209, actual: 209, target_pct: 12.1 });
  await page.clock.setSystemTime(new Date('2026-10-27T21:00:00+05:30'));
  await page.reload();
  await expect(card.locator('.fx-shift-row').nth(1)).toContainText('In progress');
  await expect(card.locator('.fx-shift-row').nth(1)).toContainText('60 / 862 Units');
});

test('unassigned recorded output has a count without an invalid target bar', async ({ authedPage: page }) => {
  const response = todayResponse();
  response.data.shiftwise.push({ shift_id: null, shift_code: 'Unassigned', start_time: null, end_time: null, produced: 4, actual: 0, target: null } as any);
  await mockApi(page, response);
  await page.goto('/factory');
  const row = page.locator('.fx-shift-row').filter({ hasText: 'Unassigned' });
  await expect(row).toContainText('4 Units');
  await expect(row.getByRole('progressbar')).toHaveCount(0);
});

test('shift chart and target rows use identical counts while all output stays in total pieces', async ({ authedPage: page }) => {
  const response = todayResponse();
  Object.assign(response.data.production, { produced: 6122, actual: 493, target: 1726, target_pct: 28.6 });
  Object.assign(response.data.shiftwise[0], { produced: 433, actual: 433, target: 863, status: 'completed' });
  Object.assign(response.data.shiftwise[1], { produced: 5689, actual: 60, target: 863, status: 'in_progress' });
  await mockApi(page, response);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/factory');
  const card = page.locator('section[aria-labelledby="fxShiftTitle"]');
  await expect(card.locator('.fx-shift-produced')).toHaveCount(0);
  await expect(card).not.toContainText('Targeted machines:');
  await expect(card.locator('.apexcharts-bar-area').nth(0)).toHaveAttribute('val', '433');
  await expect(card.locator('.apexcharts-bar-area').nth(1)).toHaveAttribute('val', '60');
  await expect(card.locator('.fx-shift-row').nth(1)).toContainText('60 / 863 Units');
  const headline = page.locator('.mexa-kpi', { hasText: 'Production' });
  await expect(headline).toContainText('6,122 total pieces');
  await expect(headline).toContainText('493 of 1,726 target');
  await page.waitForTimeout(1000); // Capture the chart after its initial bar animation.
  await card.screenshot({ path: '/private/tmp/mexa-production-count-scope.png' });
});

test('failed new filters cannot show the previous machine counts under the new selection', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi', { hasText: 'Production' })).toContainText('420 total pieces');
  await page.route('**/api/dashboard/factory*', route => route.fulfill({ status: 500,
    json: { status: 'error', message: 'Selected machine data is unavailable.' } }));
  await page.locator('#fMachine').selectOption({ label: 'VMC-2-F' });
  await expect(page.getByRole('alert')).toContainText('Selected machine data is unavailable.');
  await expect(page.locator('section[aria-labelledby="fxShiftTitle"]')).toHaveCount(0);
  await expect(page.locator('.mexa-kpi')).toHaveCount(0);
});

for (const timezoneId of ['Asia/Kolkata', 'America/Los_Angeles']) {
  test.describe(`plant date with browser timezone ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('after plant midnight the selected day is the new plant date', async ({ authedPage: page }) => {
      await page.clock.install({ time: new Date('2026-10-27T01:00:00+05:30') });
      const response = todayResponse();
      const dates: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/dashboard/factory') dates.push(url.searchParams.get('date')!);
      });
      await mockApi(page, response);
      await page.goto('/factory');
      await expect(page.locator('#fDate')).toHaveValue('2026-10-27');
      await expect.poll(() => dates[0]).toBe('2026-10-27');
    });
  });
}
