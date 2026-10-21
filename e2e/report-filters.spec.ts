import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The report screens work like the dashboards: no Apply or Submit button.
 * A dropdown choice asks for the data with it, and only the latest choice is
 * ever shown — an answer still on its way when the filters change again is
 * dropped. Reports (Production, OEE Records, Machine OEE), Charts, Quality.
 */

const json = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const ok = (data: any) => json({ status: 'success', success: true, data });

async function asAdmin(page: any) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
}

/** How the open tab's filter bar is drawn: its first date field, dropdown and label, and its Reset — size, type, frame. */
const filterBarLook = (page: any) => page.evaluate(() => {
  const panel = document.querySelector('.ui-tabpanel')!;
  const reset = [...panel.querySelectorAll('button')].find(b => /Reset/.test(b.textContent || ''));
  const pick = (el: Element | null | undefined) => {
    if (!el) return null;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), font: s.fontSize, weight: s.fontWeight,
             color: s.color, bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius, pad: s.paddingLeft };
  };
  return { date: pick(panel.querySelector('input[type=date]')), select: pick(panel.querySelector('select')),
           label: pick(panel.querySelector('label')), reset: pick(reset) };
});

const noApply = async (page: any) => {
  await expect(page.getByRole('button', { name: /^\s*(check\s*)?apply\s*$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^\s*submit\s*$/i })).toHaveCount(0);
};

