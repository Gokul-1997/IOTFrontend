import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The three-month rule on the Report page.
 *
 * A year of hourly rows for a 20-machine plant is ~175,000 records. Serving
 * that in one JSON response is what the limit exists to prevent, so past
 * MAX_DIRECT_DAYS (92) the page must stop asking for it at all and offer
 * email delivery instead — the server refuses it too (413 RANGE_TOO_LARGE),
 * but a round trip to be told no is not a design.
 */

const ok = (data: any) => ({ status: 'success', data });

const rows = [
  { machine: 'CNC-01', operator: 'Suresh', shift: 'Shift 1', hour: '09:00',
    run_time: '00:52', idle_time: '00:08', produced_qty: 48, energy_kwh: 12.4 }
];

/** date_from that makes the range exactly `days` long, ending today. */
function daysAgo(days: number): string {
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

test('report dates stay within the last three months, and a full window is fetched directly', async ({ authedPage: page }) => {
  const dataCalls: string[] = [];
  const emailCalls: any[] = [];
  // Reports opens for a role holding a report; the fixture's legacy ADMIN holds none
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });

  await page.route('**/api/reports/machines*',  r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok([{ id: 1, name: 'CNC-01' }])) }));
  await page.route('**/api/reports/shifts*',    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok([{ id: 10, name: 'Shift 1' }])) }));
  await page.route('**/api/reports/operators*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok([{ id: 5, name: 'Suresh' }])) }));

  await page.route('**/api/reports/production-data*', route => {
    dataCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(ok({ rows, summary: { total_parts: 48 } })) });
  });

  await page.route('**/api/reports/email', route => {
    emailCalls.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: 202, contentType: 'application/json',
      body: JSON.stringify(ok({ queued: true, to: 'test@example.com',
                                message: 'The report is being prepared and will be emailed to test@example.com.' })) });
  });

  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/reports');

  // a one-day range loads normally
  await expect(page.locator('table')).toBeVisible();
  expect(dataCalls.length, 'the default range is fetched').toBeGreaterThan(0);

  /* Report dates stop at the last three months (92 days), and a typed date
     earlier than that is pulled back into the window — so a full window is
     always fetched directly, never tipped into the "too long" path. */
  const from = page.locator('input.filter-date').first();
  await expect(from).toHaveAttribute('min', daysAgo(92));
  await from.fill(daysAgo(200));
  await from.blur();
  await expect(from).toHaveValue(daysAgo(92));
  await expect(page.getByText(/too long to show on screen/i)).toHaveCount(0);

  const before = dataCalls.length;
  await page.getByRole('button', { name: /apply|search|submit/i }).first().click();
  await expect.poll(() => dataCalls.length).toBeGreaterThan(before);
  expect(new URL(dataCalls.at(-1)!).searchParams.get('date_from')).toBe(daysAgo(92));

  // the toolbar's Email sends the same in-window report
  await page.getByRole('button', { name: 'Email' }).click();
  await expect.poll(() => emailCalls.length).toBe(1);
  expect(emailCalls[0].type).toBe('production');
  expect(emailCalls[0].columns.length).toBeGreaterThan(0);
  expect(emailCalls[0].date_from).toBe(daysAgo(92));

  // the Report page is Tailwind-styled rather than MEXA; it shares the shell,
  // so it is worth a look whenever the ground changes
  await page.screenshot({ path: 'mexa-reports.png', fullPage: true });
});
