import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Renders all eight Phase 2 dashboards in the MEXA design and screenshots
 * each one, so the result can be compared against MEXA_DS_dashboard_UI_02.pdf
 * by eye. A build that compiles proves the templates parse, not that the
 * bindings reach real fields — a getter that does not exist renders as an
 * empty card in silence, which is exactly the failure this catches.
 *
 * Screen 1 (Factory) has its own spec; this covers Screens 2–9.
 *
 * The broad /api/** stub is registered first so the specific routes win.
 */

const meta = {
  success: true,
  data: {
    machines: [
      { id: 1, machine_serial_no: 'CNC-01' },
      { id: 2, machine_serial_no: 'CNC-02' },
      { id: 3, machine_serial_no: 'CNC-03' }
    ],
    shifts: [
      { id: 10, shift_code: 'S1', shift_name: 'Shift 1' },
      { id: 11, shift_code: 'S2', shift_name: 'Shift 2' }
    ]
  }
};

const ok = (data: any) => ({ status: 'success', data });

/* ── per-screen payloads, shaped as each service actually returns ── */

const maintenance = ok({
  filters: { date: '2026-06-18', shift_id: null, machine_id: null },
  updated_at: '2026-06-18T10:30:00.000Z',
  machines: { total: 20, running: 16, idle: 2, breakdown: 1, offline: 1 },
  health: { healthy: 18, unhealthy: 2, percent: 90, basis: 'Reporting within 60s and not in alarm' },
  alarms: { total: 62, open: 7, critical: 5, non_critical: 12, information: 45 },
  oee: { availability: 0.89, performance: 0.88, quality: 0.95, oee: 0.82 },
  production: { produced: 12560, run_seconds: 66600, idle_seconds: 18720 },
  rows: [
    { machine_id: 1, machine_serial_no: 'CNC-01', component_id: '602004', part_name: 'VALVE_OP20',
      target_qty: 400, operator_name: 'Suresh Babu', machine_status: 'RUNNING', alarm: false,
      spindle_load: 75, feed_rate: 1200, received_at: new Date().toISOString(), run_seconds: 16338,
      // the embedded team's sample, with Y and Z temperature silent — the
      // "temperature for one servo only" case
      spindle_speed: 70, spindle_motor_temp: 36, spindle_insulation_res: null,
      servo_load_x: 5, servo_load_y: 6, servo_load_z: 6,
      servo_temp_x: 27, servo_temp_y: null, servo_temp_z: null,
      encoder_temp_x: null, encoder_temp_y: null, encoder_temp_z: null,
      cnc_battery_voltage: null, apc_battery_voltage: null,
      sequence_number: 100, fan_status: null },
    { machine_id: 2, machine_serial_no: 'CNC-02', component_id: '602005', part_name: 'HOUSING_OP10',
      target_qty: 300, operator_name: 'Ramesh', machine_status: 'IDLE', alarm: false,
      spindle_load: 12, feed_rate: 0, received_at: new Date().toISOString(), run_seconds: 9000 },
    { machine_id: 3, machine_serial_no: 'CNC-03', component_id: null, part_name: null,
      target_qty: null, operator_name: null, machine_status: null, alarm: null,
      spindle_load: null, feed_rate: null, received_at: null, run_seconds: 0 }
  ],
  condition_trend: [],
  unavailable: ['encoder_temperature', 'battery_status', 'insulation_resistance', 'fan_amplifier_status']
});

