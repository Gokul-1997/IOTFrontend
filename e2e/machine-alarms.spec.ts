import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Machine Alarms (/alarms), 29 Oct 2026 — the user: "this page looks
 * unprofessional". Rows shaped like production's: the doubled
 * "Alarm type: X X" text, UNSPECIFIED, an alarm still on since two days.
 *
 *  - the text is said once, the Code column holds only the code;
 *  - Status says still on / cleared / resolved, Started says for how long;
 *  - All | Critical | Non-critical with counts narrows the list (severity=);
 *  - Resolve opens THE dialog and sends the note;
 *  - Create ticket opens the ticket form filled in from the alarm, with
 *    Priority and Assign to; the row then shows the ticket and its status
 *    and opens it in Maintenance; a ticket someone already raised is shown,
 *    not made twice (409 TICKET_EXISTS); the buttons follow the permissions;
 *  - the machine filter is the flat list with search.
 */

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const alarm = (o: any) => ({
  company_id: 4, alarm_type: 'ALARM', severity: 'NORMAL', is_resolved: false, ended_at: null,
  resolved_by_name: null, resolved_at: null, resolution_note: null, ticket_id: null, ...o
});
const ROWS = [
  alarm({ id: 101, machine_id: 25, machine_serial_no: 'HMC - 7 - F', alarm_code: 'EX1062',
    alarm_type: 'ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MO',
    message: 'Alarm type: ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE',
    started_at: ago(134) }),
  alarm({ id: 102, machine_id: 33, machine_serial_no: 'HMC - 15 - F', alarm_code: 'EX1072', severity: 'CRITICAL',
    alarm_type: 'RELEASE EMERGENCY', message: 'RELEASE EMERGENCY', started_at: ago(2 * 24 * 60 + 190) }),
  alarm({ id: 103, machine_id: 8, machine_serial_no: 'VMC - 8 - F', alarm_code: 'OT0500',
    alarm_type: '(Y)+ OVERTRAVEL ( SOFT 1 ) (axis 2)', message: '(Y)+ OVERTRAVEL ( SOFT 1 ) (axis 2)',
    started_at: ago(130), ended_at: ago(126), ticket_id: 77, ticket_status: 'IN_PROGRESS' }),
  alarm({ id: 104, machine_id: 8, machine_serial_no: 'VMC - 8 - F', alarm_code: null,
    alarm_type: 'UNSPECIFIED', message: 'UNSPECIFIED', started_at: ago(131) }),
  alarm({ id: 105, machine_id: 1, machine_serial_no: 'VMC - 1 - F', alarm_code: 'EX1201',
    alarm_type: 'S1 MAG,NEED REFERENCE', message: 'S1 MAG,NEED REFERENCE', started_at: ago(150) }),
  alarm({ id: 106, machine_id: 7, machine_serial_no: 'VMC - 7 - F', alarm_code: 'EX1070', severity: 'CRITICAL',
    alarm_type: 'M/C AT EMERGENCY CONDITION', message: 'M/C AT EMERGENCY CONDITION', started_at: ago(170), ended_at: ago(169) }),
  alarm({ id: 107, machine_id: 41, machine_serial_no: 'VMC - 4 - F', alarm_type: 'OFFLINE',
    message: 'Machine stopped sending data', started_at: ago(30) })
];
const SUMMARY = { total: 23, critical: 4, still_on: 15, machines: 9 };
const MACHINES = [1, 4, 7, 8].map(n => ({ id: n, machine_serial_no: `VMC - ${n} - F` }))
  .concat([{ id: 25, machine_serial_no: 'HMC - 7 - F' }, { id: 33, machine_serial_no: 'HMC - 15 - F' }]);

