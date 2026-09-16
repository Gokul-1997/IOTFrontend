import { test, expect } from './fixtures/auth';

/*
 * Screenshots the Factory dashboard in the MEXA design so the result can be
 * compared against MEXA_DS_dashboard_UI_02.pdf page 1 by eye. A build that
 * compiles proves the template parses, not that it looks right.
 *
 * Reuses factory.spec's mocking approach: the broad /api/** stub is
 * registered first so the specific routes below win.
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
    filters: { date: '2026-08-10', shift_id: null, machine_id: null },
    updated_at: '2026-08-10T09:30:00.000Z',
    machines: { total: 34, running: 30, idle: 4, breakdown: 0, offline: 0 },
    production: { produced: 4600, planned: 5000, percent: 92 },
    time: { run_seconds: 66600, idle_seconds: 18720, down_seconds: 3600 },
    oee: { availability: 80, performance: 78.5, quality: 98.4, oee: 82.3, target: 85 },
    energy: { kwh: 4250, month_kwh: 128000, currency: 'INR',
              rate_per_kwh: 7.5, cost_day: 52000, cost_month: 1450000 },
    shiftwise: [{ shift_code: 'Shift 1', produced: 6500 }, { shift_code: 'Shift 2', produced: 5800 }],
    downtime: {
      total_seconds: 9000, planned_seconds: 3000, unplanned_seconds: 6000,
      by_reason: [
        { reason: 'Lunch', category: 'PLANNED', seconds: 18000, events: 6 },
        { reason: 'Machine Cleaning', category: 'PLANNED', seconds: 13320, events: 4 },
        { reason: 'Breakdown', category: 'UNPLANNED', seconds: 9000, events: 3 },
        { reason: 'Tea Break', category: 'PLANNED', seconds: 6000, events: 5 },
        { reason: 'Material Change', category: 'UNPLANNED', seconds: 15480, events: 4 }
      ]
    },
    alarms: { total: 62, critical: 5, non_critical: 12, information: 45, open: 7 },
    trend: Array.from({ length: 9 }, (_, i) => ({
      hour: `2026-08-10T0${i}:00:00.000Z`, kwh: 40 + i * 6, produced: 40000 + i * 2500
    }))
  }
};

async function mockApi(page: any) {
  await page.route('**/api/**', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metaResponse) }));
  await page.route('**/api/dashboard/factory*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factoryResponse) }));
}

test('factory dashboard renders in the MEXA design', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/factory');

  // the gradient field and the title bar are the design's two anchors
  await expect(page.locator('.mexa-shell')).toBeVisible();
  await expect(page.locator('.mexa-titlebar')).toContainText('Overall Factory Dashboard');

  // six tiles, in the order the design puts them
  await expect(page.locator('.mexa-kpi')).toHaveCount(6);
  await expect(page.locator('.mexa-kpi').first()).toContainText('30');

  // charts need a moment to draw before the screenshot is worth taking
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'mexa-factory.png', fullPage: true });
});
