import { test, expect, seedAuth } from './fixtures/auth';

/*
 * A machine with no photo added shows a quiet "No photo" mark — not a stock
 * picture of some other machine (28 Oct 2026, the user: "some machines have
 * no image added, but every machine shows an image"). Only that changed: a
 * machine with a photo loads and shows it exactly as before, on the Live
 * Dashboard card, its own page and the Maintenance Dashboard.
 */
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const PHOTO = '/images/product/machine_login_02.png';      // stands in for an uploaded photo: a direct path is shown as it is
const card = (m: object) => ({ operator_name: '--', status: 'IDLE', alarm: false, run_minutes: 60, idle_minutes: 120,
  run_time: '01:00:00', idle_time: '02:00:00', produced_qty: 0, achieved_qty: 0, target_qty: 60, utilization: 0, ...m });

async function stub(page: any) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.routeWebSocket(/.*/, (ws: any) => ws.close());
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', success: true, data: [] })));
  await page.route(/\/api\/dashboard(\?.*)?$/, (r: any) => r.fulfill(ok({
    status: 'success',
    shift: { shift_code: 'S1', shiftElapsedMinutes: 60, plannedMinutes: 480 },
    summary: { total: 2, running: 0, idle: 2 },
    pagination: { page: 1, per_page: 8, total: 2, total_pages: 1 },
    machines: [card({ machine_id: 25, machine_serial_no: 'HMC - 7 - F', image_url: PHOTO }),
               card({ machine_id: 30, machine_serial_no: 'VMC - 12 - F', image_url: null })]
  })));
  await page.route('**/api/dashboard/live/30', (r: any) => r.fulfill(ok({ status: 'success', data: {
    machine: { id: 30, machine_serial_no: 'VMC - 12 - F', image: null },
    operator: {}, job: { part_name: '--', target_qty: 0 }, oee: {}, shift: { shift_code: 'S1' }, quality: {}, power: {},
    production: { run_time: '01:00:00', idle_time: '02:00:00' },
    live: { machine_status: 'IDLE', mode: 'MEM', spindle_load: 0, feed_rate: 0, parts_count: 0, alarm: false, active_alarms: [] }
  } })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(ok({ success: true, data: {
    machines: [{ id: 30, machine_serial_no: 'VMC - 12 - F' }], shifts: [] } })));
  await page.route('**/api/dashboard/maintenance*', (r: any) => r.fulfill(ok({ status: 'success', data: {
    filters: { date: '2026-10-28', shift_id: null, machine_id: 30 }, updated_at: new Date().toISOString(),
    machines: { total: 1, running: 0, idle: 1, breakdown: 0, offline: 0 }, health: {}, oee: {},
    alarms: { total: 0, open: 0, critical: 0, non_critical: 0, information: 0 }, production: {},
    unavailable: [], condition_trend: [], cycle_trend: [], supply: null,
    rows: [{ machine_id: 30, machine_serial_no: 'VMC - 12 - F', image_url: null, machine_status: 'IDLE', alarm: false,
             received_at: new Date().toISOString(), run_seconds: 600 }]
  } })));
}

const photoOf = (page: any, alt: RegExp) => page.getByRole('img', { name: alt });

test('the Live Dashboard: a machine with a photo shows it; one without shows "No photo", not another machine\'s picture', async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const withPhoto = photoOf(page, /^HMC - 7 - F$/), without = photoOf(page, /^VMC - 12 - F$/);
  await expect(withPhoto).toHaveAttribute('src', PHOTO);
  await expect(withPhoto).not.toHaveClass(/is-no-photo/);
  await expect(without).toHaveClass(/is-no-photo/);
  expect(decodeURIComponent((await without.getAttribute('src'))!)).toContain('No photo');
  expect(await without.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);   // the mark draws
});

test('the machine page and the Maintenance Dashboard show "No photo" for it too', async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/live/30');
  await expect(photoOf(page, /VMC - 12 - F/).first()).toHaveClass(/is-no-photo/);
  await page.goto('/maintenance-dashboard');
  await expect(page.getByRole('img', { name: 'Photo of VMC - 12 - F' })).toHaveClass(/is-no-photo/);
  expect(await page.locator('img[src*="machine_login"]').count()).toBe(0);
});
