import { test, expect } from './fixtures/auth';

/*
 * Every dashboard with both charts and tables shows them on separate tabs —
 * Charts, and the page's details (its tables) — under the KPI tiles both
 * share. The API serves the page in three parts (`part=` kpis, charts,
 * table), and a part is asked for only while it is on screen and out of date:
 *
 *   - the page opens on Charts and asks for the tiles and the charts alone —
 *     no table, and none of the lists only the details tab shows (the alarm
 *     rules and the maintenance plan load when their buttons open them);
 *   - the details tab asks for its table once; back to Charts asks nothing;
 *   - a filter changed on the details tab loads the tiles and the table, and
 *     the charts follow, once, when Charts is next opened;
 *   - ?view=details opens on the details tab (a reload keeps the tab);
 *   - the tabs follow the arrow keys, and on a phone the open one stays in view.
 */

const json = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'CNC-01' }, { id: 2, machine_serial_no: 'CNC-02' }],
    shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }]
  }
};

type Screen = { path: string; title: string; api: RegExp; machine: string; details: string; tabs: RegExp[] };
const screens: Screen[] = [
  { path: '/alarm-report',           title: 'Alarm Report Dashboard',           api: /\/api\/dashboard\/alarms\?/,             machine: '#alMachine',
    details: 'Alarms Details',               tabs: [/Charts/, /Alarms Details/] },
  { path: '/downtime-analysis',      title: 'Downtime Reason Analysis',         api: /\/api\/dashboard\/downtime\?/,           machine: '#dtMachine',
    details: 'Downtime Details',             tabs: [/Charts/, /Downtime Details/] },
  { path: '/energy-dashboard',       title: 'Energy Dashboard',                 api: /\/api\/dashboard\/energy\?/,             machine: '#enMachine',
    details: 'Machine Detail',               tabs: [/Charts/, /Machine Detail/, /Energy Meter/] },
  { path: '/maintenance-report',     title: 'Maintenance Report',               api: /\/api\/dashboard\/maintenance-report\?/, machine: '#mrMachine',
    details: 'Ticket Details',               tabs: [/Charts/, /Ticket Details/] },
  { path: '/operator-performance',   title: 'Operator Performance Dashboard',   api: /\/api\/dashboard\/operators\?/,          machine: '#opMachine',
    details: 'Operator Performance Details', tabs: [/Charts/, /Operator Performance Details/] },
  { path: '/periodic-maintenance',   title: 'Periodic Maintenance Dashboard',   api: /\/api\/dashboard\/periodic\?/,           machine: '#peMachine',
    details: 'Maintenance Details',          tabs: [/Charts/, /Maintenance Details/] },
  { path: '/preventive-maintenance', title: 'Preventive Maintenance Dashboard', api: /\/api\/dashboard\/preventive\?/,         machine: '#pvMachine',
    details: 'PM Ticket Details',            tabs: [/Charts/, /PM Ticket Details/] }
];

const partOf = (url: string) => new URL(url).searchParams.get('part');

async function open(page: any, s: Screen, path = s.path, width = 1440) {
  const seen: string[] = [];
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  await page.route(s.api, (r: any) => {
    seen.push(decodeURIComponent(r.request().url()));
    return r.fulfill(json({ status: 'success', data: { updated_at: new Date().toISOString() } }));
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: s.title })).toBeVisible();
  return seen;
}

