import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Three rules added on 2026-09-24:
 *  1. report and dashboard dates stop at today and go back three months
 *     (92 days); a typed date outside is pulled back in, and a range's two
 *     ends cannot cross;
 *  2. the Reports toolbar exports whichever tab is open — the OEE Records
 *     and Machine OEE tabs no longer draw a second search-and-export row;
 *  3. Quality opens on All lines, so every machine is in the list (it opened
 *     on the first line, Bay 5, and its 4 machines).
 */

const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', success: true, data }) });
const IST = 330 * 60 * 1000;
const dayIST = (daysBack: number) => new Date(Date.now() + IST - daysBack * 86_400_000).toISOString().slice(0, 10);
const TODAY = dayIST(0), FLOOR = dayIST(91), NEXT_YEAR = `${Number(TODAY.slice(0, 4)) + 1}-01-01`;

async function asAdmin(page: any) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
}

test.describe('the three-month date window', () => {
  for (const [path, from, to] of [
    ['/alarm-report', '#alFrom', '#alTo'],
    ['/oee-dashboard', '#oeFrom', '#oeTo'],
    ['/preventive-maintenance', '#pvFrom', '#pvTo'],
    ['/downtime-analysis', '#dtFrom', '#dtTo']
  ]) {
    test(`${path}: no future date, nothing before three months, ends cannot cross`, async ({ page }) => {
      await asAdmin(page);
      await page.goto(path);
      const f = page.locator(from), t = page.locator(to);
      await expect(f).toHaveAttribute('min', FLOOR);
      await expect(t).toHaveAttribute('max', TODAY);

      await t.fill(NEXT_YEAR); await t.blur();
      await expect(t).toHaveValue(TODAY);                     // pulled back to today
      await f.fill('2020-01-01'); await f.blur();
      await expect(f).toHaveValue(FLOOR);                     // pulled up to the window
      // the From may not pass the To, nor the To go before the From
      await expect(f).toHaveAttribute('max', TODAY);
      await t.fill(dayIST(3)); await t.blur();
      await expect(f).toHaveAttribute('max', dayIST(3));
      await expect(t).toHaveAttribute('min', FLOOR);
    });
  }

  for (const path of ['/factory', '/quality', '/charts', '/maintenance-dashboard']) {
    test(`${path}: the single date is inside the window too`, async ({ page }) => {
      await asAdmin(page);
      await page.goto(path);
      const d = page.locator('input[type=date]').first();
      await expect(d).toHaveAttribute('min', FLOOR);
      await expect(d).toHaveAttribute('max', TODAY);
    });
  }

  test('dates that belong in the future are left alone (maintenance plan "Next due")', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/periodic-maintenance');
    // the plan form's Next due is not a report filter
    const planDate = page.locator('#scNext');
    if (await planDate.count()) await expect(planDate).not.toHaveAttribute('max', /.+/);
  });
});

test.describe('one Reports toolbar for every tab', () => {
  test('each tab offers only its own exports, and no second search row', async ({ page }) => {
    await asAdmin(page);
    const bar = page.locator('.toolbar-right');

    await page.goto('/reports?tab=production');
    await expect(bar.getByRole('button', { name: /Columns/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Export CSV: Production' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Excel: Production' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Email' })).toBeVisible();

    await page.goto('/reports?tab=oee-records');
    await expect(bar.getByRole('button', { name: 'Export CSV: OEE Records' })).toBeVisible();
    for (const gone of [/Columns/, /^Excel/, 'Email', /^PDF/]) {
      await expect(bar.getByRole('button', { name: gone })).toHaveCount(0);
    }
    await expect(page.locator('app-oee-reports .search-box')).toHaveCount(0);
    await expect(page.locator('app-oee-reports .btn-export')).toHaveCount(0);

    await page.goto('/reports?tab=machine-oee');
    await expect(bar.getByRole('button', { name: 'Export CSV: Machine OEE' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Excel: Machine OEE' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'PDF: Machine OEE' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Email' })).toHaveCount(0);
  });

  test('the toolbar CSV on OEE Records exports OEE Records, with its filters', async ({ page }) => {
    const exports: string[] = [];
    await asAdmin(page);
    await page.route('**/api/oee/export*', (r: any) => {
      exports.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/csv', body: 'a,b\n1,2' });
    });
    await page.goto('/reports?tab=oee-records');
    await page.getByRole('button', { name: 'Export CSV: OEE Records' }).click();
    await expect.poll(() => exports.length).toBe(1);
    expect(new URL(exports[0]).searchParams.get('from_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the toolbar Excel on Machine OEE exports Machine OEE', async ({ page }) => {
    const exports: string[] = [];
    await asAdmin(page);
    await page.route('**/api/dashboard/oee/export/**', (r: any) => {
      exports.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'x' });
    });
    await page.goto('/reports?tab=machine-oee');
    await page.getByRole('button', { name: 'Excel: Machine OEE' }).click();
    await expect.poll(() => exports.length).toBe(1);
    expect(exports[0]).toContain('/dashboard/oee/export/xlsx');
  });
});

test.describe('Quality: every machine', () => {
  const lines = [{ id: 11, name: 'Bay 1' }, { id: 15, name: 'Bay 5' }];
  const all = [
    { id: 1, machine_serial_no: 'VMC - 12 - F', line_id: 11 },
    { id: 2, machine_serial_no: 'VMC - 13 - M', line_id: 11 },
    { id: 3, machine_serial_no: 'HMC - 7 - F', line_id: 15 },
    { id: 4, machine_serial_no: 'NEW MACHINE', line_id: null }
  ];

  test('opens on All lines, grouped by line; a line narrows it', async ({ page }) => {
    await asAdmin(page);
    await page.route('**/api/lines*', (r: any) => r.fulfill(ok(lines)));
    await page.route('**/api/master/machines', (r: any) => r.fulfill(ok(all)));
    await page.route('**/api/master/machines-by-line*', (r: any) => r.fulfill(ok(all.filter(m => m.line_id === 15))));
    await page.route('**/api/master/shifts', (r: any) => r.fulfill(ok([{ id: 5, shift_code: 'S1', shift_name: 'Shift 1' }])));
    await page.goto('/quality');

    const lineSel = page.getByLabel('Line Name');
    const machineSel = page.getByLabel('Machine Name');
    await expect(lineSel.locator('option:checked')).toHaveText('All lines');
    await expect(machineSel.locator('option')).toHaveCount(4);
    await expect(machineSel.locator('optgroup')).toHaveCount(3);
    expect(await machineSel.locator('optgroup').evaluateAll(g => g.map(x => (x as HTMLOptGroupElement).label)))
      .toEqual(['Bay 1', 'Bay 5', 'No line']);

    await lineSel.selectOption({ label: 'Bay 5' });
    await expect(machineSel.locator('option')).toHaveText(['HMC - 7 - F']);
    await expect(machineSel.locator('optgroup')).toHaveCount(0);
  });
});