async function openPage(page: any, asked: URL[], rows = ROWS) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/charts/meta', json({ success: true, data: { machines: MACHINES, shifts: [] } }));
  await page.route(/\/api\/alarms(\?.*)?$/, (r: any) => {
    const url = new URL(r.request().url());
    asked.push(url);
    const sev = url.searchParams.get('severity');
    const list = sev === 'CRITICAL' ? rows.filter(a => a.severity === 'CRITICAL')
      : sev === 'NORMAL' ? rows.filter(a => a.severity !== 'CRITICAL') : rows;
    return json({ success: true, data: list, summary: SUMMARY, pagination: { page: 1, limit: 20, total: list.length, totalPages: 1 } })(r);
  });
  await page.goto('/alarms');
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(rows.length);
}

const row = (page: any, n: number) => page.locator('table.al-table tbody tr').nth(n);

test('each alarm said once, its code apart, how bad, and whether it is still on', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  const asked: URL[] = [];
  await openPage(page, asked);
  expect(asked[0].searchParams.get('is_resolved')).toBe('false');

  const first = row(page, 0);
  await expect(first.locator('td').nth(1)).toHaveText('ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE');
  await expect(first.locator('td').nth(2)).toHaveText('EX1062');
  await expect(first.locator('td').nth(3)).toHaveText(/Non-critical/);
  await expect(first.locator('td').nth(4)).toContainText('for 2 h 14 min');
  await expect(first.locator('td').nth(5)).toHaveText(/Still on/);

  await expect(row(page, 1).locator('td').nth(3)).toHaveText(/Critical/);
  await expect(row(page, 1).locator('td').nth(4)).toContainText('for 2 days 3 h');
  await expect(row(page, 2).locator('td').nth(4)).toContainText('lasted 4 min');
  await expect(row(page, 2).locator('td').nth(5)).toHaveText(/Cleared/);
  await expect(row(page, 2).getByRole('link', { name: 'Ticket 77, In progress, open in Maintenance' })).toHaveAttribute('href', '/maintenance?ticket_id=77');
  await expect(row(page, 2).getByRole('button', { name: 'Create ticket' })).toHaveCount(0);   // never a second one
  await expect(row(page, 3).locator('td').nth(1)).toHaveText('No description from the machine');
  await expect(row(page, 6).locator('td').nth(1)).toHaveText(/Machine stopped sending data\s*Offline/);

  // the stripe: red for critical, amber otherwise
  const stripe = (n: number) => row(page, n).locator('td').first().evaluate((td: HTMLElement) => getComputedStyle(td).boxShadow);
  expect(await stripe(1)).toContain('rgb(220, 38, 38)');
  expect(await stripe(0)).toContain('rgb(217, 119, 6)');

  // the counts, and the severity switch
  const seg = page.getByRole('group', { name: 'Severity' });
  await expect(seg.getByRole('button', { name: /All/ })).toHaveText(/All\s*23/);
  await expect(seg.getByRole('button', { name: /^Critical/ })).toHaveText(/Critical\s*4/);
  await expect(seg.getByRole('button', { name: /Non-critical/ })).toHaveText(/Non-critical\s*19/);
  await expect(page.locator('.al-facts')).toHaveText(/15\s*still on the machine\s*9\s*machines/);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/machine-alarms-1512.png' });

  await seg.getByRole('button', { name: /^Critical/ }).click();
  await expect(seg.getByRole('button', { name: /^Critical/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(2);
  expect(asked.at(-1)!.searchParams.get('severity')).toBe('CRITICAL');
  expect(asked.at(-1)!.searchParams.get('page')).toBe('1');

  // a machine, from the flat list with search
  await page.locator('#alarm-machine').click();
  await page.keyboard.type('hmc15');
  await page.keyboard.press('Enter');
  await expect.poll(() => asked.at(-1)!.searchParams.get('machine_id')).toBe('33');

  // dark theme
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await seg.getByRole('button', { name: /All/ }).click();
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(ROWS.length);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/machine-alarms-dark.png' });
});

test('Create ticket: the form filled in from the alarm, assigned, and the row shows the ticket', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked: URL[] = [];
  const tickets: any[] = [];
  await openPage(page, asked);
  // after the page's catch-all: the last route registered wins
  await page.route('**/api/tickets/assignees', json({ success: true, data: [{ id: 3, username: 'ravi' }, { id: 4, username: 'kumar' }] }));
  await page.route(/\/api\/tickets(\?.*)?$/, (r: any) => {
    if (r.request().method() !== 'POST') return json({ success: true, data: [] })(r);
    tickets.push(r.request().postDataJSON());
    return json({ success: true, data: { id: 501, status: 'ASSIGNED' } }, 201)(r);
  });

  const first = row(page, 0);
  await first.getByRole('button', { name: 'Create ticket' }).click();
  const form = page.getByRole('dialog', { name: 'Create maintenance ticket' });
  await expect(form).toContainText('From the alarm on HMC - 7 - F · EX1062');
  await expect(form.getByLabel('Title')).toHaveValue('ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE on HMC - 7 - F');
  await expect(form.getByLabel('Priority')).toHaveValue('MEDIUM');
  await expect(form.getByLabel('Description')).toHaveValue(/^Alarm: ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE\nCode: EX1062\nSeverity: Non-critical\nStarted: /);
  await form.getByLabel('Assign to').selectOption({ label: 'ravi' });
  await form.getByLabel('Priority').selectOption('HIGH');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/machine-alarms-ticket.png' });

  // a title is needed
  await form.getByLabel('Title').fill('  ');
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(form.getByText('Enter a title.')).toBeVisible();
  expect(tickets).toHaveLength(0);
  await form.getByLabel('Title').fill('ATC reset alarm on HMC - 7 - F');
  await form.getByRole('button', { name: 'Create ticket' }).click();

  await expect(form).toHaveCount(0);
  expect(tickets).toEqual([expect.objectContaining({
    alarm_id: 101, machine_id: 25, issue_type: 'ALARM', priority: 'HIGH', assigned_to: 3,
    title: 'ATC reset alarm on HMC - 7 - F'
  })]);
  await expect(first.getByRole('link', { name: 'Ticket 501, Assigned, open in Maintenance' })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Create ticket' })).toHaveCount(0);
  await expect(page.getByText('Ticket #501 raised')).toBeVisible();
});

test('a ticket someone already raised is shown, not made twice', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, []);
  await page.route(/\/api\/tickets(\?.*)?$/, json({ status: 'error', code: 'TICKET_EXISTS',
    message: 'Ticket #41 is already open for this alarm', ticket_id: 41, ticket_status: 'IN_PROGRESS' }, 409));
  await row(page, 1).getByRole('button', { name: 'Create ticket' }).click();
  const form = page.getByRole('dialog', { name: 'Create maintenance ticket' });
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(form).toHaveCount(0);
  await expect(row(page, 1).getByRole('link', { name: 'Ticket 41, In progress, open in Maintenance' })).toBeVisible();
  await expect(page.getByText('Ticket #41 is already open for this alarm')).toBeVisible();
});