for (const s of screens) {
  test.describe(s.title, () => {

    test('Charts first; the details once when opened; back to Charts asks nothing', async ({ authedPage: page }) => {
      const seen = await open(page, s);
      const tabs = page.getByRole('tablist', { name: /views$/ }).getByRole('tab');
      await expect(tabs).toHaveText(s.tabs);
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

      // the page opens on Charts and asks for the tiles and the charts alone
      await expect.poll(() => seen.length).toBe(1);
      expect(partOf(seen[0])).toBe('kpis,charts');
      await expect(page.locator('#dashPanel-charts')).toBeVisible();
      await expect(page.locator('#dashPanel-details')).toHaveCount(0);
      const tiles = page.locator('.mexa-kpi').first();
      await expect(tiles).toBeVisible();

      // the details: the table alone, once; its tables are on show, the charts are not, the tiles stay
      await page.getByRole('tab', { name: s.details }).click();
      await expect.poll(() => seen.length).toBe(2);
      expect(partOf(seen[1])).toBe('table');
      await expect(page.locator('#dashPanel-details table').first()).toBeVisible();
      await expect(page.locator('#dashPanel-charts')).toHaveCount(0);
      await expect(page.locator('apx-chart')).toHaveCount(0);
      await expect(tiles).toBeVisible();
      await expect(page).toHaveURL(/[?&]view=details/);

      // back to Charts, and to the details again: both already loaded, nothing asked
      await tabs.first().click();
      await expect(page.locator('#dashPanel-charts')).toBeVisible();
      await expect(page.locator('#dashPanel-charts table')).toHaveCount(0);
      await page.getByRole('tab', { name: s.details }).click();
      await expect(page.locator('#dashPanel-details')).toBeVisible();
      await page.waitForTimeout(400);
      expect(seen).toHaveLength(2);
      await expect(page).toHaveURL(/[?&]view=details/);
      await tabs.first().click();
      await expect(page).not.toHaveURL(/view=/);
    });

    test('a filter changed on the details loads the tiles and the table; the charts follow once, when opened', async ({ authedPage: page }) => {
      const seen = await open(page, s, `${s.path}?view=details`);
      await expect(page.getByRole('tab', { name: s.details })).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => seen.length).toBe(1);
      expect(partOf(seen[0])).toBe('kpis,table');

      await page.locator(s.machine).selectOption({ label: 'CNC-02' });
      await expect.poll(() => seen.length).toBe(2);
      expect(partOf(seen[1])).toBe('kpis,table');
      expect(seen[1]).toContain('machine_id=2');
      await page.waitForTimeout(400);
      expect(seen).toHaveLength(2);            // the hidden charts are not asked for

      await page.getByRole('tab', { name: 'Charts' }).click();
      await expect.poll(() => seen.length).toBe(3);
      expect(partOf(seen[2])).toBe('charts');  // the tiles are current already
      expect(seen[2]).toContain('machine_id=2');
      await page.getByRole('tab', { name: s.details }).click();
      await page.waitForTimeout(400);
      expect(seen).toHaveLength(3);            // the table is current for these filters
    });
  });
}

test('the tabs follow the arrow keys; Enter opens the one in focus', async ({ authedPage: page }) => {
  const seen = await open(page, screens[0]);
  const tabs = page.getByRole('tablist', { name: 'Alarm Report views' }).getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect.poll(() => seen.length).toBe(1);   // moving focus asks for nothing
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(tabs.first()).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#dashPanel-details')).toHaveAttribute('aria-labelledby', 'dashTab-details');
  await expect.poll(() => seen.length).toBe(2);
});

