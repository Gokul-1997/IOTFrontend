import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Factory Overall: every tile and card opens the page with the records
 * behind it, on the Factory's own day, shift and machine (21 Oct 2026 —
 * "redirect possible, other screens almost done"). The pages take the
 * filters from the address once and drop them, so their own filters are in
 * charge afterwards. A page the person may not open is not offered.
 */
const meta = { success: true, data: {
  machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }, { id: 2, machine_serial_no: 'VMC-2-F' }],
  shifts: [{ id: 10, shift_code: 'MS01', shift_name: 'Morning' }]
} };
const factory = { status: 'success', data: {
  filters: { date: '2026-10-21', shift_id: null, shift_code: null, machine_id: null },
  updated_at: '2026-10-21T09:30:00.000Z',
  machines: { total: 12, running: 8, idle: 3, breakdown: 1, offline: 0 },
  production: { produced: 420, actual: 380, target: 600, target_pct: 63.3, machines_with_target: 6 },
  time: { run_seconds: 29520, idle_seconds: 7200, down_seconds: 3600 },
  oee: { availability: 82, performance: 76, quality: 98, oee: 61, target: 85 },
  energy: { kwh: 148.25, month_kwh: 3120.5, currency: 'INR', rate_per_kwh: 8, cost_day: 1186, cost_month: 24964 },
  shiftwise: [{ shift_id: 10, shift_code: 'MS01', start_time: '06:00:00', end_time: '14:00:00', produced: 220, actual: 200, target: 300 }],
  downtime: { total_seconds: 3600, planned_seconds: 1200, unplanned_seconds: 2400,
              by_reason: [{ reason: 'Breakdown', category: 'UNPLANNED', seconds: 2400, events: 2 }] },
  alarms: { total: 9, critical: 2, non_critical: 4, information: 3, open: 5 },
  trend: [{ hour: '2026-10-21T02:00:00.000Z', kwh: 12.5, produced: 40, target: 37 }]
} };

async function mock(page: any) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/factory*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factory) }));
  const seen: URL[] = [];
  page.on('request', (r: any) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) seen.push(u); });
  return (path: string) => seen.filter(u => u.pathname === path).at(-1);
}

/** The Factory on a day, a shift and a machine. */
async function openFactory(page: any) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/factory');
  await expect(page.getByRole('heading', { name: 'Overall Factory Dashboard' })).toBeVisible();
  await page.locator('#fShift').selectOption({ label: 'Morning' });
  await page.locator('#fMachine').selectOption({ label: 'VMC-2-F' });
  return page.locator('#fDate').inputValue();
}

test('Overall OEE opens the OEE Dashboard on the same day, shift and machine', async ({ authedPage: page }) => {
  const last = await mock(page);
  const day = await openFactory(page);
  await page.getByRole('button', { name: /^Overall OEE: .* open the OEE Dashboard for this day$/ }).click();
  await expect(page).toHaveURL(/\/oee-dashboard$/);                  // taken, then dropped from the address
  await expect.poll(() => last('/api/dashboard/oee')?.search ?? '').toContain('from=');
  const q = last('/api/dashboard/oee')!.searchParams;
  expect([q.get('from'), q.get('to'), q.get('shift_id'), q.get('machine_id')]).toEqual([day, day, '10', '2']);
});

test('Machines Running / Idle open the Live Dashboard on that status', async ({ authedPage: page }) => {
  const last = await mock(page);
  await openFactory(page);
  await page.getByRole('button', { name: /^Machines idle: 3 show them on the Live Dashboard$/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => last('/api/dashboard')?.searchParams.get('status')).toBe('idle');
});

test('Power Consumption opens the Energy Dashboard — day and machine (it has no shift)', async ({ authedPage: page }) => {
  const last = await mock(page);
  const day = await openFactory(page);
  await page.getByRole('button', { name: /^Power consumption: .* open the Energy Dashboard for this day$/ }).click();
  await expect(page).toHaveURL(/\/energy-dashboard$/);
  await expect.poll(() => last('/api/dashboard/energy')?.search ?? '').toContain('from=');
  const q = last('/api/dashboard/energy')!.searchParams;
  expect([q.get('from'), q.get('to'), q.get('machine_id'), q.get('shift_id')]).toEqual([day, day, '2', null]);
});

test('Overall Production opens the Production report on the same day, shift and machine', async ({ authedPage: page }) => {
  const last = await mock(page);
  const day = await openFactory(page);
  await page.getByRole('button', { name: /^Overall production: 63.3% open the Production report for this day$/ }).click();
  await expect(page).toHaveURL(/\/reports\?tab=production$/);
  await expect.poll(() => last('/api/reports/production-data')?.search ?? '').toContain('date_from=');
  const q = last('/api/reports/production-data')!.searchParams;
  expect([q.get('date_from'), q.get('date_to'), q.get('shift_id'), q.get('machine_id')]).toEqual([day, day, '10', '2']);
});

test('the cards open their pages too; Critical alarms opens the Alarm Report on the critical ones', async ({ authedPage: page }) => {
  const last = await mock(page);
  const day = await openFactory(page);
  for (const [card, link, href] of [
    ['Overall OEE', 'OEE Dashboard', '/oee-dashboard'], ['Runtime vs Idle Time', 'Downtime Analysis', '/downtime-analysis'],
    ['Energy Cost Analysis', 'Energy Dashboard', '/energy-dashboard'], ['Downtime Reasons', 'Downtime Analysis', '/downtime-analysis'],
    ['Production Trend', 'Production report', '/reports'], ['Alarm Summary', 'Alarm Report', '/alarm-report']
  ]) {
    const a = page.locator('section.mexa-card', { has: page.getByRole('heading', { name: card, exact: true }) }).getByRole('link', { name: link });
    await expect(a).toHaveAttribute('href', new RegExp(`^${href}\\?`));
  }
  await page.getByRole('link', { name: 'Critical alarms', exact: true }).click();
  await expect(page).toHaveURL(/\/alarm-report/);
  await expect.poll(() => last('/api/dashboard/alarms')?.searchParams.get('show')).toBe('critical');
  const q = last('/api/dashboard/alarms')!.searchParams;
  expect([q.get('from'), q.get('to'), q.get('machine_id')]).toEqual([day, day, '2']);
});

test('a page this role cannot open is not offered: the tile stays a plain figure', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user',
                         permissions: ['page:analytics-factory:view', 'page:analytics-energy:view'] });
  await mock(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/factory');
  await expect(page.getByRole('button', { name: /open the Energy Dashboard/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /OEE Dashboard|Live Dashboard|Production report|Downtime Analysis/ })).toHaveCount(0);
  await expect(page.locator('.mexa-kpi', { hasText: 'Overall' }).first()).toContainText('61%');
  await expect(page.getByRole('link', { name: 'Alarm Report' })).toHaveCount(0);
});