test('a ticket that could not be raised says why in the form and keeps what was typed', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, []);
  await page.route(/\/api\/tickets(\?.*)?$/, json({ status: 'error', message: 'Machine not found in your plant' }, 404));
  await row(page, 0).getByRole('button', { name: 'Create ticket' }).click();
  const form = page.getByRole('dialog', { name: 'Create maintenance ticket' });
  await form.getByLabel('Title').fill('Kept');
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(form.getByRole('alert')).toHaveText('Machine not found in your plant');
  await expect(form.getByLabel('Title')).toHaveValue('Kept');
});

test('the buttons follow the permissions: Resolve is page:alarms:resolve, a ticket is page:maintenance:create', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const as = (permissions: string[]) => seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user', permissions, company_permissions: [] });
  await as(['page:alarms:view', 'page:alarms:resolve']);
  await openPage(page, []);
  await expect(row(page, 0).getByRole('button', { name: 'Resolve' })).toBeVisible();
  await expect(row(page, 0).getByRole('button', { name: 'Create ticket' })).toHaveCount(0);
  await expect(row(page, 2)).toContainText('#77 · In progress');
  await expect(row(page, 2).getByRole('link')).toHaveCount(0);          // cannot open Maintenance: the number, not a link

  await page.evaluate(() => localStorage.clear());
  await as(['page:alarms:view', 'page:maintenance:view', 'page:maintenance:create']);
  await page.reload();
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(ROWS.length);
  await expect(row(page, 0).getByRole('button', { name: 'Create ticket' })).toBeVisible();
  await expect(row(page, 0).getByRole('button', { name: 'Resolve' })).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await as(['page:alarms:view']);
  await page.reload();
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(ROWS.length);
  await expect(page.locator('table.al-table thead th')).toHaveCount(6);   // nothing to do: no Action column
});