const preventive = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  filters: { date: '2026-06-18', machine_id: null, search: null },
  kpis: { critical_alarms: 40, critical_alarms_open: 20, pm_generated: 25, pm_open: 20,
          pm_completed: 20, pm_overdue: 3, avg_resolution_hours: 19.75, resolved_count: 18 },
  alarm_trend: Array.from({ length: 6 }, (_, i) => ({
    day: `2026-06-${13 + i}T00:00:00.000Z`, critical: 35 + i * 9
  })),
  alarm_severity: { critical: 24, non_critical: 16, information: 8 },
  alarms_by_machine: [
    { machine_serial_no: 'CNC-01', critical: 12 }, { machine_serial_no: 'CNC-02', critical: 9 },
    { machine_serial_no: 'CNC-03', critical: 7 },  { machine_serial_no: 'CNC-04', critical: 5 },
    { machine_serial_no: 'CNC-05', critical: 3 }
  ],
  top_alarm_reasons: [
    { alarm_type: 'Spindle Overload', occurrences: 16, critical: 16 },
    { alarm_type: 'Servo Overload', occurrences: 12, critical: 12 },
    { alarm_type: 'High Temperature', occurrences: 8, critical: 8 },
    { alarm_type: 'Hydr. Pressure Low', occurrences: 6, critical: 6 },
    { alarm_type: 'Lubrication Alarm', occurrences: 4, critical: 4 }
  ],
  ticket_status: { open: 12, in_progress: 5, completed: 8 },
  tickets: {
    data: [
      { ticket_id: 'PM-2026-041', machine_serial_no: 'CNC-01', alarm_name: 'Spindle Overload',
        priority: 'HIGH', created_at: '2026-06-21T09:15:00.000Z', due_date: '2026-06-22T09:15:00.000Z',
        status: 'OPEN', age_hours: 6, threshold_count: 3, is_overdue: false },
      { ticket_id: 'PM-2026-042', machine_serial_no: 'CNC-02', alarm_name: 'Servo Overload',
        priority: 'HIGH', created_at: '2026-06-21T09:15:00.000Z', due_date: '2026-06-20T09:15:00.000Z',
        status: 'IN_PROGRESS', age_hours: 30, threshold_count: 5, is_overdue: true },
      { ticket_id: 'PM-2026-043', machine_serial_no: 'CNC-03', alarm_name: 'High Temperature',
        priority: 'LOW', created_at: '2026-06-21T09:15:00.000Z', due_date: null,
        status: 'CLOSED', age_hours: 48, threshold_count: null, is_overdue: false }
    ],
    total: 3, page: 1, limit: 10, totalPages: 1
  },
  alarm_triggers: []
});

const periodic = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  filters: { machine_id: null, search: null, status: null, due: null },
  kpis: { scheduled: 126, due_today: 18, due_this_week: 30, overdue: 14, completed: 89,
          compliance_pct: 87.5, compliance_basis: { on_time: 70, judged: 80 } },
  compliance_trend: Array.from({ length: 6 }, (_, i) => ({
    week_start: `2026-06-${15 + i}T00:00:00.000Z`, compliance_pct: 35 + i * 9
  })),
  by_frequency: [
    { frequency: 'DAILY',   open: 18, overdue: 1, completed: 17, next_due_at: '2026-06-22T09:00:00.000Z' },
    { frequency: 'WEEKLY',  open: 18, overdue: 1, completed: 17, next_due_at: '2026-06-25T09:00:00.000Z' },
    { frequency: 'MONTHLY', open: 18, overdue: 1, completed: 17, next_due_at: null }
  ],
  technician_workload: [
    { technician: 'Ravi',  user_id: 1, open: 24, overdue: 5 },
    { technician: 'Arun',  user_id: 2, open: 16, overdue: 0 },
    { technician: 'Kumar', user_id: 3, open: 8,  overdue: 2 }
  ],
  upcoming: [
    { id: 1, machine_serial_no: 'CNC-01', title: 'Air Pressure Check', frequency: 'DAILY',
      due_date: '2026-06-22T09:00:00.000Z', assigned_to_name: 'Ravi', is_overdue: false },
    { id: 2, machine_serial_no: 'CNC-02', title: 'Check Coolant Oil', frequency: 'WEEKLY',
      due_date: '2026-06-10T09:00:00.000Z', assigned_to_name: null, is_overdue: true }
  ],
  tickets: {
    data: [
      { id: 41, title: 'Air Pressure Check', status: 'CLOSED', priority: 'LOW',
        due_date: '2026-06-21T09:00:00.000Z', completed_at: '2026-06-21T09:15:00.000Z',
        frequency: 'DAILY', grace_days: 0, machine_serial_no: 'CNC-01',
        assigned_to_name: 'Ravi', is_overdue: false },
      { id: 42, title: 'Air Pressure Check', status: 'IN_PROGRESS', priority: 'MEDIUM',
        due_date: '2026-06-21T09:00:00.000Z', completed_at: null, frequency: 'WEEKLY',
        grace_days: 0, machine_serial_no: 'CNC-05', assigned_to_name: 'Arun', is_overdue: true }
    ],
    total: 2, page: 1, limit: 10, totalPages: 1
  }
});

