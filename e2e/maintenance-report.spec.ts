import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Maintenance Report — the agreement's "generate and export maintenance
 * reports in Excel, CSV and PDF".
 *
 * What is worth testing here is not that the numbers render, but that the
 * page never overstates what it knows: MTTR is a claim about resolved
 * tickets only and says how many it averaged, a ticket with no minutes
 * entered is declared rather than dropped, and an open ticket shows a dash
 * where a repair time would go instead of a zero that reads as instant.
 */

const ok = (data: any) => ({ status: 'success', data });

const ticket = (over: any = {}) => ({
  id: 1, machine_serial_no: 'VMC-1', title: 'Spindle noise', issue_type: 'BREAKDOWN',
  priority: 'HIGH', status: 'CLOSED', created_at: '2026-08-06T09:00:00.000Z',
  resolved_at: '2026-08-06T13:15:00.000Z', repair_hours: 4.25, downtime_minutes: 255,
  assigned_to_name: 'ravi', parts_used: 'bearing', ...over
});

const report = (over: any = {}) => ok({
  filters: { from: '2026-08-01', to: '2026-08-31', machine_id: null },
  updated_at: '2026-08-31T10:30:00.000Z',
  kpis: {
    tickets: 12, settled: 9, open: 3, breakdowns: 7, critical: 2,
    downtime_minutes: 540, downtime_unrecorded: 2, mttr_hours: 4.25, mttr_basis: 9,
    mttr_basis_note: 'Mean of 9 resolved tickets',
    downtime_note: '2 tickets recorded no downtime',
    ...(over.kpis || {})
  },
  by_machine: over.by_machine || [
    { machine_serial_no: 'VMC-1', tickets: 7, breakdowns: 5, downtime_minutes: 400, mttr_hours: 4.9 },
    { machine_serial_no: 'VMC-2', tickets: 5, breakdowns: 2, downtime_minutes: 140, mttr_hours: 2.1 }
  ],
  by_type:   over.by_type   || { BREAKDOWN: 7, ALARM: 3, INSPECTION: 2, OTHER: 0 },
  by_status: over.by_status || { OPEN: 3, ASSIGNED: 0, IN_PROGRESS: 0, RESOLVED: 4, CLOSED: 5 },
  trend: over.trend || Array.from({ length: 5 }, (_, i) => ({
    day: `2026-08-0${i + 1}T00:00:00.000Z`, raised: 2 + i, resolved: 1 + i })),
  tickets: { data: over.tickets || [ticket()], total: 12, page: 1, limit: 20, totalPages: 1 }
});

const GRANTS = ['page:maintenance-report:view', 'page:maintenance-report:export'];

/* The catch-all goes on FIRST: Playwright gives the last matching route
   priority, so registering it last would shadow every specific mock. */
async function mockApi(page: any, body: any = report()) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { machines: [{ id: 1, machine_serial_no: 'VMC-1' }], shifts: [] } }) }));
  await page.route('**/api/dashboard/maintenance-report*', (r: any) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function open(page: any, grants = GRANTS, body?: any) {
  await seedAuth(page, {
    roles: ['MAINTENANCE'], user_type: 'MAINTENANCE',
    permissions: GRANTS, company_permissions: grants
  });
  await mockApi(page, body);
  await page.setViewportSize({ width: 1500, height: 1200 });
  await page.goto('/maintenance-report');
}

test('the report opens with its KPIs, charts and tables', async ({ page }) => {
  await open(page);

  await expect(page.getByRole('heading', { name: 'Maintenance Report' })).toBeVisible();
  await expect(page.locator('.mexa-kpi', { hasText: 'Total' }).getByText('12')).toBeVisible();
  await expect(page.locator('.mexa-kpi', { hasText: 'Mean Time' }).getByText('4.25h')).toBeVisible();
  await expect(page.getByText('Tickets Raised vs Resolved')).toBeVisible();
  await expect(page.getByText('Machine Summary')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'VMC-1' }).first()).toBeVisible();
  // Apex animates on first draw; capture the settled frame, not a half-drawn one
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'mexa-maintenance-report.png', fullPage: true });
});

test('MTTR says how many tickets it averaged, so the figure can be judged', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Mean of 9 resolved tickets')).toBeVisible();
});

test('with nothing resolved, MTTR is a dash and says so — not 0h', async ({ page }) => {
  await open(page, GRANTS, report({ kpis: {
    mttr_hours: null, mttr_basis: 0,
    mttr_basis_note: 'No ticket has been resolved in this period' } }));

  await expect(page.locator('.mexa-kpi', { hasText: 'Mean Time' }).getByText('--')).toBeVisible();
  await expect(page.getByText('No ticket has been resolved in this period')).toBeVisible();
});

test('tickets with no downtime entered are declared, not quietly dropped', async ({ page }) => {
  await open(page);
  await expect(page.getByText('2 tickets recorded no downtime')).toBeVisible();
});

test('an open ticket shows a dash for repair time, never a zero', async ({ page }) => {
  await open(page, GRANTS, report({
    tickets: [ticket({ status: 'OPEN', resolved_at: null, repair_hours: null,
                       downtime_minutes: null, assigned_to_name: null })]
  }));

  const row = page.locator('tbody tr', { hasText: 'Spindle noise' });
  await expect(row.getByText('--').first()).toBeVisible();
  await expect(row.getByText('Unassigned')).toBeVisible();
  await expect(row.getByText('Open')).toBeVisible();
});

test('export is its own grant — view alone hides the buttons', async ({ page }) => {
  await open(page, ['page:maintenance-report:view']);
  await expect(page.getByRole('heading', { name: 'Maintenance Report' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Export the filtered list' })).toHaveCount(0);
});

test('with the export grant, all three formats are offered', async ({ page }) => {
  await open(page);
  const group = page.getByRole('group', { name: 'Export the filtered list' });
  await expect(group.getByRole('button', { name: 'Excel' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'CSV' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'PDF' })).toBeVisible();
});

test('a company without the page cannot reach it by URL', async ({ page }) => {
  await seedAuth(page, {
    roles: ['MAINTENANCE'], user_type: 'MAINTENANCE',
    permissions: GRANTS,
    company_permissions: ['page:analytics-maintenance:view']
  });
  await mockApi(page);
  await page.goto('/maintenance-report');
  await expect(page).toHaveURL(/\/no-access/);
});

test('the empty period reads as empty, not as broken', async ({ page }) => {
  await open(page, GRANTS, report({
    kpis: { tickets: 0, settled: 0, open: 0, breakdowns: 0, critical: 0,
            downtime_minutes: 0, downtime_unrecorded: 0, mttr_hours: null, mttr_basis: 0,
            mttr_basis_note: 'No ticket has been resolved in this period', downtime_note: null },
    by_machine: [], by_type: { BREAKDOWN: 0, ALARM: 0, INSPECTION: 0, OTHER: 0 }, trend: [], tickets: []
  }));

  await expect(page.getByText('No machine has a ticket in this period.')).toBeVisible();
  await expect(page.getByText('No maintenance tickets match these filters.')).toBeVisible();
});
