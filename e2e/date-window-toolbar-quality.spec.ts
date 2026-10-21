import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Three rules added on 2026-09-24:
 *  1. report and dashboard dates stop at today and go back three months
 *     (92 days); a typed date outside is pulled back in, and a range's two
 *     ends cannot cross;
 *  2. the Reports toolbar exports whichever tab is open — the OEE Records
 *     and Machine OEE tabs no longer draw a second search-and-export row;
 *     since 21 Oct 2026 every tab offers CSV and Excel of the whole report,
 *     there is no Email button, and a report too large to download is
 *     emailed — the message saying so is all the screen shows;
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
  test('every tab offers CSV and Excel; nobody sees an Email button; no second search row', async ({ page }) => {
    await asAdmin(page);
    const bar = page.locator('.toolbar-right');

    await page.goto('/reports?tab=production');
    await expect(bar.getByRole('button', { name: /Columns/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Export CSV: Production' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Excel: Production' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Email/ })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /Send the report to/ })).toHaveCount(0);

    await page.goto('/reports?tab=oee-records');
    await expect(bar.getByRole('button', { name: 'Export CSV: OEE Records' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Excel: OEE Records' })).toBeVisible();
    for (const gone of [/Columns/, /Email/, /^PDF/]) {
      await expect(bar.getByRole('button', { name: gone })).toHaveCount(0);
    }
    await expect(page.locator('app-oee-reports .search-box')).toHaveCount(0);
    await expect(page.locator('app-oee-reports .btn-export')).toHaveCount(0);

    await page.goto('/reports?tab=machine-oee');
    await expect(bar.getByRole('button', { name: 'Export CSV: Machine OEE' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Excel: Machine OEE' })).toBeVisible();
    // Machine OEE exports Excel and CSV only — no PDF
    await expect(bar.getByRole('button', { name: /^PDF/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Email' })).toHaveCount(0);
  });

  test('OEE Records exports CSV and Excel of every record, with its filters, columns and order', async ({ page }) => {
    const exports: URL[] = [];
    await asAdmin(page);
    await page.route('**/api/oee/reports*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: [{ shift_date: TODAY, machine_serial_no: 'VMC-1', shift_code: 'A', oee: '80.00' }],
                             pagination: { page: 1, limit: 15, total: 1, totalPages: 1 } }) }));
    await page.route('**/api/oee/export*', (r: any) => {
      exports.push(new URL(r.request().url()));
      return r.fulfill({ status: 200, contentType: 'text/csv', body: 'a,b\n1,2' });
    });
    await page.goto('/reports?tab=oee-records');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV: OEE Records' }).click();
    expect((await download).suggestedFilename()).toBe(`oee-records_${TODAY}_to_${TODAY}.csv`);
    await page.getByRole('button', { name: 'Excel: OEE Records' }).click();
    await expect.poll(() => exports.length).toBe(2);
    const [csv, xlsx] = exports.map(u => u.searchParams);
    expect([csv.get('format'), xlsx.get('format')]).toEqual(['csv', 'xlsx']);
    expect([csv.get('from_date'), csv.get('to_date')]).toEqual([TODAY, TODAY]);
    expect(csv.get('columns')).toBe('shift_date,machine_serial_no,shift_code,operator_name,oee,availability,performance,quality');
    expect([csv.get('sort_by'), csv.get('sort_order')]).toEqual(['shift_date', 'DESC']);
  });

  test('a built report exports the whole range, its filters, chosen columns and order — CSV and Excel alike', async ({ page }) => {
    const exports: URL[] = [];
    await asAdmin(page);
    await page.route('**/api/reports/shifts*', (r: any) => r.fulfill(ok([{ id: 10, name: 'A' }])));
    await page.route('**/api/reports/shift-oee-data*', (r: any) => r.fulfill(ok({
      rows: [{ machine: 'CNC-01', operator: 'S', shift: 'A', date: '21-Oct-2026', availability: '90', performance: '80', quality: '99', oee: '71.3' }],
      summary: {} })));
    await page.route('**/api/reports/shift-oee?*', (r: any) => {
      exports.push(new URL(r.request().url()));
      return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'x' });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/reports?tab=shift-oee');
    await page.getByLabel('Shift', { exact: true }).selectOption({ label: 'A' });
    await page.getByRole('button', { name: /OEE %/ }).click();            // sort by OEE
    await page.getByRole('button', { name: 'Excel: Shift OEE' }).click();
    await page.getByRole('button', { name: 'Export CSV: Shift OEE' }).click();
    await expect.poll(() => exports.length).toBe(2);
    const [xlsx, csv] = exports.map(u => u.searchParams);
    expect([xlsx.get('format'), csv.get('format')]).toEqual(['xlsx', 'csv']);
    expect([xlsx.get('date_from'), xlsx.get('date_to'), xlsx.get('shift_id')]).toEqual([TODAY, TODAY, '10']);
    expect(xlsx.get('columns')).toBe('machine,operator,shift,date,availability,performance,quality,oee');
    expect([xlsx.get('sort'), xlsx.get('dir')]).toEqual(['oee', 'asc']);
  });

  test('a report too large to download is emailed: the message is all that shows', async ({ page }) => {
    await asAdmin(page);
    const message = 'This report is large (25,000 rows), so it is being prepared in the background and will be emailed to gokul@plant.test. Please check your email in 10–15 minutes.';
    await page.route('**/api/oee/reports*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: [{ shift_date: TODAY, machine_serial_no: 'VMC-1' }],
                             pagination: { page: 1, limit: 15, total: 25000, totalPages: 1667 } }) }));
    await page.route('**/api/oee/export*', (r: any) => r.fulfill({ status: 202, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { queued: true, to: 'gokul@plant.test', rows: 25000, message } }) }));
    let downloaded = false;
    page.on('download', () => { downloaded = true; });

    await page.goto('/reports?tab=oee-records');
    await page.getByRole('button', { name: 'Excel: OEE Records' }).click();
    const note = page.getByRole('status').filter({ hasText: 'check your email in 10–15 minutes' });
    await expect(note).toHaveText(new RegExp(message.replace(/[.()]/g, '\\$&')));
    expect(downloaded).toBe(false);
    await note.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note).toHaveCount(0);
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