test('Resolve opens the dialog, sends the note and reloads', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked: URL[] = [];
  const resolved: any[] = [];
  await openPage(page, asked);
  await page.route(/\/api\/alarms\/\d+\/resolve$/, (r: any) => {
    resolved.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return json({ success: true, data: {} })(r);
  });

  const first = row(page, 0);
  await first.getByRole('button', { name: 'Resolve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve alarm' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('HMC - 7 - F · EX1062');
  await expect(dialog).toContainText('ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE');
  await dialog.getByLabel(/What was done/).fill('Reset the ATC and referenced the magazine');
  const loads = asked.length;
  await dialog.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(dialog).toHaveCount(0);
  expect(resolved).toEqual([{ url: expect.stringMatching(/\/api\/alarms\/101\/resolve$/),
    body: { resolution_note: 'Reset the ATC and referenced the magazine' } }]);
  await expect.poll(() => asked.length).toBeGreaterThan(loads);
});

test('a failed resolve says why in the dialog and keeps it open', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, []);
  await page.route(/\/api\/alarms\/\d+\/resolve$/, json({ success: false, message: 'Alarm not found' }, 404));
  await row(page, 1).getByRole('button', { name: 'Resolve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve alarm' });
  await dialog.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Alarm not found');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the Resolved list: who resolved it and the note, and no actions', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const done = [alarm({ id: 201, machine_id: 1, machine_serial_no: 'VMC - 1 - F', alarm_code: 'EX1005',
    message: 'ATC 1 MAGAZINE NOT REFERENCED', started_at: ago(400), ended_at: ago(390),
    is_resolved: true, resolved_by_name: 'ravi', resolved_at: ago(380), resolution_note: 'Referenced the magazine' })];
  await openPage(page, [], ROWS);
  await page.route(/\/api\/alarms(\?.*)?$/, json({ success: true, data: done, summary: { total: 1, critical: 0, still_on: 0, machines: 1 },
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }));
  await page.locator('#alarm-status').selectOption({ label: 'Resolved' });
  await expect(page.locator('table.al-table tbody tr')).toHaveCount(1);
  const status = row(page, 0).locator('td').nth(5);
  await expect(status).toContainText('Resolved');
  await expect(status).toContainText('by ravi');
  await expect(status).toContainText('“Referenced the magazine”');
  await expect(page.locator('table.al-table thead th')).toHaveCount(6);       // no Action column
  await expect(page.locator('.al-facts')).not.toContainText('still on');
});

test('nothing open: a clear sentence, not an empty table', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route(/\/api\/alarms(\?.*)?$/, json({ success: true, data: [], summary: { total: 0, critical: 0, still_on: 0, machines: 0 },
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
  await page.goto('/alarms');
  await expect(page.getByText('No active alarms')).toBeVisible();
  await expect(page.getByText('Every machine is clear.')).toBeVisible();
});

test('on a phone: machine, alarm, when and actions; severity still shows as the stripe', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, []);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/machine-alarms-390.png', fullPage: false });
});
