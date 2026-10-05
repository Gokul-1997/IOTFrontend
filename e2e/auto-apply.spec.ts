import { test, expect } from './fixtures/auth';

/*
 * Every dashboard's filters apply themselves (appAutoApply). There is no
 * Submit button any more: a dropdown choice asks for the data with it, and
 * so does a date — once, and with the latest choice. Covers the ten
 * dashboards whose title bar holds filters.
 */

const json = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'CNC-01' }, { id: 2, machine_serial_no: 'CNC-02' }],
    shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }, { id: 11, shift_code: 'S2', shift_name: 'Shift 2' }]
  }
};
/* Plant days, relative to today, so the test does not age out */
const day = (back: number) => new Date(Date.now() + 330 * 60000 - back * 86_400_000).toISOString().slice(0, 10);

type Screen = { path: string; title: string; api: RegExp; select: [label: string, option: string, param: string]; date?: string };
const screens: Screen[] = [
  { path: '/factory', title: 'Overall Factory Dashboard', api: /\/api\/dashboard\/factory\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'Date' },
  { path: '/maintenance-dashboard', title: 'Maintenance Dashboard', api: /\/api\/dashboard\/maintenance\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'Date' },
  { path: '/preventive-maintenance', title: 'Preventive Maintenance Dashboard', api: /\/api\/dashboard\/preventive\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'From date' },
  { path: '/periodic-maintenance', title: 'Periodic Maintenance Dashboard', api: /\/api\/dashboard\/periodic\?/, select: ['Machine', 'CNC-02', 'machine_id=2'] },
  { path: '/alarm-report', title: 'Alarm Report Dashboard', api: /\/api\/dashboard\/alarms\?/, select: ['Shift', 'Shift 2', 'shift_id=11'], date: 'From date' },
  { path: '/downtime-analysis', title: 'Downtime Reason Analysis', api: /\/api\/dashboard\/downtime\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'From date' },
  { path: '/operator-performance', title: 'Operator Performance Dashboard', api: /\/api\/dashboard\/operators\?/, select: ['Shift', 'Shift 2', 'shift_id=11'], date: 'From date' },
  { path: '/oee-dashboard', title: 'OEE Dashboard', api: /\/api\/dashboard\/oee\?/, select: ['Shift', 'Shift 2', 'shift_id=11'], date: 'From date' },
  { path: '/energy-dashboard', title: 'Energy Dashboard', api: /\/api\/dashboard\/energy\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'From date' },
  { path: '/maintenance-report', title: 'Maintenance Report', api: /\/api\/dashboard\/maintenance-report\?/, select: ['Machine', 'CNC-02', 'machine_id=2'], date: 'From date' }
];

for (const s of screens) {
  test(`${s.title}: filters apply themselves — no Submit`, async ({ authedPage: page }) => {
    const seen: string[] = [];
    await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
    await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
    page.on('request', (r: any) => { if (s.api.test(r.url())) seen.push(decodeURIComponent(r.url())); });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(s.path);

    const bar = page.locator('form.mexa-titlebar');
    // the filters are in the title bar, or in their own form just under it (Alarm Report, Operator Performance)
    const filters = page.locator('form.mexa-titlebar, form.mexa-filters');
    await expect(bar.getByRole('heading', { name: s.title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
    await expect.poll(() => seen.length).toBeGreaterThan(0);

    // a dropdown choice asks for the data with it
    const [label, option, param] = s.select;
    await expect(filters.getByLabel(label, { exact: true }).locator('option', { hasText: option })).toHaveCount(1);
    const before = seen.length;
    await filters.getByLabel(label, { exact: true }).selectOption({ label: option });
    await expect.poll(() => seen.slice(before).some(u => u.includes(param))).toBe(true);

    // so does a date
    if (s.date) {
      const at = seen.length;
      await filters.getByLabel(s.date, { exact: true }).fill(day(2));
      await expect.poll(() => seen.slice(at).some(u => u.includes(day(2)))).toBe(true);
      // with the dropdown choice still in it
      expect(seen.at(-1)).toContain(param);
    }
  });
}

test('quick changes ask once, with the last choice', async ({ authedPage: page }) => {
  const seen: string[] = [];
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  page.on('request', (r: any) => { if (/\/api\/dashboard\/energy\?/.test(r.url())) seen.push(r.url()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/energy-dashboard');
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  await page.waitForTimeout(700);

  const before = seen.length;
  const machine = page.locator('form.mexa-titlebar').getByLabel('Machine', { exact: true });
  await machine.selectOption({ label: 'CNC-01' });
  await machine.selectOption({ label: 'CNC-02' });
  await expect.poll(() => seen.length).toBeGreaterThan(before);
  await page.waitForTimeout(700);
  const after = seen.slice(before);
  expect(after).toHaveLength(1);
  expect(after[0]).toContain('machine_id=2');
});

test('while it loads, the title bar says Updating…', async ({ authedPage: page }) => {
  let release: () => void = () => {};
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  let first = true;
  await page.route('**/api/dashboard/oee?*', async (r: any) => {
    if (first) { first = false; return r.fulfill(json({ status: 'success', data: { updated_at: new Date().toISOString() } })); }
    await new Promise<void>(res => (release = res));
    return r.fulfill(json({ status: 'success', data: { updated_at: new Date().toISOString() } }));
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/oee-dashboard');
  const bar = page.locator('form.mexa-titlebar');
  await bar.getByLabel('Shift', { exact: true }).selectOption({ label: 'Shift 2' });
  await expect(bar.locator('.mexa-updated')).toContainText('Updating…');
  release();
  await expect(bar.locator('.mexa-updated')).not.toContainText('Updating…');
});
