import { test, expect, localFixtureOrigin } from './fixtures/auth';

/*
 * Live Dashboard: Pause, the page and the status filter hold while a machine
 * is opened and closed (27 Nov 2026, the user: "click Pause, view a machine,
 * come back — auto rotate is on again, why?"). A fresh load rotates again,
 * as a wall display should; a Factory tile's status starts that list at page 1.
 */
const asked: URL[] = [];
const machine = (id: number) => ({ machine_id: id, machine_serial_no: `VMC - ${id}`, operator_name: 'OP', part_name: 'Part',
  status: id % 3 ? 'RUNNING' : 'IDLE', alarm: false, run_minutes: 60, idle_minutes: 10, run_time: '01:00:00', idle_time: '00:10:00',
  produced_qty: 5, achieved_qty: 5, target_qty: 10, utilization: 80 });

async function live(page: any) {
  asked.length = 0;
  const origin = localFixtureOrigin();
  await page.route('**/*', (r: any) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route(/\/api\/dashboard\?/, (r: any) => {
    const url = new URL(r.request().url()); asked.push(url);
    const p = Number(url.searchParams.get('page')) || 1;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'success', shift: { shift_code: 'A', shiftElapsedMinutes: 100, plannedMinutes: 480 },
      summary: { total: 18, running: 12, idle: 6, alarm: 0, offline: 0 },
      machines: Array.from({ length: 6 }, (_, i) => machine((p - 1) * 6 + i + 1)),
      pagination: { page: p, per_page: 6, total: 18, total_pages: 3 } }) });
  });
  await page.clock.install();
  await page.goto('/dashboard');
  await expect(page.getByText('Auto: 1/3')).toBeVisible();
}

test('Pause and the page are found as they were after opening a machine', async ({ authedPage: page }) => {
  await live(page);
  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page.getByText('Auto: 2/3')).toBeVisible();
  await page.getByRole('button', { name: 'Pause page rotation' }).click();
  await expect(page.getByText('Paused: 2/3')).toBeVisible();

  await page.getByRole('link', { name: /^Open VMC - 8,/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/live\/8$/);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(page.getByText('Paused: 2/3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume page rotation' })).toBeVisible();
  expect(asked.at(-1)!.searchParams.get('page')).toBe('2');
  await page.clock.runFor(35_000);                                   // three rotation periods: it stays
  await expect(page.getByText('Paused: 2/3')).toBeVisible();

  await page.getByRole('button', { name: 'Resume page rotation' }).click();
  await page.clock.runFor(11_000);
  await expect(page.getByText('Auto: 3/3')).toBeVisible();
});

test('the status filter is kept too; a fresh load rotates from page 1', async ({ authedPage: page }) => {
  await live(page);
  await page.getByRole('button', { name: /^Idle :/ }).click();
  await expect.poll(() => asked.at(-1)!.searchParams.get('status')).toBe('idle');
  await page.getByRole('button', { name: 'Pause page rotation' }).click();
  await page.getByRole('link', { name: /^Open VMC - 3,/ }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByText('Paused: 1/3')).toBeVisible();
  expect(asked.at(-1)!.searchParams.get('status')).toBe('idle');

  await page.reload();
  await expect(page.getByText('Auto: 1/3')).toBeVisible();
  expect(asked.at(-1)!.searchParams.get('status')).toBe('all');
});

test('a Factory tile still opens its status at page 1', async ({ authedPage: page }) => {
  await live(page);
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: 'Pause page rotation' }).click();
  await page.getByRole('link', { name: /^Open VMC - 7,/ }).click();
  await page.goto('/dashboard?status=running');                      // as the Factory's Running tile links
  await expect.poll(() => asked.at(-1)!.searchParams.get('status')).toBe('running');
  expect(asked.at(-1)!.searchParams.get('page')).toBe('1');
});