test('a request still on its way for older filters is dropped, the hidden tab\'s too', async ({ authedPage: page }) => {
  const seen: string[] = [];
  let release: () => void = () => {};
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  await page.route(/\/api\/dashboard\/alarms\?/, async (r: any) => {
    const url = decodeURIComponent(r.request().url());
    seen.push(url);
    // the first answer is held until the filters have changed
    if (seen.length === 1) await new Promise<void>(res => (release = res));
    const machine = new URL(url).searchParams.get('machine_id');
    return r.fulfill(json({ status: 'success', data: {
      updated_at: new Date().toISOString(),
      kpis: { total: machine === '2' ? 22 : 99 } } })).catch(() => {});
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/alarm-report');
  await expect.poll(() => seen.length).toBe(1);

  await page.locator('#alMachine').selectOption({ label: 'CNC-02' });
  await expect.poll(() => seen.length).toBe(2);
  release();
  const total = page.locator('button.mexa-kpi', { hasText: 'Total Alarms' }).locator('.mexa-kpi-value');
  await expect(total).toHaveText('22');
  await page.waitForTimeout(400);
  await expect(total).toHaveText('22');      // the older answer, landing late, changed nothing
});

test('on a phone the open tab is in view and nothing is pushed sideways', async ({ authedPage: page }) => {
  for (const [s, view] of [[screens[0], 'details'], [screens[2], 'meter'], [screens[4], 'details']] as const) {
    await open(page, s, `${s.path}?view=${view}`, 360);
    const strip = page.getByRole('tablist', { name: /views$/ });
    await expect(strip.getByRole('tab', { selected: true })).toBeVisible();
    // the strip may scroll on its own; the tab that is open sits inside what it shows
    await expect.poll(() => strip.evaluate((el: HTMLElement) => {
      const tab = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return tab.left >= box.left - 1 && (tab.right <= box.right + 1 || tab.width > box.width);
    })).toBe(true);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

/*
 * Landing asks for the filter lists and the tiles and charts — nothing that
 * only the details tab shows: not its table, and not the lists behind its
 * Alarm rules and Create Ticket buttons, which load when those are opened.
 */
const detailsOnly = /\/api\/dashboard\/preventive\/thresholds|\/api\/dashboard\/periodic\/schedules|\/api\/downtime\/reasons/;

for (const s of screens) {
  test(`${s.title}: landing asks for nothing the details tab shows`, async ({ authedPage: page }) => {
    const all: string[] = [];
    page.on('request', (r: any) => { if (r.url().includes('/api/')) all.push(decodeURIComponent(r.url())); });
    const seen = await open(page, s);
    await expect.poll(() => seen.length).toBe(1);
    await page.waitForTimeout(500);

    expect(all.filter(u => detailsOnly.test(u))).toEqual([]);
    const own = all.filter(u => s.api.test(u));
    expect(own.map(partOf)).toEqual(['kpis,charts']);
  });
}

test('Preventive: the alarm rules are asked for when shown, once', async ({ authedPage: page }) => {
  const rules: string[] = [];
  const seen = await open(page, screens[6], '/preventive-maintenance?view=details');
  await page.route('**/api/dashboard/preventive/thresholds*', (r: any) => {
    rules.push(r.request().url());
    return r.fulfill(json({ status: 'success', data: [{ id: 1, alarm_type: 'SPINDLE OVERLOAD', threshold_count: 3, window_hours: 24, due_hours: 48, priority: 'HIGH', is_active: true }] }));
  });
  await expect.poll(() => seen.length).toBe(1);
  await page.waitForTimeout(300);
  expect(rules).toHaveLength(0);

  const button = page.getByRole('button', { name: 'Alarm rules' });
  await button.click();
  await expect(page.getByRole('cell', { name: 'SPINDLE OVERLOAD' })).toBeVisible();
  expect(rules).toHaveLength(1);

  // hidden and shown again: the company's rules have not changed, nothing is asked
  await page.getByRole('button', { name: 'Hide alarm rules' }).click();
  await page.getByRole('button', { name: 'Alarm rules' }).click();
  await expect(page.getByRole('cell', { name: 'SPINDLE OVERLOAD' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(rules).toHaveLength(1);
});

test('Periodic: the plan is asked for when opened, and follows the machine while it is open', async ({ authedPage: page }) => {
  const plans: string[] = [];
  const seen = await open(page, screens[5]);
  await page.route('**/api/dashboard/periodic/schedules*', (r: any) => {
    plans.push(decodeURIComponent(r.request().url()));
    return r.fulfill(json({ status: 'success', data: [] }));
  });
  await expect.poll(() => seen.length).toBe(1);
  await page.waitForTimeout(300);
  expect(plans).toHaveLength(0);

  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(page.getByRole('heading', { name: 'Maintenance Plan' })).toBeVisible();
  await expect.poll(() => plans.length).toBe(1);
  expect(plans[0]).not.toContain('machine_id');

  await page.locator('#peMachine').selectOption({ label: 'CNC-02' });
  await expect.poll(() => plans.length).toBe(2);
  expect(plans[1]).toContain('machine_id=2');

  // away to Charts and back: the plan for this machine is loaded already
  await page.getByRole('tab', { name: 'Charts' }).click();
  await page.getByRole('tab', { name: 'Maintenance Details' }).click();
  await expect(page.getByRole('heading', { name: 'Maintenance Plan' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(plans).toHaveLength(2);
});

test('the setup notes come with the tiles: no rule or plan list is loaded to know there is none', async ({ authedPage: page }) => {
  const lists: string[] = [];
  page.on('request', (r: any) => { if (detailsOnly.test(r.url())) lists.push(r.url()); });
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  await page.route(/\/api\/dashboard\/preventive\?/, (r: any) => r.fulfill(json({ status: 'success', data: {
    updated_at: new Date().toISOString(), kpis: { rules: 0, pm_generated: 0 } } })));
  await page.route(/\/api\/dashboard\/periodic\?/, (r: any) => r.fulfill(json({ status: 'success', data: {
    updated_at: new Date().toISOString(), kpis: { plans: 0, scheduled: 0 } } })));
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/preventive-maintenance');
  await expect(page.getByText('No alarm rules yet')).toBeVisible();
  await page.goto('/periodic-maintenance');
  await expect(page.getByText('No maintenance plan yet')).toBeVisible();
  expect(lists).toEqual([]);

  // a company with rules sees no note
  await page.route(/\/api\/dashboard\/preventive\?/, (r: any) => r.fulfill(json({ status: 'success', data: {
    updated_at: new Date().toISOString(), kpis: { rules: 2, pm_generated: 0 } } })));
  await page.goto('/preventive-maintenance');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await expect(page.getByText('No alarm rules yet')).toHaveCount(0);
});
