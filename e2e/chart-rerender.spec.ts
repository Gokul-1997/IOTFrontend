import { test, expect } from './fixtures/auth';

/*
 * What does a click on a dashboard actually cost?
 *
 * Two separate suspicions, measured separately:
 *   - does clicking re-fetch from the API?
 *   - does clicking redraw the charts?
 *
 * Chart options are bound through getters that build a fresh object every
 * change-detection pass. Angular compares inputs by reference, so a click —
 * which runs change detection — hands ng-apexcharts "new" options and the
 * chart redraws, restarting its animation.
 */

const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
    shifts:   [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }]
  }
};

const factory = {
  status: 'success',
  data: {
    filters: { date: '2026-09-16', shift_id: null, machine_id: null },
    updated_at: '2026-09-16T09:30:00.000Z',
    machines: { total: 12, running: 8, idle: 3, breakdown: 1, offline: 0 },
    production: { produced: 420, planned: 500, percent: 84 },
    time: { run_seconds: 29520, idle_seconds: 7200, down_seconds: 3600 },
    oee: { availability: 82, performance: 76, quality: 98, oee: 61, target: 85 },
    energy: { kwh: 148.25, month_kwh: 3120.5, currency: 'INR', rate_per_kwh: 8, cost_day: 1186, cost_month: 24964 },
    shiftwise: [{ shift_code: 'Shift 1', produced: 250 }, { shift_code: 'Shift 2', produced: 170 }],
    downtime: { total_seconds: 9000, planned_seconds: 3000, unplanned_seconds: 6000,
      by_reason: [{ reason: 'Tool Change', category: 'PLANNED', seconds: 5400, events: 3 }] },
    alarms: { total: 62, critical: 5, non_critical: 12, information: 45, open: 7 },
    trend: Array.from({ length: 8 }, (_, i) => ({ hour: `2026-09-16T0${i}:00:00.000Z`, kwh: 40 + i * 6, produced: 40 + i * 5 }))
  }
};

test('a click on the page should not re-fetch or redraw the charts', async ({ authedPage: page }) => {
  const apiCalls: string[] = [];
  await page.route('**/api/**', route => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', success: true, data: [] }) });
  });
  await page.route('**/api/charts/meta*', route => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) });
  });
  await page.route('**/api/dashboard/factory*', route => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factory) });
  });

  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/factory');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await page.waitForTimeout(2500);

  // count redraws: ng-apexcharts destroys and recreates the SVG on redraw
  await page.evaluate(() => {
    (window as any).__redraws = 0;
    const target = document.querySelector('apx-chart');
    if (!target) return;
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && n.querySelector?.('svg.apexcharts-svg')) (window as any).__redraws++;
        }
      }
    }).observe(target, { childList: true, subtree: true });
  });

  const callsBefore = apiCalls.length;

  // click somewhere inert — a heading, not a control
  for (let i = 0; i < 3; i++) {
    await page.locator('.mexa-title').click();
    await page.waitForTimeout(400);
  }

  const redraws = await page.evaluate(() => (window as any).__redraws ?? 0);
  const newCalls = apiCalls.slice(callsBefore);

  console.log(`API requests caused by 3 clicks: ${newCalls.length}`);
  console.log(`chart redraws caused by 3 clicks: ${redraws}`);
  newCalls.forEach(u => console.log('   refetch:', u));

  expect(newCalls, 'clicking must not re-fetch from the API').toHaveLength(0);
  expect(redraws, 'clicking must not redraw the charts').toBe(0);
});
