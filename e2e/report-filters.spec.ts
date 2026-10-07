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

  test('OEE Records: no Apply; a machine choice loads, Clear stays', async ({ page }) => {
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
    await expect(page.getByRole('button', { name: /Clear/ }).first()).toBeVisible();

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