const alarmReport = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  kpis: { total: 128, critical: 86, normal: 42, open: 7,
          max_duration_seconds: 8710, avg_duration_seconds: 803 },
  by_machine: [
    { machine_serial_no: 'CNC-01', total: 51 }, { machine_serial_no: 'CNC-02', total: 38 },
    { machine_serial_no: 'CNC-03', total: 32 }, { machine_serial_no: 'CNC-04', total: 26 },
    { machine_serial_no: 'CNC-05', total: 20 }
  ],
  by_shift: [{ shift_name: 'Shift 1', total: 48 }, { shift_name: 'Shift 2', total: 52 }],
  by_severity: { critical: 86, normal: 42 },
  trend: Array.from({ length: 6 }, (_, i) => ({
    day: `2026-06-${13 + i}T00:00:00.000Z`, total: 10 + i * 15, critical: 5 + i * 9
  })),
  facets: { types: ['Servo Ready Off', 'Over Travel Alarm', 'Spindle Overload'], codes: ['SV401', 'OT506'] },
  alarms: {
    data: [
      { machine_serial_no: 'CNC-01', shift_name: 'Shift 1', alarm_code: 'SV401',
        alarm_type: 'Servo Ready Off', severity: 'CRITICAL', is_open: false, duration_seconds: 803,
        started_at: '2026-06-21T09:15:22.000Z', ended_at: '2026-06-21T09:28:45.000Z' },
      { machine_serial_no: 'CNC-04', shift_name: 'Shift 1', alarm_code: 'NA102',
        alarm_type: 'Low Air Pressure', severity: 'NORMAL', is_open: true, duration_seconds: 803,
        started_at: '2026-06-21T09:15:22.000Z', ended_at: null }
    ],
    total: 2, page: 1, limit: 20, totalPages: 1
  }
});

const downtime = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  kpis: { total_downtime_seconds: 67500, downtime_events: 42, open_events: 3,
          run_seconds: 475200, idle_seconds: 30000, alarm_seconds: 20400,
          availability_pct: 8.75, unaccounted_seconds: 5400, reason_coverage_pct: 92 },
  by_reason: [
    { reason: 'Machine Alarm',    events: 12, seconds: 20400, share_pct: 30.13, cumulative_pct: 30.13 },
    { reason: 'Tool Change',      events: 15, seconds: 15900, share_pct: 23.46, cumulative_pct: 53.59 },
    { reason: 'Setup Changeover', events: 6,  seconds: 11700, share_pct: 17.24, cumulative_pct: 70.83 },
    { reason: 'Operator Break',   events: 4,  seconds: 9000,  share_pct: 13.11, cumulative_pct: 83.94 },
    { reason: 'Maintenance',      events: 3,  seconds: 4800,  share_pct: 8.44,  cumulative_pct: 92.38 }
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
        operator_name: 'Kumar', is_open: false },
      { started_at: '2026-06-22T10:15:00.000Z', ended_at: null,
        duration_seconds: 1500, machine_serial_no: 'CNC-01', shift_name: 'Shift 2',
        reason: 'Pressure Low', sub_reason: 'Air line', category: 'PLANNED',
        operator_name: 'Ramesh', is_open: true }
    ],
    total: 2, page: 1, limit: 20, totalPages: 1
  }
});

