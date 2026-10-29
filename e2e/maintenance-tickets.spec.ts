import { test, expect } from './fixtures/auth';

/*
 * Maintenance → Tickets, for tickets raised from alarms (29 Oct 2026, the
 * user: "the ticket flow is not working properly"):
 *  - Open lists every open ticket, asked of the API (open=true) and paged;
 *    it asked for the newest 20 of any status and hid the finished ones,
 *    so older open tickets never showed;
 *  - /maintenance?ticket_id= (the link on Machine Alarms) opens that ticket;
 *  - the alarm it came from is said once, with a link back to it;
 *  - resolving it says the alarm is resolved too (the API does that);
 *  - a refused status change says why instead of nothing.
 */

const json = (body: unknown, status = 200) =>
  (r: any) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const TICKET = {
  id: 501, machine_id: 25, machine_serial_no: 'HMC - 7 - F', alarm_id: 101, title: 'ATC reset alarm on HMC - 7 - F',
  description: 'Alarm: ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE\nCode: EX1062', issue_type: 'ALARM',
  priority: 'HIGH', status: 'ASSIGNED', assigned_to: 3, assigned_to_name: 'ravi', created_at: '2026-10-29T07:00:00Z',
  alarm_type: 'ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MO', alarm_severity: 'NORMAL', alarm_code: 'EX1062',
  alarm_message: 'Alarm type: ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE',
  alarm_started_at: '2026-10-29T06:46:00Z', alarm_is_resolved: false,
  history: [{ from_status: null, to_status: 'ASSIGNED', created_at: '2026-10-29T07:00:00Z', changed_by_name: 'admin' }]
};

async function openMaintenance(page: any, path: string, lists: URL[], statusReply = json({ success: true, data: { id: 501, status: 'RESOLVED' } })) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
  await page.route('**/api/tickets/assignees', json({ success: true, data: [{ id: 3, username: 'ravi' }] }));
  await page.route(/\/api\/tickets(\?.*)?$/, (r: any) => {
    lists.push(new URL(r.request().url()));
    return json({ success: true, data: [TICKET], pagination: { page: 1, limit: 20, total: 45, totalPages: 3 } })(r);
  });
  await page.route(/\/api\/tickets\/501$/, json({ success: true, data: TICKET }));
  await page.route(/\/api\/tickets\/501\/status$/, statusReply);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
}

test('Open asks the API for open tickets, paged; All asks for all', async ({ authedPage: page }) => {
  const lists: URL[] = [];
  await openMaintenance(page, '/maintenance', lists);
  await expect(page.getByRole('button', { name: '#501 ATC reset alarm on HMC - 7 - F' })).toBeVisible();
  expect(lists[0].searchParams.get('open')).toBe('true');
  expect(lists[0].searchParams.get('limit')).toBe('20');
  await expect(page.locator('app-mexa-pager')).toBeVisible();             // 45 open tickets: more than a page
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect.poll(() => lists.at(-1)!.searchParams.has('open')).toBe(false);
});

test('a link from Machine Alarms opens the ticket; its alarm is said once, with a way back', async ({ authedPage: page }) => {
  await openMaintenance(page, '/maintenance?ticket_id=501', []);
  const detail = page.getByRole('dialog', { name: 'ATC reset alarm on HMC - 7 - F' });
  await expect(detail).toBeVisible();
  await expect(page).not.toHaveURL(/ticket_id/);                          // taken once, so a reload does not reopen it
  await expect(detail.locator('.mt-alarm-text')).toHaveText('ATC INTERRUPTED RESET THE ALARM CALL M80 IN MDI MODE');
  await expect(detail.locator('.mt-alarm')).toContainText('Non-critical');
  await expect(detail.locator('.mt-alarm')).toContainText('EX1062');
  await expect(detail.locator('.mt-alarm')).toContainText('Alarm open');
  await expect(detail.getByRole('link', { name: 'View alarm' })).toHaveAttribute('href', '/alarms?alarm_id=101');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/maintenance-ticket-from-alarm.png' });

  await detail.getByRole('button', { name: 'Resolved' }).click();
  await expect(page.getByText('Ticket resolved; its alarm is resolved too')).toBeVisible();
});

test('a refused status change says why', async ({ authedPage: page }) => {
  await openMaintenance(page, '/maintenance?ticket_id=501', [], json({ status: 'error', message: 'You do not have permission to do this' }, 403));
  const detail = page.getByRole('dialog', { name: 'ATC reset alarm on HMC - 7 - F' });
  await detail.getByRole('button', { name: 'In progress' }).click();
  await expect(page.getByText('You do not have permission to do this')).toBeVisible();
});
