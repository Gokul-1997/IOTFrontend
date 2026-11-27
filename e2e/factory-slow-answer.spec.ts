import { test, expect, localFixtureOrigin } from './fixtures/auth';

/*
 * Factory Overall Dashboard when the API is slow (27 Nov 2026, the user:
 * "API canceled — why does no error come?"). The board refreshes every
 * minute. That refresh used to cancel a request still on its way and start
 * it again, so an answer slower than a minute was cancelled every minute:
 * it never arrived and never failed — the page just said "Updating…".
 *  - the minute's refresh waits for the answer on its way;
 *  - an answer that does not come in time says so, and is asked again;
 *  - a filter change still replaces the old request (that cancel is right,
 *    and needs no message).
 */

const meta = { success: true, data: { machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }], shifts: [{ id: 10, shift_code: 'MS01', shift_name: 'Morning' }] } };
const factory = { status: 'success', data: {
  filters: { date: '2026-11-27', shift_id: null, shift_code: null, machine_id: null },
  updated_at: '2026-11-27T09:30:00.000Z',
  machines: { total: 12, running: 8, idle: 3, breakdown: 1, offline: 0 },
  production: { produced: 420, actual: 380, target: 600, target_pct: 63.3, machines_with_target: 6 },
  time: { run_seconds: 29520, idle_seconds: 7200, down_seconds: 3600 },
  oee: { availability: 82, performance: 76, quality: 98, oee: 61, target: 85 },
  energy: { kwh: 148.25, month_kwh: 3120.5, currency: 'INR', rate_per_kwh: 8, cost_day: 1186, cost_month: 24964 },
  shiftwise: [], downtime: { total_seconds: 0, planned_seconds: 0, unplanned_seconds: 0, by_reason: [] },
  alarms: { total: 0, critical: 0, non_critical: 0, information: 0, open: 0 }, trend: []
} };

async function board(page: any) {
  const held: any[] = [];
  const aborted: string[] = [];
  const origin = localFixtureOrigin();
  page.on('requestfailed', (r: any) => { if (r.url().includes('/dashboard/factory')) aborted.push(r.failure()?.errorText || ''); });
  await page.route('**/*', (r: any) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/factory*', (r: any) => { held.push(r); });   // answered by the test
  await page.clock.install();
  await page.goto('/factory');
  await expect.poll(() => held.length).toBe(1);
  const answer = (i: number, status = 200, body: unknown = factory) =>
    held[i].fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  return { held, aborted, answer };
}

test('a slow answer is waited for, not cancelled by the minute’s refresh', async ({ authedPage: page }) => {
  const { held, aborted, answer } = await board(page);
  await page.clock.runFor(61_000);                         // the refresh comes round while the first answer is still on its way
  expect(aborted).toEqual([]);
  expect(held).toHaveLength(1);
  await answer(0);
  await expect(page.locator('#fk1-value')).toHaveText('8');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an answer that does not come in time says so, and is asked for again', async ({ authedPage: page }) => {
  const { held, answer } = await board(page);
  await page.clock.runFor(71_000);
  await expect(page.getByRole('alert')).toContainText('taking too long');
  await page.clock.runFor(60_000);                         // the next minute asks again
  await expect.poll(() => held.length).toBe(2);
  await answer(1);
  await expect(page.locator('#fk1-value')).toHaveText('8');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the server giving up (504 from the proxy) is said too', async ({ authedPage: page }) => {
  const { answer } = await board(page);
  await answer(0, 504, '<html>504 Gateway Time-out</html>');
  await expect(page.getByRole('alert')).toContainText('taking too long');
});

test('a filter change replaces the request on its way, with no message', async ({ authedPage: page }) => {
  const { held, aborted, answer } = await board(page);
  await page.locator('#fShift').selectOption({ index: 1 });
  await expect.poll(() => held.length).toBe(2);
  await page.clock.runFor(500);
  expect(aborted).toHaveLength(1);                         // the old filters' request: no longer wanted
  await answer(1);
  await expect(page.locator('#fk1-value')).toHaveText('8');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