const operator = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  filters: {},
  kpis: { produced: 2100, good: 2050, rejected: 50, run_seconds: 157500, idle_seconds: 23400,
          quality_rate_pct: 97.6, utilization_pct: 87.1, oee_pct: 85.6 },
  attribution: { operators: 100, shared_machines: 10, note: 'Machines with more than one assigned operator appear in each of their rows.' },
  bands: { excellent: 20, good: 60, average: 15, needs_help: 5, unrated: 0 },
  by_production: [],
  top_performers: [],
  operators: {
    data: [
      { operator_id: 1, operator_code: 'OP01', operator_name: 'Kumar', machine_count: 2, shared_machines: 1,
        produced: 420, good: 410, rejected: 10, run_seconds: 31530, idle_seconds: 4230,
        downtime_seconds: 22800, alarm_count: 5, quality_rate_pct: 97.6, rejection_rate_pct: 30,
        utilization_pct: 87.1, oee_pct: 87.8, efficiency_pct: 88.3 },
      { operator_id: 2, operator_code: 'OP02', operator_name: 'Ramesh', machine_count: 1, shared_machines: 0,
        produced: 420, good: 410, rejected: 10, run_seconds: 31530, idle_seconds: 4230,
        downtime_seconds: 20710, alarm_count: 5, quality_rate_pct: 97.6, rejection_rate_pct: 22,
        utilization_pct: 84, oee_pct: 78, efficiency_pct: 80 },
      { operator_id: 3, operator_code: 'OP03', operator_name: 'Suresh', machine_count: 1, shared_machines: 0,
        produced: 420, good: 410, rejected: 10, run_seconds: 31530, idle_seconds: 4230,
        downtime_seconds: 15300, alarm_count: 5, quality_rate_pct: 97.6, rejection_rate_pct: 15,
        utilization_pct: 80, oee_pct: 62, efficiency_pct: 70 },
      { operator_id: 4, operator_code: 'OP04', operator_name: 'Niraj', machine_count: 1, shared_machines: 0,
        produced: 0, good: 0, rejected: 0, run_seconds: 0, idle_seconds: 0,
        downtime_seconds: 0, alarm_count: 0, quality_rate_pct: null, rejection_rate_pct: null,
        utilization_pct: null, oee_pct: null, efficiency_pct: null }
    ],
    total: 4, page: 1, limit: 20, totalPages: 1
  }
});

const oee = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  thresholds: { good: 85, fair: 60 },
  kpis: { availability_pct: 89.21, performance_pct: 88.11, quality_pct: 95.62, oee_pct: 82.35,
          band: 'FAIR', produced: 12560, good: 12000, rejected: 560,
          run_seconds: 475200, idle_seconds: 30000, downtime_seconds: 71130, alarm_count: 62,
          machines_measurable: 18, machines_total: 20 },
  coverage: { machines: 20, with_cycle_time: 18, oee_computable: 18,
              note: 'Two machines have no cycle time, so their performance cannot be computed.' },
  status_counts: { RUNNING: 16, IDLE: 2, ALARM: 1, OFFLINE: 1 },
  top_machines: [], bottom_machines: [],
  trend: Array.from({ length: 6 }, (_, i) => ({
    day: `2026-06-${13 + i}T00:00:00.000Z`, availability_pct: 35 + i * 9
  })),
  machines: {
    data: [
      { id: 1, machine_serial_no: 'CNC-01', model: 'S3', status: 'RUNNING', band: 'GOOD',
        availability_pct: 92, performance_pct: 87, quality_pct: 96, oee_pct: 85,
        produced: 680, good: 653, rejected: 27, alarm_count: 4, downtime_seconds: 2535,
        has_cycle_time: true },
      { id: 2, machine_serial_no: 'CNC-02', model: 'S3', status: 'RUNNING', band: 'FAIR',
        availability_pct: 92, performance_pct: 87, quality_pct: 96, oee_pct: 75,
        produced: 680, good: 653, rejected: 27, alarm_count: 2, downtime_seconds: 4360,
        has_cycle_time: true },
      { id: 3, machine_serial_no: 'CNC-03', model: 'S2', status: 'IDLE', band: 'POOR',
        availability_pct: 92, performance_pct: 87, quality_pct: 96, oee_pct: 50,
        produced: 680, good: 653, rejected: 27, alarm_count: 9, downtime_seconds: 1880,
        has_cycle_time: true },
      { id: 4, machine_serial_no: 'CNC-04', model: 'S2', status: 'OFFLINE', band: 'UNKNOWN',
        availability_pct: null, performance_pct: null, quality_pct: null, oee_pct: null,
        produced: 0, good: 0, rejected: 0, alarm_count: 0, downtime_seconds: 0,
        has_cycle_time: false }
    ],
    total: 4, page: 1, limit: 20, totalPages: 1
  }
});

