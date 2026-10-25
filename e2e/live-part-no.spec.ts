import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The Live Dashboard card and the machine page show the same Part No for a
 * machine (25 Oct 2026, the user: the card's "Comp. ID" and the page's
 * "Component ID" were different values — "simply show Part No on both").
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const PART_NO = 'PN-45-1002-TURBINE-HOUSING-REV-C';

const card = (m: any) => ({ operator_name: '--', status: 'IDLE', alarm: false, run_minutes: 60, idle_minutes: 120,
  run_time: '01:00:00', idle_time: '02:00:00', produced_qty: 0, achieved_qty: 0, target_qty: 60, utilization: 0, ...m });

async function stub(page: any) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.routeWebSocket(/.*/, (ws: any) => ws.close());
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route(/\/api\/dashboard(\?.*)?$/, (r: any) => r.fulfill(ok({
    status: 'success',
    shift: { shift_code: 'S1', shiftElapsedMinutes: 60, plannedMinutes: 480 },
    summary: { total: 2, running: 0, idle: 2 },
    pagination: { page: 1, per_page: 8, total: 2, total_pages: 1 },
    machines: [
      card({ machine_id: 25, machine_serial_no: 'HMC - 7 - F', part_name: 'Turbine housing', component_id: 7, part_number: PART_NO }),
      card({ machine_id: 30, machine_serial_no: 'VMC - 12 - F', part_name: null, component_id: null, part_number: null })
    ]
  })));
  await page.route('**/api/dashboard/live/25', (r: any) => r.fulfill(ok({ status: 'success', data: {
    machine: { id: 25, machine_serial_no: 'HMC - 7 - F' },
    operator: {}, job: { part_name: 'Turbine housing', component_id: PART_NO, part_number: PART_NO, target_qty: 60 },
    oee: {}, shift: { shift_code: 'S1' }, quality: {}, power: {},
    production: { run_time: '01:00:00', idle_time: '02:00:00' },
    live: { machine_status: 'IDLE', mode: 'MEM', spindle_load: 0, feed_rate: 0, parts_count: 0, alarm: false, active_alarms: [] }
  } })));
}

test('the card and the machine page both say Part No, with the same part number', async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');

  await expect(page.getByText('Part No', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Comp. ID')).toHaveCount(0);
  await expect(page.getByTitle(PART_NO)).toHaveText(PART_NO);           // whole on hover when cut short
  const box = (await page.getByTitle(PART_NO).boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(150);                            // a long one stays in its card

  await page.getByRole('link', { name: /Open HMC - 7 - F/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/live\/25$/);
  await expect(page.getByText('Part No', { exact: true })).toBeVisible();
  await expect(page.getByText('Component ID')).toHaveCount(0);
  await expect(page.getByTitle(PART_NO)).toHaveText(PART_NO);
});

test('no part number reads "--", not another number', async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByTitle(PART_NO)).toBeVisible();
  // the second card's Part No is the empty mark, never the component's internal id
  await expect(page.locator('b[title="--"]').filter({ hasText: '--' }).first()).toBeVisible();
});