test.describe('Reports: the filters apply themselves', () => {
  test('Production: a choice loads at once, and a late answer to an older choice is dropped', async ({ page }) => {
    await asAdmin(page);
    await page.route('**/api/reports/machines*', (r: any) => r.fulfill(ok([{ id: 1, name: 'CNC-01' }, { id: 2, name: 'CNC-02' }])));
    await page.route('**/api/reports/shifts*', (r: any) => r.fulfill(ok([{ id: 10, name: 'Shift 1' }, { id: 11, name: 'Shift 2' }])));
    await page.route('**/api/reports/operators*', (r: any) => r.fulfill(ok([{ id: 5, name: 'Suresh' }])));

    /* The machine choice's answer is held back until the shift choice has
       been answered: it must not replace the newer rows when it lands. */
    const calls: string[] = [];
    let releaseMachine: () => void = () => {};
    await page.route('**/api/reports/production-data*', async (r: any) => {
      const url = decodeURIComponent(r.request().url());
      calls.push(url);
      const row = (machine: string) => ({ machine, operator: 'Suresh', shift: 'Shift 1', hour: '09:00',
        run_time: '00:52', idle_time: '00:08', produced_qty: 48, energy_kwh: 12.4 });
      if (url.includes('machine_id=2') && !url.includes('shift_id=11')) {
        await new Promise<void>(res => (releaseMachine = res));
        return r.fulfill(ok({ rows: [row('OLD-ANSWER')], summary: {} })).catch(() => {});
      }
      const machine = url.includes('shift_id=11') ? 'NEW-ANSWER' : 'CNC-01';
      return r.fulfill(ok({ rows: [row(machine)], summary: {} }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/reports?tab=production');
    await expect(page.locator('table')).toBeVisible();
    await noApply(page);
    await expect(page.getByRole('button', { name: /Reset/ })).toBeVisible();

    const before = calls.length;
    await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'CNC-02' });
    await expect.poll(() => calls.slice(before).some(u => u.includes('machine_id=2'))).toBe(true);
    await page.getByLabel('Shift', { exact: true }).selectOption({ label: 'Shift 2' });
    await expect.poll(() => calls.some(u => u.includes('shift_id=11'))).toBe(true);
    await expect(page.locator('table')).toContainText('NEW-ANSWER');

    releaseMachine();
    await page.waitForTimeout(300);
    await expect(page.locator('table')).toContainText('NEW-ANSWER');
    await expect(page.locator('table')).not.toContainText('OLD-ANSWER');
  });

  test('OEE Records: no Apply; a machine choice loads, Reset stays', async ({ page }) => {
    await asAdmin(page);
    const calls: string[] = [];
    await page.route('**/api/oee/meta*', (r: any) => r.fulfill(json({ success: true, data: {
      lines: [], machines: [{ id: 1, machine_serial_no: 'CNC-01' }, { id: 2, machine_serial_no: 'CNC-02' }],
      shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } })));
    await page.route('**/api/oee/reports*', (r: any) => {
      calls.push(decodeURIComponent(r.request().url()));
      return r.fulfill(json({ success: true, data: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 1 } }));
    });

    await page.goto('/reports?tab=oee-records');
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await noApply(page);
    await expect(page.getByRole('button', { name: /Reset/ })).toBeVisible();

    const machine = page.getByLabel('Machine', { exact: true });
    await expect(machine.locator('option', { hasText: 'CNC-02' })).toHaveCount(1);
    const before = calls.length;
    await machine.selectOption({ label: 'CNC-02' });
    await expect.poll(() => calls.slice(before).some(u => /machine(_id)?=2/.test(u))).toBe(true);
  });

  test('Machine OEE: no Apply; a shift choice loads', async ({ page }) => {
    await asAdmin(page);
    const calls: string[] = [];
    await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json({ success: true, data: {
      machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
      shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }, { id: 11, shift_code: 'S2', shift_name: 'Shift 2' }] } })));
    await page.route('**/api/dashboard/oee?*', (r: any) => {
      calls.push(decodeURIComponent(r.request().url()));
      return r.fulfill(ok({ machines: { data: [], total: 0 } }));
    });

    await page.goto('/reports?tab=machine-oee');
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await noApply(page);
    const shift = page.locator('select[name=moShift]');
    await expect(shift.locator('option', { hasText: 'Shift 2' })).toHaveCount(1);
    const before = calls.length;
    await shift.selectOption({ label: 'Shift 2' });
    await expect.poll(() => calls.slice(before).some(u => u.includes('shift_id=11'))).toBe(true);
  });

  /* 21 Oct 2026 — "report page dropdowns all look the same but Machine OEE
     looks different: From, To and Shift". It had its own small fields; now
     it is the other tabs' filter bar, so compare what is drawn, not classes. */
  test('Machine OEE: the same filter bar as the other tabs, and Reset', async ({ page }) => {
    await asAdmin(page);
    await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json({ success: true, data: {
      machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
      shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }, { id: 11, shift_code: 'S2', shift_name: 'Shift 2' }] } })));
    const calls: string[] = [];
    await page.route('**/api/dashboard/oee?*', (r: any) => {
      calls.push(decodeURIComponent(r.request().url()));
      return r.fulfill(ok({ machines: { data: [], total: 0 } }));
    });

    const look = () => filterBarLook(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/reports?tab=production');
    await expect(page.getByRole('button', { name: /Reset/ })).toBeVisible();
    const production = await look();
    await page.getByRole('tab', { name: /Machine OEE/ }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(await look()).toEqual(production);
    await expect(page.locator('#moShift option').first()).toHaveText('All Shifts');

    // Reset: back to the last seven days and every shift, and loaded at once
    const from = page.getByLabel('Date From', { exact: true }), to = page.getByLabel('Date To', { exact: true });
    const [from0, to0] = [await from.inputValue(), await to.inputValue()];
    await page.getByLabel('Shift', { exact: true }).selectOption({ label: 'Shift 2' });
    await expect.poll(() => calls.at(-1)).toContain('shift_id=11');
    await from.fill(to0);
    await expect.poll(() => calls.at(-1)).toContain(`from=${to0}`);
    const before = calls.length;
    await page.getByRole('button', { name: /Reset/ }).click();
    await expect(from).toHaveValue(from0);
    await expect(to).toHaveValue(to0);
    await expect(page.locator('#moShift option:checked')).toHaveText('All Shifts');
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)).toContain(`from=${from0}`);
    expect(calls.at(-1)).not.toContain('shift_id=');
  });

  /* 21 Oct 2026 — "OEE Records tab different why?": its own filter box with
     capital labels, a Clear, a Material pager and bars under the figures. */
  test('OEE Records: the same filter bar, table and pager as the other tabs; Reset; Shift sorts by shift', async ({ page }) => {
    await asAdmin(page);
    await page.route('**/api/reports/machines*', (r: any) => r.fulfill(ok([{ id: 1, name: 'CNC-01' }])));
    await page.route('**/api/reports/shifts*', (r: any) => r.fulfill(ok([{ id: 10, name: 'A' }])));
    await page.route('**/api/oee/meta*', (r: any) => r.fulfill(json({ success: true, data: {
      lines: [{ id: 3, name: 'Bay 1' }], machines: [{ id: 1, machine_serial_no: 'CNC-01', line_id: 3 }, { id: 2, machine_serial_no: 'CNC-02', line_id: null }],
      shifts: [{ id: 10, shift_code: 'A', shift_name: 'Morning' }] } })));
    const calls: URL[] = [];
    await page.route('**/api/oee/reports*', (r: any) => {
      calls.push(new URL(r.request().url()));
      return r.fulfill(json({ status: 'success', data: [
        { shift_date: '2026-10-21', machine_serial_no: 'CNC-01', shift_code: 'A', operator_name: null,
          oee: '82.35', availability: '90.00', performance: null, quality: '99.00' }],
        pagination: { page: 1, limit: 15, total: 1, totalPages: 1 } }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/reports?tab=production');
    await expect(page.getByRole('button', { name: /Reset/ })).toBeVisible();
    const production = await filterBarLook(page);
    await page.getByRole('tab', { name: /OEE Records/ }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(await filterBarLook(page)).toEqual(production);
    // machine, not line, as on every page (21 Oct 2026); the machines in one list
    await expect(page.locator('app-oee-reports .label_custom')).toHaveText(['Date From', 'Date To', 'Machine', 'Shift']);
    await expect(page.locator('#orMachine option')).toHaveText(['All Machines', 'CNC-01', 'CNC-02']);

    // figures as on the other tabs: 82.35%, "--" for unknown (no bars), the day as 21-Oct-2026
    const row = page.locator('app-oee-reports tbody tr').first();
    await expect(row).toContainText('21-Oct-2026');
    await expect(row).toContainText('82.35%');
    await expect(row.locator('td').nth(7)).toHaveText('--');              // performance not known
    await expect(page.locator('app-oee-reports .metric-bar')).toHaveCount(0);
    // the table's own pager, not Angular Material's
    await expect(page.locator('app-oee-reports .mexa-pager')).toContainText('Showing 1–1 of 1');
    await expect(page.locator('app-oee-reports mat-paginator')).toHaveCount(0);

    // Shift sorts by shift
    await page.getByRole('button', { name: /^Shift/ }).click();
    await expect.poll(() => calls.at(-1)?.searchParams.get('sort_by')).toBe('shift_code');

    // Reset: today and everything, loaded at once
    await page.locator('#orMachine').selectOption({ label: 'CNC-02' });
    await expect.poll(() => calls.at(-1)?.searchParams.get('machine_id')).toBe('2');
    const before = calls.length;
    await page.getByRole('button', { name: /Reset/ }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)!.searchParams.get('machine_id')).toBeNull();
    expect(calls.every(u => !u.searchParams.has('line_id'))).toBe(true);
    await expect(page.locator('#orMachine option:checked')).toHaveText('All Machines');
  });
});

test('Charts: no Submit; a shift choice reloads both charts', async ({ page }) => {
  await asAdmin(page);
  const calls: string[] = [];
  const parts: string[] = [];
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json({ success: true, data: {
    machines: [{ id: 1, machine_serial_no: 'VMC-1' }],
    shifts: [{ id: 5, shift_code: 'S1', shift_name: 'Morning', start_time: '08:00', end_time: '20:00' },
             { id: 6, shift_code: 'S2', shift_name: 'Night', start_time: '20:00', end_time: '08:00' }] } })));
  await page.route('**/api/charts/data*', (r: any) => {
    calls.push(decodeURIComponent(r.request().url()));
    return r.fulfill(json({ success: true, data: { hourlyCount: [], totalProduced: 0 } }));
  });
  await page.route('**/api/charts/parts*', (r: any) => {
    parts.push(decodeURIComponent(r.request().url()));
    return r.fulfill(json({ success: true, data: [], totalRunMin: 0, totalIdleMin: 0 }));
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/charts');
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  await noApply(page);

  const shift = page.getByLabel('Shift', { exact: true });
  await expect(shift.locator('option', { hasText: 'Night' })).toHaveCount(1);
  const before = calls.length, partsBefore = parts.length;
  await shift.selectOption({ label: 'Night' });
  // the hourly count asks with the shift; the part timing with the shift's own hours
  await expect.poll(() => calls.slice(before).some(u => u.includes('shift_id=6'))).toBe(true);
  await expect.poll(() => parts.length).toBeGreaterThan(partsBefore);
});

test('Quality: no Submit; a machine choice loads its figures', async ({ page }) => {
  await asAdmin(page);
  const calls: string[] = [];
  await page.route('**/api/lines*', (r: any) => r.fulfill(ok([])));
  await page.route('**/api/master/machines*', (r: any) => r.fulfill(ok([
    { id: 1, machine_serial_no: 'CNC-01', line_id: null }, { id: 2, machine_serial_no: 'CNC-02', line_id: null }])));
  await page.route('**/api/master/shifts*', (r: any) => r.fulfill(ok([{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }])));
  await page.route(/\/api\/quality\?/, (r: any) => {
    calls.push(decodeURIComponent(r.request().url()));
    return r.fulfill(json({ success: true, data: null }));
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/quality');
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  await noApply(page);

  const machine = page.getByLabel('Machine Name', { exact: true });
  const before = calls.length;
  await machine.selectOption({ label: 'CNC-02' });
  await expect.poll(() => calls.slice(before).some(u => u.includes('machine_id=2'))).toBe(true);
});
