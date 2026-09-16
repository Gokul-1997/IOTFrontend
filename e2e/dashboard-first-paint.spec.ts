import { test, expect } from './fixtures/auth';

/*
 * "Downtime and Alarms render but the data does not show — it only appears
 *  when you click the page again."
 *
 * The existing dashboard specs cannot catch this: they fulfil every route
 * instantly, so the response is already in hand on the first change-detection
 * pass and the view is painted before any assertion runs. The reported bug
 * needs the response to land *after* the first paint, which is what real
 * network latency does and what the delay below reproduces.
 *
 * The app is zoneless (no zone.js in package.json, no provideZoneChangeDetection),
 * so nothing repaints on its own when an HTTP response resolves — only the
 * component's own markForCheck() does. But the header carries
 * @HostListener('document:click'), an Angular listener that schedules a global
 * change-detection pass on *any* click anywhere. That is the mechanism that
 * would make a second click appear to "fix" the page, and it is why this test
 * asserts the data is on screen with NO click having been made.
 */

const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
    shifts:   [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }]
  }
};

const ok = (data: any) => ({ status: 'success', data });

const alarmReport = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  kpis: { total: 128, critical: 86, normal: 42, open: 7,
          max_duration_seconds: 8710, avg_duration_seconds: 803 },
  by_machine: [
    { machine_serial_no: 'CNC-01', total: 51 }, { machine_serial_no: 'CNC-02', total: 38 }
  ],
  by_shift: [{ shift_name: 'Shift 1', total: 48 }, { shift_name: 'Shift 2', total: 52 }],
  by_severity: { critical: 86, normal: 42 },
  trend: Array.from({ length: 6 }, (_, i) => ({
    day: `2026-06-${13 + i}T00:00:00.000Z`, total: 10 + i * 15, critical: 5 + i * 9
  })),
  facets: { types: ['Servo Ready Off'], codes: ['SV401'] },
  alarms: {
    data: [
      { machine_serial_no: 'CNC-01', shift_name: 'Shift 1', alarm_code: 'SV401',
        alarm_type: 'Servo Ready Off', severity: 'CRITICAL', is_open: false, duration_seconds: 803,
        started_at: '2026-06-21T09:15:22.000Z', ended_at: '2026-06-21T09:28:45.000Z' }
    ],
    total: 1, page: 1, limit: 20, totalPages: 1
  }
});

const downtime = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  kpis: { total_downtime_seconds: 67500, downtime_events: 42, open_events: 3,
          run_seconds: 475200, idle_seconds: 30000, alarm_seconds: 20400,
          availability_pct: 8.75, unaccounted_seconds: 5400, reason_coverage_pct: 92 },
  by_reason: [
    { reason: 'Machine Alarm', events: 12, seconds: 20400, share_pct: 30.13, cumulative_pct: 30.13 },
    { reason: 'Tool Change',   events: 15, seconds: 15900, share_pct: 23.46, cumulative_pct: 53.59 }
  ],
  top_reasons: [], by_category: [],
  by_shift: [
    { id: 10, shift_name: 'Shift 1', events: 25, seconds: 22500 },
    { id: 11, shift_name: 'Shift 2', events: 17, seconds: 45000 }
  ],
  hourly: Array.from({ length: 6 }, (_, i) => ({ hour: i * 4, events: i, seconds: [1200, 3600, 6600, 4800, 3000, 1500][i] })),
  events: {
    data: [
      { started_at: '2026-06-22T09:15:00.000Z', ended_at: '2026-06-22T09:42:00.000Z',
        duration_seconds: 1620, machine_serial_no: 'CNC-01', shift_name: 'Shift 1',
        reason: 'Servo Alarm', sub_reason: null, category: 'UNPLANNED',
        operator_name: 'Kumar', is_open: false }
    ],
    total: 1, page: 1, limit: 20, totalPages: 1
  }
});

/** Fulfils after `ms`, the way a real API does. */
const slow = (body: any, ms: number) => async (route: any) => {
  await new Promise(r => setTimeout(r, ms));
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
};

const screens = [
  { path: '/alarm-report',      name: 'Alarms',   payload: alarmReport, route: '**/api/dashboard/alarms*',
    marker: '128', kpis: 5 },
  { path: '/downtime-analysis', name: 'Downtime', payload: downtime,    route: '**/api/dashboard/downtime*',
    marker: '42',  kpis: 6 }
];

for (const s of screens) {
  test(`${s.name} paints its data when the response lands after first render — with no click`, async ({ authedPage: page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
    await page.route('**/api/charts/meta*', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
    await page.route('**/api/downtime/reasons*', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(ok([])) }));
    // the whole point: this one arrives well after the first paint
    await page.route(s.route, slow(s.payload, 900));

    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(s.path);

    // the shell paints immediately; the data has not arrived yet
    await expect(page.locator('.mexa-titlebar')).toBeVisible();

    // No click, no hover, no keyboard — if this needs an event to appear,
    // that is precisely the reported bug.
    await expect(page.locator('.mexa-kpis')).toContainText(s.marker, { timeout: 6000 });
    await expect(page.locator('.mexa-kpi')).toHaveCount(s.kpis);

    // and the charts must actually be drawn, not merely mounted
    await expect.poll(
      async () => page.locator('apx-chart svg.apexcharts-svg').count(),
      { timeout: 6000, message: 'charts drawn without a click' }
    ).toBeGreaterThan(0);
  });
}
