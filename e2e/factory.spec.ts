import { test, expect } from './fixtures/auth';

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
    await expect(prod.getByText(/380 of 600 target · 420 pieces/)).toBeVisible();

    // Actual vs Target per shift, and each shift labelled with its hours
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
