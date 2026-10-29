import { test, expect } from './fixtures/auth';

/*
 * The MEXA table header on every table (29 Oct 2026, the user: "this table
 * design and features — header filter and sorting — on all pages", pointing
 * at Ant Design's table; then "no search inside the table"):
 *  - a sortable header is one button: ascending, descending, then the
 *    table's own order; aria-sort says which, and the column is tinted;
 *  - a funnel opens the column's values to tick, and the table follows at
 *    once — asked of the API for a paged table (?sort=&dir=&f_<col>=);
 *  - no search box inside any table.
 * Checked on a paged table (Maintenance → Tickets), a list kept in the page
 * (Maintenance → Schedules) and a Material table (Machines).
 */

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const TICKETS = [
  { id: 41, machine_serial_no: 'VMC - 10 - M', title: 'Spindle noise', issue_type: 'BREAKDOWN', priority: 'HIGH', status: 'OPEN', assigned_to_name: null, created_at: '2026-10-29T05:00:00Z' },
  { id: 42, machine_serial_no: 'VMC - 2 - F', title: 'Coolant leak', issue_type: 'ALARM', priority: 'CRITICAL', status: 'ASSIGNED', assigned_to_name: 'ravi', created_at: '2026-10-28T05:00:00Z' },
  { id: 43, machine_serial_no: 'HMC - 1', title: 'ATC reset', issue_type: 'ALARM', priority: 'LOW', status: 'IN_PROGRESS', assigned_to_name: 'kumar', created_at: '2026-10-27T05:00:00Z' }
];
const SCHEDULES = [
  { id: 1, machine_serial_no: 'VMC - 10 - M', title: 'Way lube', maintenance_type: 'PREVENTIVE', scheduled_at: '2026-11-02T04:30:00Z', assigned_to: 'ravi', status: 'SCHEDULED' },
  { id: 2, machine_serial_no: 'VMC - 2 - F', title: 'Filter change', maintenance_type: 'CORRECTIVE', scheduled_at: '2026-10-30T04:30:00Z', assigned_to: null, status: 'IN_PROGRESS' },
  { id: 3, machine_serial_no: 'HMC - 1', title: 'Belt check', maintenance_type: 'PREVENTIVE', scheduled_at: '2026-11-05T04:30:00Z', assigned_to: 'kumar', status: 'SCHEDULED' }
];

async function maintenance(page: any, asked: URL[]) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/master/machines**', json({ success: true, data: [
    { id: 1, machine_serial_no: 'VMC - 2 - F' }, { id: 2, machine_serial_no: 'VMC - 10 - M' }, { id: 3, machine_serial_no: 'HMC - 1' }] }));
  await page.route('**/api/tickets/assignees', json({ success: true, data: [{ id: 3, username: 'ravi' }, { id: 4, username: 'kumar' }] }));
  await page.route(/\/api\/tickets(\?.*)?$/, (r: any) => {
    asked.push(new URL(r.request().url()));
    return json({ success: true, data: TICKETS, pagination: { page: 1, limit: 20, total: 3, totalPages: 1 } })(r);
  });
  await page.route(/\/api\/maintenance\/schedules(\?.*)?$/, json({ success: true, data: SCHEDULES }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/maintenance');
  await expect(page.locator('table.mexa-table tbody tr')).toHaveCount(3);
}

test('a paged table: the header asks the API to sort and filter', async ({ authedPage: page }) => {
  const asked: URL[] = [];
  await maintenance(page, asked);
  const table = page.getByRole('region', { name: 'Tickets' }).locator('table');
  const priority = table.locator('thead th').nth(3);

  // sort: ascending, descending, then the table's own order
  await table.getByRole('button', { name: 'Priority', exact: true }).click();
  await expect(priority).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => asked.at(-1)!.searchParams.get('sort')).toBe('priority');
  expect(asked.at(-1)!.searchParams.get('dir')).toBe('asc');
  await expect(table).toHaveAttribute('data-sorted-col', '4');
  await table.getByRole('button', { name: 'Priority', exact: true }).click();
  await expect(priority).toHaveAttribute('aria-sort', 'descending');
  await table.getByRole('button', { name: 'Priority', exact: true }).click();
  await expect(priority).toHaveAttribute('aria-sort', 'none');
  await expect.poll(() => asked.at(-1)!.searchParams.has('sort')).toBe(false);

  // filter: tick values; the API is asked once the ticking pauses
  await table.getByRole('button', { name: 'Filter Status' }).click();
  const panel = page.getByRole('dialog', { name: 'Filter Status' });
  await expect(panel.getByRole('checkbox')).toHaveCount(3);            // Open shows open tickets only
  await expect(panel.getByRole('checkbox').first()).toBeFocused();
  await panel.getByLabel('Open').check();
  await panel.getByLabel('Assigned').check();
  await expect.poll(() => asked.at(-1)!.searchParams.get('f_status')).toBe('OPEN,ASSIGNED');
  await expect(panel).toContainText('2 selected');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/table-header-filter.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Filter Status (on)' })).toBeFocused();

  // no search box anywhere in the table or its panels
  await expect(page.locator('table input[type=search], .mt-panel input[type=search]')).toHaveCount(0);
});