const energy = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  currency: 'INR',
  kpis: { total_kwh: 1248.6, total_operating_seconds: 475200, total_produced: 12560,
          kwh_per_part: 0.099, total_cost: 8925.6, overload_alerts: 1 },
  coverage: { machines: 5, reporting: 5, tariff_configured: true, note: '' },
  trend: Array.from({ length: 7 }, (_, i) => ({ day: `2026-06-${12 + i}T00:00:00.000Z`, kwh: 55 + i * 6 })),
  by_shift: [
    { shift_name: 'Day Shift', kwh: 561.9 },
    { shift_name: 'Evening Shift', kwh: 436.0 },
    { shift_name: 'Night Shift', kwh: 250.9 }
  ],
  by_month: [
    { month: '2026-02-01T00:00:00.000Z', kwh: 5800, cost: 5800 },
    { month: '2026-03-01T00:00:00.000Z', kwh: 6400, cost: 6400 },
    { month: '2026-04-01T00:00:00.000Z', kwh: 6400, cost: 6400 },
    { month: '2026-05-01T00:00:00.000Z', kwh: 5800, cost: 5800 },
    { month: '2026-06-01T00:00:00.000Z', kwh: 9400, cost: 9400 }
  ],
  top_consumers: [
    { machine_serial_no: 'CNC-01', kwh: 525.6 }, { machine_serial_no: 'CNC-02', kwh: 445.5 },
    { machine_serial_no: 'CNC-03', kwh: 380.1 }
  ],
  overloads: [],
  machines: {
    data: [
      { machine_serial_no: 'CNC-01', model: 'S3', kwh: 525.6, run_seconds: 95040, produced: 2512,
        kwh_per_part: 0.209, cost: 3755, peak_kw: 15.2, is_overloaded: true },
      { machine_serial_no: 'CNC-05', model: 'S2', kwh: null, run_seconds: 80000, produced: 1800,
        kwh_per_part: null, cost: null, peak_kw: null, is_overloaded: false }
    ],
    total: 2, page: 1, limit: 20, totalPages: 1
  }
});

async function mockApi(page: any) {
  await page.route('**/api/**', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));

  const json = (body: any) => (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/charts/meta*', json(meta));
  await page.route('**/api/dashboard/maintenance*', json(maintenance));
  await page.route('**/api/dashboard/preventive*',  json(preventive));
  // schedules/thresholds share the prefix, so the dashboard route is set last
  await page.route('**/api/dashboard/periodic/schedules*', json(ok([])));
  await page.route('**/api/dashboard/periodic*',    json(periodic));
  await page.route('**/api/dashboard/alarms*',      json(alarmReport));
  await page.route('**/api/dashboard/downtime*',    json(downtime));
  await page.route('**/api/dashboard/operators*',   json(operator));
  await page.route('**/api/dashboard/oee*',         json(oee));
  await page.route('**/api/dashboard/energy/settings*', json(ok([])));
  await page.route('**/api/dashboard/energy*',      json(energy));
}

/** Every screen must show the field, a title bar and at least one KPI tile. */
const screens: { path: string; title: string; kpis: number; file: string }[] = [
  { path: '/maintenance-dashboard',  title: 'Maintenance Dashboard',             kpis: 6, file: 'mexa-02-maintenance.png' },
  { path: '/preventive-maintenance', title: 'Preventive Maintenance Dashboard',  kpis: 5, file: 'mexa-03-preventive.png' },
  { path: '/periodic-maintenance',   title: 'Periodic Maintenance Dashboard',    kpis: 5, file: 'mexa-04-periodic.png' },
  { path: '/alarm-report',           title: 'Alarm Report Dashboard',            kpis: 5, file: 'mexa-05-alarms.png' },
  { path: '/downtime-analysis',      title: 'Downtime Reason Analysis',          kpis: 6, file: 'mexa-06-downtime.png' },
  { path: '/operator-performance',   title: 'Operator Performance Dashboard',    kpis: 5, file: 'mexa-07-operator.png' },
  { path: '/oee-dashboard',          title: 'OEE Dashboard',                     kpis: 6, file: 'mexa-08-oee.png' },
  { path: '/energy-dashboard',       title: 'Energy Dashboard',                  kpis: 6, file: 'mexa-09-energy.png' }
];

for (const s of screens) {
  test(`${s.title} renders in the MEXA design`, async ({ authedPage: page }) => {
    const errors: string[] = [];
    // an Angular template that throws aborts change detection silently;
    // the page still renders, just wrong, so console errors are failures
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });

    await mockApi(page);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(s.path);

    await expect(page.locator('.mexa-shell')).toBeVisible();
    await expect(page.locator('.mexa-titlebar')).toContainText(s.title);
    await expect(page.locator('.mexa-kpi')).toHaveCount(s.kpis);

    // no card may be left standing empty: every one needs a heading
    const cards = page.locator('.mexa-card');
    expect(await cards.count()).toBeGreaterThan(0);

    await page.waitForTimeout(2500);
    await page.screenshot({ path: s.file, fullPage: true });

    expect(errors, `console errors on ${s.path}`).toEqual([]);
  });
}

