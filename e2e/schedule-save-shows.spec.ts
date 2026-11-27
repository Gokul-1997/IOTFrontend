import { test, expect, localFixtureOrigin } from './fixtures/auth';

/*
 * Schedule Dashboard → Create Ticket → Save schedule (27 Nov 2026, the user:
 * "ticket created but not showing in Upcoming, and Schedule not showing —
 * check this flow fully"). After saving: the plan lists the schedule, the
 * toast says a ticket was raised when one was due, Upcoming Maintenance shows
 * the next occurrence (the API now lists occurrences not yet raised), and
 * Schedule Tickets shows the raised ticket.
 */
const now = new Date();
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data }) });

test('a saved schedule shows in the plan, in Upcoming and as a ticket', async ({ authedPage: page }) => {
  let saved = false;
  let posted: any = null;
  const origin = localFixtureOrigin();
  await page.route('**/*', (r: any) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(ok({ machines: [{ id: 7, machine_serial_no: 'VMC - 7' }], shifts: [] })));
  await page.route(/\/api\/dashboard\/periodic\/schedules/, async (r: any) => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON(); saved = true;
      return r.fulfill(ok({ id: 11, ...posted, raised: 1 }));
    }
    return r.fulfill(ok(saved ? [{ id: 11, machine_id: 7, machine_serial_no: 'VMC - 7', title: 'Way lube', frequency: 'WEEKLY',
      next_due_at: inDays(7), grace_days: 0, assigned_to_name: null, is_active: true }] : []));
  });
  await page.route(/\/api\/dashboard\/periodic(\?|$)/, (r: any) => r.fulfill(ok({
    updated_at: now.toISOString(), filters: {},
    kpis: { scheduled: saved ? 1 : 0, due_today: saved ? 1 : 0, due_this_week: 0, overdue: 0, completed: 0, compliance_pct: null, compliance_basis: { on_time: 0, judged: 0 } },
    technician_workload: [], compliance_trend: [], by_frequency: [],
    // after saving: the ticket raised for today, and the next occurrence a week on (not raised yet)
    upcoming: saved ? [
      { id: 99, ticket_id: 99, schedule_id: 11, machine_serial_no: 'VMC - 7', title: 'Way lube', frequency: 'WEEKLY', due_date: now.toISOString(), assigned_to_name: null, is_overdue: false },
      { id: null, ticket_id: null, schedule_id: 11, machine_serial_no: 'VMC - 7', title: 'Way lube', frequency: 'WEEKLY', due_date: inDays(7), assigned_to_name: null, is_overdue: false }
    ] : [],
    tickets: { data: saved ? [{ id: 99, title: 'Way lube', status: 'OPEN', priority: 'LOW', due_date: now.toISOString(), completed_at: null,
      frequency: 'WEEKLY', grace_days: 0, machine_serial_no: 'VMC - 7', assigned_to_name: null, is_overdue: false }] : [],
      total: saved ? 1 : 0, page: 1, limit: 10, totalPages: 1 }
  })));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/periodic-maintenance');
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  const plan = page.locator('#pePlan');
  await expect(plan.getByText('No schedules configured yet.')).toBeVisible();

  await plan.locator('#scMachine').selectOption({ label: 'VMC - 7' });
  await plan.locator('#scTitle').fill('Way lube');
  await plan.locator('#scFreq').selectOption('WEEKLY');
  await plan.getByRole('button', { name: 'Save schedule' }).click();

  await expect(page.getByText('Schedule saved · 1 ticket raised')).toBeVisible();
  expect(posted).toMatchObject({ machine_id: 7, title: 'Way lube', frequency: 'WEEKLY', grace_days: 0 });
  await expect(plan.locator('tbody tr', { hasText: 'Way lube' })).toHaveCount(1);          // the plan

  const upcoming = page.locator('section', { has: page.getByRole('heading', { name: 'Upcoming Maintenance' }) });
  await expect(upcoming.locator('tbody tr', { hasText: 'Way lube' })).toHaveCount(2);      // This Week: today's and next week's
  await upcoming.getByRole('button', { name: 'Today' }).click();
  await expect(upcoming.locator('tbody tr', { hasText: 'Way lube' })).toHaveCount(1);

  const tickets = page.locator('#peTickets');
  await expect(tickets.locator('tbody tr', { hasText: 'Way lube' })).toHaveCount(1);        // the raised ticket
});
