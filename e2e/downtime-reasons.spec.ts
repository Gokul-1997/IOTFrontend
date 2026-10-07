import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Downtime → Reason codes is a table: code, name, category, where the code
 * comes from. It sorts, it searches, and it says so when it is loading,
 * empty, finds nothing, or could not load. The Summary tab says when it
 * could not load, instead of "No downtime" (it covered a server error).
 */

const json = (status: number, body: any) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const reasons = [
  { id: 1,  company_id: null, code: 'BRK', name: 'Machine Breakdown', category: 'UNPLANNED' },
  { id: 5,  company_id: null, code: 'CHG', name: 'Tool/Die Changeover', category: 'CHANGEOVER' },
  { id: 9,  company_id: null, code: 'LNC', name: 'Lunch/Break', category: 'PLANNED' },
  { id: 40, company_id: 4,    code: 'ZMT', name: 'Waiting for material', category: 'UNPLANNED' }
];

async function open(page: any, reasonsReply: () => any) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(json(200, { success: true, data: [] })));
  await page.route('**/api/downtime/events*', (r: any) => r.fulfill(json(200, { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })));
  await page.route('**/api/downtime/reasons*', (r: any) => r.fulfill(reasonsReply()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/downtime');
  await page.getByRole('tab', { name: 'Reason codes' }).click();
  return page.getByRole('region', { name: 'Reason codes' }).locator('table');
}

test('reason codes: a table that sorts and searches, built-in and own codes told apart', async ({ page }) => {
  const table = await open(page, () => json(200, { success: true, data: reasons }));
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(table.locator('thead th')).toHaveText([/Code/, /Name/, /Category/, 'Source']);
  await expect(page.getByText('4 of 4 reason codes')).toBeVisible();

  // sorted by code to start with; Name sorts by name, again reverses it
  await expect(rows.first()).toContainText('BRK');
  const byName = table.getByRole('button', { name: /Name/ });
  await byName.click();
  await expect(table.locator('thead th').nth(1)).toHaveAttribute('aria-sort', 'ascending');
  await expect(rows.first()).toContainText('Lunch/Break');
  await byName.click();
  await expect(table.locator('thead th').nth(1)).toHaveAttribute('aria-sort', 'descending');
  await expect(rows.first()).toContainText('Waiting for material');

  // the category reads as a word; where the code comes from is said
  const own = rows.filter({ hasText: 'ZMT' });
  await expect(own.locator('.mexa-badge')).toHaveText('Unplanned');
  await expect(own).toContainText('Your company');
  await expect(rows.filter({ hasText: 'BRK' })).toContainText('Built-in');

  // search by code or name
  const search = page.getByRole('searchbox', { name: 'Search reason codes' });
  await search.fill('break');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('2 of 4 reason codes')).toBeVisible();
  await search.fill('zzz');
  await expect(page.getByText('No reason code matches “zzz”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(4);
});

test('reason codes: a failed load says so and can be tried again', async ({ page }) => {
  let fail = true;
  const table = await open(page, () => fail
    ? json(500, { status: 'error', message: 'Something went wrong on the server. Please try again.' })
    : json(200, { success: true, data: reasons }));
  await expect(page.getByText('Could not load the reason codes')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(4);
});

test('summary: a server error is an error, not "no downtime"; figures read in hours', async ({ page }) => {
  let fail = true;
  await open(page, () => json(200, { success: true, data: reasons }));
  await page.route('**/api/downtime/summary*', (r: any) => r.fulfill(fail
    ? json(500, { status: 'error', message: 'Something went wrong on the server. Please try again.' })
    : json(200, { success: true, data: [{ category: 'UNPLANNED', reason_name: 'Machine Breakdown', code: 'BRK', event_count: '3', total_seconds: '5400' }] })));
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.getByText('Could not load the downtime summary')).toBeVisible();
  await expect(page.getByText(/No downtime/)).toHaveCount(0);

  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  const row = page.getByRole('region', { name: 'Downtime summary' }).locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Machine Breakdown');
  await expect(row).toContainText('1.5 hrs');
});