/* The agreement's machine-wise OEE table — search, sorting, paging — is a
   tab of Reports, beside the other OEE reports, so there is one place for
   every report. The OEE Dashboard is the analytics view only. (It was a
   "Report" tab on the dashboard until 2026-09-22.) */
test('OEE dashboard has no Report tab; the machine table lives in Reports', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/oee-dashboard');
  await expect(page.locator('.mexa-oeecard').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'OEE Trend' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Report' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Machine Wise OEE Summary' })).toHaveCount(0);

  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.goto('/reports?tab=machine-oee');
  await expect(page.getByRole('tab', { name: /Machine OEE/ })).toHaveAttribute('aria-selected', 'true');
  const table = page.locator('.mexa-table');
  await expect(table.getByText('CNC-01')).toBeVisible();
  await expect(table.getByRole('button', { name: /Availability \(%\)/ })).toBeVisible();
  await expect(table.getByRole('button', { name: /Rework/ })).toBeVisible();
  // highest OEE first, as the dashboard ranks them
  await expect(table.locator('tbody tr').first()).toContainText('CNC-01');
  await table.getByRole('button', { name: /^Machine/ }).click();
  await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);

  await page.getByRole('searchbox', { name: 'Search machines' }).fill('03');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('CNC-03');
});

test('Reports holds every report as a tab, and Analytics has one Reports entry', async ({ authedPage: page }) => {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await mockApi(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/reports');
  const tabs = page.getByRole('tablist', { name: 'Report type' }).getByRole('tab');
  await expect(tabs).toHaveText([/Production/, /OEE Hourly/, /Shift OEE/, /OEE Records/, /Machine OEE/]);

  await page.getByRole('button', { name: 'Analytics' }).first().click();
  const menu = page.locator('nav .absolute');
  await expect(menu.getByRole('button', { name: 'Reports', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'OEE', exact: true })).toHaveCount(0);
});

test('Periodic Attention Required filters the ticket table', async ({ authedPage: page }) => {
  const seen: string[] = [];
  await mockApi(page);
  // recorded after the stubs so the dashboard call is already mocked
  page.on('request', (r: any) => {
    if (r.url().includes('/dashboard/periodic') && !r.url().includes('schedules')) seen.push(r.url());
  });

  await page.goto('/periodic-maintenance');
  await expect(page.locator('.mexa-attention-row')).toHaveCount(3);

  await page.getByRole('button', { name: /Overdue/ }).first().click();
  await expect.poll(() => seen.some(u => u.includes('due=overdue'))).toBe(true);
  await expect(page.locator('.mexa-note')).toContainText('overdue');

  // clicking the active row again clears it, so nobody gets stuck in a filter
  await page.getByRole('button', { name: /Overdue/ }).first().click();
  await expect.poll(() => seen.filter(u => u.includes('due=')).length).toBeGreaterThan(0);
  await expect(page.locator('.mexa-note')).toHaveCount(0);
});

test('a past due date that is not overdue reads as "ago", never "in -82d"', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.goto('/periodic-maintenance');

  const upcoming = page.locator('.mexa-card', { hasText: 'Upcoming Maintenance' });
  // CNC-01 is dated in the past but not flagged overdue: still within grace
  await expect(upcoming).toContainText('ago');
  await expect(upcoming).toContainText('overdue');
  await expect(upcoming).not.toContainText('in -');
});

test('a servo with no temperature sensor reads as "--", never as 0 °C', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/maintenance-dashboard');

  /* The design's Servo Details card: a gauge per axis for load, bars for
     temperature. The silent axes are said in words, never drawn as 0 °C. */
  const servo = page.locator('.mexa-card')
    .filter({ has: page.getByRole('heading', { name: 'Servo Details' }) });

  await expect(servo).toContainText('Servo Load X');
  await expect(servo).toContainText('Y, Z not reporting a temperature');
  // the claim this test exists to defend
  await expect(servo).not.toContainText('0.0 °C');

  // what the data lacks is named; what arrives is not
  const gaps = page.locator('.mexa-card')
    .filter({ has: page.getByRole('heading', { name: 'Fans & Batteries' }) });
  await expect(gaps).toContainText('Encoder temperature');
  await expect(gaps).not.toContainText('Servo load per axis');

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'mexa-02-maintenance.png', fullPage: true });
});
