import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Downtime → Reason codes is a table: code, name, category. It sorts, it
 * searches, and it says so when it is loading, empty, finds nothing, or could
 * not load. The Summary tab says when it could not load, instead of "No
 * downtime" (it covered a server error). Only the company's own codes are
 * listed: the built-in defaults were retired on 27 Nov 2026 (the user: "each
 * company creates the codes it needs").
 */

const json = (status: number, body: any) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const reasons = [
  { id: 41, company_id: 4, code: 'BRK', name: 'Machine Breakdown', category: 'UNPLANNED' },
  { id: 45, company_id: 4, code: 'CHG', name: 'Tool/Die Changeover', category: 'CHANGEOVER' },
  { id: 49, company_id: 4, code: 'LNC', name: 'Lunch/Break', category: 'PLANNED' },
  { id: 40, company_id: 4, code: 'ZMT', name: 'Waiting for material', category: 'UNPLANNED' }
];

async function open(page: any, reasonsReply: () => any, user: any = {}) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], ...user });
  await page.route('**/api/**', (r: any) => r.fulfill(json(200, { success: true, data: [] })));
  await page.route('**/api/downtime/events*', (r: any) => r.fulfill(json(200, { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })));
  await page.route('**/api/downtime/reasons*', (r: any) => r.fulfill(reasonsReply()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/downtime');
  await page.getByRole('tab', { name: 'Reason codes' }).click();
  return page.getByRole('region', { name: 'Reason codes' }).locator('table');
}

test('reason codes: a table of the company\'s own codes that sorts and searches', async ({ page }) => {
  const table = await open(page, () => json(200, { success: true, data: reasons }));
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(table.locator('thead th')).toHaveText([/Code/, /Name/, /Category/, 'Actions']);
  await expect(table).not.toContainText('Built-in');
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

  // the category reads as a word; every code is the company's, to edit or delete
  const own = rows.filter({ hasText: 'ZMT' });
  await expect(own.locator('.mexa-badge')).toHaveText('Unplanned');
  await expect(table.getByRole('button', { name: /^Edit reason code / })).toHaveCount(4);

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

test('company reason codes can be edited and deleted while recorded events remain visible', async ({ page }) => {
  let catalogue = reasons.map(reason => ({ ...reason }));
  const writes: any[] = [];
  const table = await open(page, () => json(200, { success: true, data: catalogue }));
  await page.route('**/api/downtime/reasons/40', async r => {
    writes.push({ method: r.request().method(), body: r.request().method() === 'PUT' ? r.request().postDataJSON() : null });
    if (r.request().method() === 'PUT') catalogue = catalogue.map(reason => reason.id === 40 ? { ...reason, ...writes.at(-1).body } : reason);
    else catalogue = catalogue.filter(reason => reason.id !== 40);
    await r.fulfill(json(200, { success: true }));
  });
  await page.route('**/api/downtime/events*', r => r.fulfill(json(200, { success: true,
    data: [{ id: 10, machine_serial_no: 'VMC19', reason_name: 'Waiting for material', category: 'UNPLANNED', duration_seconds: 300 }],
    pagination: { page: 1, total: 1, totalPages: 1 } })));
  await table.getByRole('button', { name: 'Edit reason code ZMT', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit reason code', exact: true });
  await expect(edit.getByLabel('Name', { exact: false })).toHaveValue('Waiting for material');
  await edit.getByLabel('Code', { exact: false }).fill('MAT1');
  await edit.getByLabel('Name', { exact: false }).fill('Material unavailable');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(table).toContainText('MAT1');
  expect(writes[0]).toEqual({ method: 'PUT', body: { code: 'MAT1', name: 'Material unavailable', category: 'UNPLANNED' } });
  await table.getByRole('button', { name: 'Delete reason code MAT1', exact: true }).click();
  let dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Existing downtime history is kept.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await table.getByRole('button', { name: 'Delete reason code MAT1', exact: true }).click();
  dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Delete reason code', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  expect(writes.at(-1).method).toBe('DELETE');
  await page.getByRole('tab', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Downtime events', exact: true })).toContainText('Waiting for material');
});

test('view-only users have no reason edit or delete controls', async ({ page }) => {
  const table = await open(page, () => json(200, { success: true, data: reasons }), {
    roles: ['VIEWER'], permissions: ['page:downtime:view'], company_permissions: ['page:downtime:view']
  });
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(table.getByRole('button', { name: /Edit reason code|Delete reason code/ })).toHaveCount(0);
  await expect(table.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCount(0);
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

test('a company with no reason codes of its own is told how to add the first', async ({ page }) => {
  const table = await open(page, () => json(200, { success: true, data: [] }));
  await expect(page.getByText('No reason codes yet')).toBeVisible();
  await expect(page.getByText('Add one with “Add reason code” to classify downtime.')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add reason code' })).toBeVisible();
  await expect(table.locator('thead th')).toHaveText([/Code/, /Name/, /Category/, 'Actions']);
});