test('a list kept in the page sorts and filters right there, with no request', async ({ authedPage: page }) => {
  const asked: URL[] = [];
  await maintenance(page, asked);
  await page.getByRole('tab', { name: 'Schedules' }).click();
  const table = page.getByRole('region', { name: 'Schedules' }).locator('table');
  const machines = () => table.locator('tbody tr td:first-child').allTextContents();
  await expect(table.locator('tbody tr')).toHaveCount(3);

  await table.getByRole('button', { name: 'Machine', exact: true }).click();
  expect((await machines()).map(t => t.trim())).toEqual(['HMC - 1', 'VMC - 2 - F', 'VMC - 10 - M']);   // 2 before 10
  await table.getByRole('button', { name: 'Machine', exact: true }).click();
  expect((await machines()).map(t => t.trim())).toEqual(['VMC - 10 - M', 'VMC - 2 - F', 'HMC - 1']);

  await table.getByRole('button', { name: 'Filter Type' }).click();
  const panel = page.getByRole('dialog', { name: 'Filter Type' });
  await expect(panel.locator('.mt-option')).toHaveText([/Corrective\s*1/, /Preventive\s*2/]);
  await panel.getByLabel('Preventive').check();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await page.keyboard.press('Escape');

  // nothing left: a sentence and a way back, not an empty table
  await table.getByRole('button', { name: 'Filter Assigned to' }).click();
  await page.getByRole('dialog', { name: 'Filter Assigned to' }).getByLabel('(Blank)').check();
  await page.getByRole('dialog', { name: 'Filter Assigned to' }).getByLabel('ravi').check();
  await page.keyboard.press('Escape');
  await table.getByRole('button', { name: 'Filter Status' }).click();
  await page.getByRole('dialog', { name: 'Filter Status' }).getByLabel('Scheduled').check();
  await page.keyboard.press('Escape');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('Way lube');
  expect(asked.every(u => !u.pathname.includes('schedules'))).toBe(true);

  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/table-header-dark.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
});

test('a Material table (Machines) has the same header; the old sort arrows are gone', async ({ authedPage: page }) => {
  const asked: URL[] = [];
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/machines**', (r: any) => {
    asked.push(new URL(r.request().url()));
    return json({ success: true, data: [
      { id: 1, machine_serial_no: 'VMC - 1 - F', model: 'VMC 850', controller: 'FANUC 0i-MF', name: 'Line 1', is_active: true },
      { id: 2, machine_serial_no: 'VMC - 2 - F', model: 'VMC 1050', controller: 'Mitsubishi M80', name: 'Line 1', is_active: false }],
      total: 2 })(r);
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/machines');
  await expect(page.getByText('VMC - 1 - F').first()).toBeVisible();
  await expect(page.locator('.mat-sort-header-container')).toHaveCount(0);
  const table = page.locator('table.machines-table');
  await table.getByRole('button', { name: 'Machine No', exact: true }).click();
  await expect.poll(() => asked.at(-1)!.searchParams.get('sort')).toBe('machine');
  await table.getByRole('button', { name: 'Filter Status' }).click();
  await page.getByRole('dialog', { name: 'Filter Status' }).getByLabel('Inactive').check();
  await expect.poll(() => asked.at(-1)!.searchParams.get('f_status')).toBe('false');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/table-header-machines.png', clip: { x: 0, y: 0, width: 1600, height: 420 } });
});
