import { test, expect, seedAuth } from './fixtures/auth';

/*
 * A dashboard tile opens the records behind its number — the Alarm Report's
 * flow, on every dashboard with tiles and a table:
 *
 *   - a tile that counts a subset opens the details tab with the table
 *     narrowed to it (the table only: `show=` goes with the table's request),
 *     says so ("Showing … · N"), and brings the table into view and focus;
 *   - the same tile again, or "Show all", shows everything;
 *   - a tile that is not a subset (a total, a rate) opens the table as it is;
 *   - Preventive's Total Critical Alarms opens the Alarm Report, critical
 *     only, on the same dates; the OEE Dashboard's tiles open Reports →
 *     Machine OEE, ranked by the tile's figure.
 */

const json = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const meta = { success: true, data: { machines: [{ id: 1, machine_serial_no: 'CNC-01' }, { id: 2, machine_serial_no: 'CNC-02' }],
                                      shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

async function open(page: any, path: string, api: RegExp) {
  const seen: URL[] = [];
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  await page.route(api, (r: any) => {
    seen.push(new URL(r.request().url()));
    return r.fulfill(json({ status: 'success', data: { updated_at: new Date().toISOString() } }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  return seen;
}

const tableAsks = (seen: URL[]) => seen.filter(u => (u.searchParams.get('part') || '').includes('table'));

type Case = { path: string; api: RegExp; details: string; heading: string; param: string;
              narrow: [RegExp, string, RegExp][]; whole: RegExp[] };
const cases: Case[] = [
  { path: '/maintenance-report', api: /\/api\/dashboard\/maintenance-report\?/, details: 'Ticket Details', heading: 'Maintenance Tickets', param: 'show',
    narrow: [[/^Still open:/, 'open', /tickets still open/], [/^Resolved or closed:/, 'settled', /resolved and closed tickets/],
             [/^Mean time to repair:/, 'repaired', /repaired tickets/], [/^Recorded downtime:/, 'downtime', /tickets with downtime entered/]],
    whole: [/^Total tickets:/] },
  { path: '/preventive-maintenance', api: /\/api\/dashboard\/preventive\?/, details: 'PM Ticket Details', heading: 'Preventive maintenance tickets', param: 'show',
    narrow: [[/^Open PM tickets:/, 'open', /open PM tickets/], [/^Completed PM tickets:/, 'completed', /completed PM tickets/],
             [/^Average resolution time:/, 'resolved', /resolved PM tickets/], [/^Compliance:/, 'raised', /every PM ticket/]],
    whole: [] },
  { path: '/periodic-maintenance', api: /\/api\/dashboard\/periodic\?/, details: 'Maintenance Details', heading: 'Periodic Maintenance Tickets', param: 'due',
    narrow: [[/^Due today:/, 'today', /tickets due today/], [/^Overdue:/, 'overdue', /overdue tickets/], [/^Completed:/, 'completed', /completed tickets/]],
    whole: [/^Scheduled tickets:/, /^Compliance:/] },
  { path: '/operator-performance', api: /\/api\/dashboard\/operators\?/, details: 'Operator Performance Details', heading: 'Operator Performance Details', param: 'show',
    narrow: [[/^Excellent performers:/, 'excellent', /excellent performers/], [/^Good performers:/, 'good', /good performers/],
             [/^Average performers:/, 'average', /average performers/], [/^Who needs help:/, 'needs_help', /operators who need help/]],
    whole: [/^Total operators:/] },
  { path: '/energy-dashboard', api: /\/api\/dashboard\/energy\?/, details: 'Machine Detail', heading: 'Machine Detail', param: 'show',
    narrow: [[/^Overload alerts:/, 'overload', /machines over their overload limit/]],
    whole: [/^Total energy consumed:/, /^Total energy cost:/, /^Energy per part:/, /^Average voltage:/, /^Average current:/] },
  { path: '/downtime-analysis', api: /\/api\/dashboard\/downtime\?/, details: 'Downtime Details', heading: 'Downtime Details', param: 'show',
    narrow: [],
    whole: [/^Total downtime:/, /^Downtime events:/] }
];

for (const c of cases) {
  test.describe(c.path, () => {
    for (const [name, kind, label] of c.narrow) {
      test(`${name.source.slice(1, -1)} opens ${c.details} narrowed to it; again shows all`, async ({ authedPage: page }) => {
        const seen = await open(page, c.path, c.api);
        const tile = page.getByRole('button', { name });
        await tile.click();

        await expect(page.getByRole('tab', { name: c.details })).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => tableAsks(seen).at(-1)?.searchParams.get(c.param)).toBe(kind);
        await expect(tile).toHaveAttribute('aria-pressed', 'true');
        const line = page.locator('.mexa-drill');
        await expect(line).toContainText(label);
        // the table's heading is where the reader lands
        await expect(page.getByRole('heading', { name: c.heading, exact: false }).first()).toBeFocused();

        await tile.click();                                            // the same tile again: everything
        await expect.poll(() => tableAsks(seen).at(-1)?.searchParams.get(c.param) ?? '').toBe('');
        await expect(line).toHaveCount(0);
        await expect(tile).toHaveAttribute('aria-pressed', 'false');
      });
    }

    for (const name of c.whole) {
      test(`${name.source.slice(1, -1)} opens ${c.details} as it is`, async ({ authedPage: page }) => {
        const seen = await open(page, c.path, c.api);
        await page.getByRole('button', { name }).click();
        await expect(page.getByRole('tab', { name: c.details })).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => tableAsks(seen).length).toBeGreaterThan(0);
        expect(tableAsks(seen).at(-1)!.searchParams.get(c.param)).toBeNull();
        await expect(page.locator('.mexa-drill')).toHaveCount(0);
      });
    }
  });
}

test('Show all clears a tile\'s narrowing and stays on the table', async ({ authedPage: page }) => {
  const seen = await open(page, '/maintenance-report', /\/api\/dashboard\/maintenance-report\?/);
  await page.getByRole('button', { name: /^Still open:/ }).click();
  await expect.poll(() => tableAsks(seen).at(-1)?.searchParams.get('show')).toBe('open');
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect.poll(() => tableAsks(seen).at(-1)?.searchParams.get('show') ?? '').toBe('');
  await expect(page.getByRole('tab', { name: 'Ticket Details' })).toHaveAttribute('aria-selected', 'true');
});

test('the (i) on a tile still opens its definition, not the table', async ({ authedPage: page }) => {
  const seen = await open(page, '/maintenance-report', /\/api\/dashboard\/maintenance-report\?/);
  const tile = page.locator('.mexa-kpi', { hasText: 'Mean Time to Repair' });
  await tile.getByRole('button', { name: /What is/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Charts' })).toHaveAttribute('aria-selected', 'true');
  expect(tableAsks(seen)).toHaveLength(0);
});

test('a click anywhere on a tile opens it, not just on the number', async ({ authedPage: page }) => {
  const seen = await open(page, '/operator-performance', /\/api\/dashboard\/operators\?/);
  const tile = page.locator('.mexa-kpi', { hasText: 'Who Needs Help' });
  const box = (await tile.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + box.height - 10);   // the tile's corner, away from the number
  await expect.poll(() => tableAsks(seen).at(-1)?.searchParams.get('show')).toBe('needs_help');
});

test('Preventive: Total Critical Alarms opens the Alarm Report, critical only, on the same dates and machine', async ({ authedPage: page }) => {
  const alarmAsks: URL[] = [];
  await open(page, '/preventive-maintenance', /\/api\/dashboard\/preventive\?/);
  await page.route(/\/api\/dashboard\/alarms\?/, (r: any) => {
    alarmAsks.push(new URL(r.request().url()));
    return r.fulfill(json({ status: 'success', data: { updated_at: new Date().toISOString() } }));
  });
  const from = await page.locator('#pvFrom').inputValue();
  await page.locator('#pvMachine').selectOption({ label: 'CNC-02' });

  await page.getByRole('button', { name: /^Total critical alarms:/ }).click();
  await expect(page).toHaveURL(/\/alarm-report\?view=details$/);   // taken, then dropped from the address
  await expect(page.getByRole('tab', { name: 'Alarms Details' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => alarmAsks.find(u => (u.searchParams.get('part') || '').includes('table'))?.searchParams.get('show')).toBe('critical');
  const ask = alarmAsks.at(-1)!;
  expect(ask.searchParams.get('from')).toBe(from);
  expect(ask.searchParams.get('machine_id')).toBe('2');
  await expect(page.locator('.mexa-drill')).toContainText('critical alarms only');
});

test('Preventive: without the Alarm Report, Total Critical Alarms is a plain number', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-preventive:view'], company_permissions: [] });
  await open(page, '/preventive-maintenance', /\/api\/dashboard\/preventive\?/);
  await expect(page.getByRole('button', { name: /^Total critical alarms:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open PM tickets:/ })).toBeVisible();
});

test('OEE Dashboard: a tile opens Reports → Machine OEE on the same dates, ranked by its figure', async ({ authedPage: page }) => {
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill(json(meta)));
  await page.route(/\/api\/dashboard\/oee\?/, (r: any) => r.fulfill(json({ status: 'success', data: {
    updated_at: new Date().toISOString(),
    kpis: { oee_pct: 61, availability_pct: 80, performance_pct: 78, quality_pct: 98, produced: 10, good: 9, rejected: 1, idle_seconds: 100 },
    thresholds: { good: 85, fair: 60 },
    machines: { data: [
      { machine_id: 1, machine_serial_no: 'CNC-01', status: 'RUNNING', availability_pct: 90, performance_pct: 70, quality_pct: 99, oee_pct: 62 },
      { machine_id: 2, machine_serial_no: 'CNC-02', status: 'IDLE', availability_pct: 60, performance_pct: 90, quality_pct: 97, oee_pct: 52 }
    ], total: 2, page: 1, limit: 200, totalPages: 1 }
  } })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oee-dashboard');
  const from = await page.locator('.mexa-titlebar input[type="date"]').first().inputValue();

  await page.getByRole('button', { name: /^Average availability:/ }).click();
  await expect(page).toHaveURL(/\/reports\?.*tab=machine-oee/);
  await expect(page.getByRole('tab', { name: /Machine OEE/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
  // ranked by availability, highest first
  const table = page.locator('app-machine-oee-report .mexa-table');
  await expect(table.locator('th[aria-sort="descending"]')).toContainText('Availability');
  await expect(table.locator('tbody tr').first()).toContainText('CNC-01');
});
