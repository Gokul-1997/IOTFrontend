import { test, expect, seedAuth } from './fixtures/auth';

/*
 * A machine in alarm, on the list and on its own page.
 *
 * The machine list shows an alarm as its own flag beside Running / Idle — a
 * CNC in alarm usually stops, so it reads IDLE while the alarm is on. The
 * machine page showed only the status, so a machine the list was flashing red
 * (HMC-7-F, AIR PRESSURE LOW, 24 Sep 2026) read a plain "IDLE" on its page.
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

function detail(live: any) {
  return { status: 'success', data: {
    machine: { id: 25, machine_serial_no: 'HMC - 7 - F' },
    operator: {}, job: {}, oee: {}, shift: { shift_code: 'S1' }, quality: {}, power: {},
    production: { run_time: '01:00:00', idle_time: '02:00:00' },
    live: { machine_status: 'IDLE', mode: 'MEM', spindle_load: 0, feed_rate: 0, parts_count: 0, ...live }
  } };
}

const AIR = { alarm_code: 'EX1032', alarm_type: 'AIR PRESSURE LOW', message: 'AIR PRESSURE LOW',
              severity: 'NORMAL', started_at: '2026-09-24T05:21:47.000Z' };

async function openMachine(page: any, live: any) {
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/live/25', (r: any) => r.fulfill(ok(detail(live))));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/live/25');
  await expect(page.getByRole('heading', { name: 'HMC - 7 - F' })).toBeVisible();
}

test('the machine page shows the alarm beside IDLE, and names it', async ({ authedPage: page }) => {
  await openMachine(page, { alarm: true, active_alarms: [AIR] });
  const header = page.locator('.bg-top-bar').first();
  await expect(header).toContainText('IDLE');
  await expect(header).toContainText('ALARM');
  const banner = page.getByRole('alert');
  await expect(banner).toContainText('This machine is in alarm.');
  await expect(banner).toContainText('EX1032 AIR PRESSURE LOW');
  await expect(banner).toContainText('since 24 Sep, 10:51 AM');   // plant time
  await expect(banner).toContainText('Status shows IDLE because a machine in alarm stops cutting');
  // the same red card the machine list uses
  await expect(page.locator('.alarm-blink')).toHaveCount(1);
});

test('no alarm: no badge, no banner, no red card', async ({ authedPage: page }) => {
  await openMachine(page, { alarm: false, active_alarms: [] });
  await expect(page.locator('.bg-top-bar').first()).not.toContainText('ALARM');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.alarm-blink')).toHaveCount(0);
});

test('an alarm with no recorded code still says the machine is in alarm', async ({ authedPage: page }) => {
  await openMachine(page, { alarm: true, active_alarms: [] });
  await expect(page.getByRole('alert')).toContainText('its code has not been recorded yet');
});

/* With no socket delivering (an account with no plant room, a blocked
   network) the list's alarm used to freeze at the first load: an alarm that
   cleared kept the card red. The poll now carries it. The socket cannot
   connect in this test at all — which, before, left the page empty. */
test('the list follows the poll when the socket is silent', async ({ authedPage: page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });   // holds the counters widget
  let alarm = true;
  const list = () => ({
    status: 'success',
    shift: { shift_code: 'S1', shiftElapsedMinutes: 60, plannedMinutes: 480 },
    summary: { total: 1, running: 0, idle: 1 },
    machines: [{ machine_id: 25, machine_serial_no: 'HMC - 7 - F', operator_name: '--', part_name: null,
                 status: 'IDLE', alarm, run_minutes: 60, idle_minutes: 120, run_time: '01:00:00',
                 idle_time: '02:00:00', produced_qty: 0, achieved_qty: 0, target_qty: 0, utilization: 0 }]
  });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route(/\/api\/dashboard(\?.*)?$/, (r: any) => r.fulfill(ok(list())));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');

  await expect(page.getByText('HMC - 7 - F').first()).toBeVisible();
  await expect(page.locator('.alarm-blink')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Alarm : 1/ })).toBeVisible();

  alarm = false;                              // the alarm clears on the machine
  // the next poll: returning to the tab re-fetches at once, as the 30 s
  // timer would (the page's own visibilitychange handler)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.alarm-blink')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Alarm : 0/ })).toBeVisible();
});
