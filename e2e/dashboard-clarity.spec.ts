import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The dashboards read at a glance (6 Oct 2026): a figure and at most one
 * short line, the definitions behind an (i), and every switch on a page —
 * a tab, Top 5 / Bottom 5, Day / Week / Month, All / Top 5 / Bottom 5 —
 * working on the figures already loaded, so it asks the server for nothing.
 */

const ok = (data: any) => ({ status: 'success', data });
const json = (body: any) => (route: any) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubAll(page: any) {
  await page.route('**/api/**', json({ status: 'success', success: true, data: [] }));
}

/* ── Operator Performance ── */

const person = (id: number, name: string, value: number, extra: any = {}) =>
  ({ operator_id: id, operator_name: name, value, availability_pct: 90, efficiency_pct: 80, quality_rate_pct: 97, oee_pct: 70, ...extra });

const operators = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  attribution: { operators: 6, shared_machines: 1, note: 'Machines with more than one assigned operator appear in each of their rows.' },
  oee_coverage: { machines: 6, with_cycle_time: 4 },
  score_bands: { excellent: 75, good: 60, average: 45 },
  bands: { excellent: 2, good: 2, average: 1, needs_help: 1, unrated: 0 },
  leaders: {
    score: {
      top: [person(1, 'Kumar', 91), person(2, 'Ramesh', 84), person(3, 'Suresh', 77), person(4, 'Niraj', 66), person(5, 'Arun', 52)],
      bottom: [person(6, 'Vijay', 31), person(5, 'Arun', 52), person(4, 'Niraj', 66), person(3, 'Suresh', 77), person(2, 'Ramesh', 84)]
    },
    rejection: {
      top: [person(6, 'Vijay', 12.5), person(4, 'Niraj', 6.1)],
      bottom: [person(1, 'Kumar', 0.4), person(2, 'Ramesh', 1.2)]
    },
    downtime: {
      top: [person(3, 'Suresh', 22_800), person(5, 'Arun', 6 * 3600 + 20 * 60)],
      bottom: [person(1, 'Kumar', 1800)]
    },
    oee: { top: [person(1, 'Kumar', 85, { oee_pct: 85 })], bottom: [person(6, 'Vijay', 22, { oee_pct: 22 })] }
  },
  operator_list: [],
  operators: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 }
});

test.describe('Operator Performance: one ranking card', () => {
  test('Score, Rejection Rate and Downtime are tabs of one card; switching asks the server for nothing', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await stubAll(page);
    await page.route('**/api/dashboard/operators*', json(operators));
    page.on('request', (r: any) => { if (r.url().includes('/api/dashboard/operators')) asked.push(r.url()); });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/operator-performance');

    const card = page.getByRole('region', { name: 'Operator ranking' });
    const tabs = card.getByRole('tablist', { name: 'Rank operators by' }).getByRole('tab');
    await expect(tabs).toHaveText(['Operator Score', 'Rejection Rate', 'Downtime Contribution'], { useInnerText: true });
    await expect(tabs.nth(2)).toHaveAccessibleName('Downtime Contribution');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    // the three old cards are gone; the OEE card stays on its own
    await expect(page.getByRole('heading', { name: 'Rejection Rate' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^OEE/ })).toBeVisible();
    // one chart in the card, whatever the tab
    await expect(card.locator('apx-chart')).toHaveCount(1);
    await expect(card.locator('.apexcharts-yaxis-label tspan').first()).toHaveText('Kumar');
    await expect.poll(() => asked.length).toBe(1);

    await card.getByRole('button', { name: 'Bottom 5' }).click();
    await expect(card.locator('.apexcharts-yaxis-label tspan').first()).toHaveText('Vijay');

    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(card.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'opTab-rejection');
    await expect(card.locator('apx-chart')).toHaveCount(1);
    await expect(card.locator('.apexcharts-yaxis-label tspan').first()).toHaveText('Vijay');
    await expect(card.locator('.apexcharts-datalabel').first()).toHaveText('12.5%');
    // each tab keeps its own half
    await expect(card.getByRole('button', { name: 'Top 5' })).toHaveAttribute('aria-pressed', 'true');

    await tabs.nth(2).click();
    await expect(card.locator('.apexcharts-datalabel').first()).toHaveText('6 h 20 m');

    await tabs.nth(0).click();
    await expect(card.getByRole('button', { name: 'Bottom 5' })).toHaveAttribute('aria-pressed', 'true');

    await page.waitForTimeout(300);
    expect(asked, 'a tab or Top 5 / Bottom 5 must not reload the page').toHaveLength(1);
  });

  test('a phone shows the short names, and the tabs keep their full names', async ({ authedPage: page }) => {
    await stubAll(page);
    await page.route('**/api/dashboard/operators*', json(operators));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/operator-performance');
    const tabs = page.getByRole('region', { name: 'Operator ranking' }).getByRole('tab');
    await expect(tabs).toHaveText(['Score', 'Rejection', 'Downtime'], { useInnerText: true });
    await expect(tabs.nth(1)).toHaveAccessibleName('Rejection Rate');
    // the strip fits the card: nothing cut off at either end
    const fits = await page.locator('.mexa-cardtabs').evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
  });

  test('the tabs follow the arrow keys, and the (i) explains the tab on show', async ({ authedPage: page }) => {
    await stubAll(page);
    await page.route('**/api/dashboard/operators*', json(operators));
    await page.goto('/operator-performance');
    const card = page.getByRole('region', { name: 'Operator ranking' });
    const tabs = card.getByRole('tab');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(tabs.first()).toHaveAttribute('tabindex', '-1');

    await card.getByRole('button', { name: 'What is Rejection rate?' }).click();
    await expect(page.getByRole('dialog', { name: 'Rejection rate' })).toContainText('(Rejected + Rework) ÷ Parts made');
  });

  test('explanations sit behind (i), not in lines of text', async ({ authedPage: page }) => {
    await stubAll(page);
    await page.route('**/api/dashboard/operators*', json(operators));
    await page.goto('/operator-performance');
    await expect(page.getByRole('region', { name: 'Operator ranking' })).toBeVisible();
    await expect(page.locator('.mexa-card-hint')).toHaveCount(0);
    await expect(page.getByText('appear in each of their rows')).toHaveCount(0);
    // the cycle-time gap: one line, the count, and an (i)
    const note = page.locator('.mexa-note-warn');
    await expect(note).toContainText('2 of 6 running machines have no cycle time');
    await expect(note.getByRole('button', { name: /^What is/ })).toBeVisible();
    // the operator list, and the (i) on it, are on the Operator Performance Details tab
    await page.getByRole('tab', { name: 'Operator Performance Details' }).click();
    await expect(page.getByRole('button', { name: 'What is Operator rows?' })).toBeVisible();
    await expect(page.locator('.mexa-card-hint')).toHaveCount(0);
    await expect(page.getByText('appear in each of their rows')).toHaveCount(0);
  });
});

/* ── Energy ── */

const energy = (over: any = {}) => ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  currency: 'INR',
  rate_per_kwh: 10.95,
  kpis: { total_kwh: 1248.6, total_operating_seconds: 475200, total_produced: 12560, kwh_per_part: 0.099,
          total_cost: 13672.17, avg_voltage: null, avg_current: null, kwh_vs_yesterday_pct: 12.5,
          overload_alerts: 0, overload_top: null },
  coverage: { machines: 5, reporting: 5, tariff_configured: true, note: '' },
  trend: Array.from({ length: 14 }, (_, i) => ({ day: `2026-06-${String(5 + i).padStart(2, '0')}T00:00:00.000Z`, kwh: 80 + i, machines: 5 })),
  by_shift: [{ shift_name: 'Day Shift', kwh: 700 }, { shift_name: 'Night Shift', kwh: 548.6 }],
  by_month: [{ month: '2026-06-01T00:00:00.000Z', kwh: 1248.6 }],
  top_consumers: [{ machine_serial_no: 'VMC-1', kwh: 525.6 }, { machine_serial_no: 'VMC-2', kwh: 445.5 }],
  overloads: [],
  machines: { data: [{ machine_serial_no: 'VMC-1', model: 'VL850', kwh: 525.6, run_seconds: 95040, produced: 2512,
                       kwh_per_part: 0.209, cost: 5755, peak_kw: 15.2, overload_kw: null, is_overloaded: false }],
              total: 1, page: 1, limit: 20, totalPages: 1 },
  ...over
});

async function openEnergy(page: any, body: any, asked: string[] = []) {
  await stubAll(page);
  await page.route('**/api/dashboard/energy/meter*', json(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, json(body));
  page.on('request', (r: any) => { if (/\/api\/dashboard\/energy(\?|$)/.test(r.url())) asked.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/energy-dashboard');
  await expect(page.locator('.mexa-kpi')).toHaveCount(6);
}

test.describe('Energy: read at a glance', () => {
  test('each tile is a figure, one short line and an (i); the list that repeated the chart is gone', async ({ authedPage: page }) => {
    await openEnergy(page, energy());
    const tile = (name: RegExp) => page.locator('.mexa-kpi').filter({ hasText: name });
    await expect(tile(/Total Energy\s*Cost/).locator('.mexa-kpi-value')).toHaveText('₹13,672');
    await expect(tile(/Total Energy\s*Cost/)).toContainText('₹10.95 per kWh');
    await expect(tile(/Energy\s*per Part/)).toContainText('12,560 parts');
    await expect(tile(/Average\s*Voltage/)).toContainText('Not reported');
    await expect(tile(/Overload/)).toContainText('No limit set');
    // more energy than yesterday is the bad direction
    await expect(tile(/Consumed/).locator('.mexa-delta')).toHaveClass(/mexa-delta-bad/);
    await expect(page.locator('.mexa-kpi').getByRole('button', { name: /^What is/ })).toHaveCount(6);

    await expect(page.getByRole('heading', { name: 'Highest Consumers' })).toHaveCount(0);
    await expect(page.getByText('Not reported by the devices')).toHaveCount(0);
    // no meter: no card saying so
    await expect(page.getByRole('heading', { name: 'Energy meter' })).toHaveCount(0);
  });

  test('Day, Week and Month regroup what is loaded, without a request', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await openEnergy(page, energy(), asked);
    const card = page.getByRole('region', { name: /Energy Cost Trend/ });
    await expect(card.locator('.apexcharts-bar-area')).toHaveCount(14);
    await card.getByRole('button', { name: 'Week' }).click();
    await expect(card.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.apexcharts-bar-area')).toHaveCount(3);
    await card.getByRole('button', { name: 'Month' }).click();
    await expect(card.locator('.apexcharts-bar-area')).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(1);
  });

  test('no tariff: the cost tile says so, and offers the way to set one to whoever may', async ({ authedPage: page }) => {
    const none = energy({ rate_per_kwh: null, kpis: { ...energy().data.kpis, total_cost: null },
                          coverage: { machines: 5, reporting: 5, tariff_configured: false, note: '' } });
    await openEnergy(page, none);
    const cost = page.locator('.mexa-kpi').filter({ hasText: /Total Energy\s*Cost/ });
    await expect(cost.locator('.mexa-kpi-value')).toHaveText('--');
    await expect(cost.getByRole('link', { name: 'Set tariff' })).toHaveAttribute('href', '/energy-tariff');
    await expect(page.getByRole('heading', { name: 'Energy Trend (kWh)' })).toBeVisible();
    await expect(page.locator('.mexa-note')).toHaveCount(0);
  });

  test('no tariff, for someone who cannot set it: said, with no link', async ({ page }) => {
    await seedAuth(page, { roles: ['SUPERVISOR'], permissions: ['page:analytics-energy:view'] });
    const none = energy({ rate_per_kwh: null, kpis: { ...energy().data.kpis, total_cost: null },
                          coverage: { machines: 5, reporting: 5, tariff_configured: false, note: '' } });
    await openEnergy(page, none);
    const cost = page.locator('.mexa-kpi').filter({ hasText: /Total Energy\s*Cost/ });
    await expect(cost).toContainText('No tariff set');
    await expect(cost.getByRole('link')).toHaveCount(0);
  });
});

/* ── OEE ── */

const oeeBody = (over: any = {}) => ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  thresholds: { good: 85, fair: 60 },
  kpis: { availability_pct: 50, performance_pct: 80, quality_pct: 90, oee_pct: 36, produced: 1000, good: 960, rejected: 40,
          planned_seconds: 200 * 3600, run_seconds: 100 * 3600, idle_seconds: 60 * 3600, machines_total: 3 },
  coverage: { machines: 3, with_cycle_time: 2, oee_computable: 2, note: 'Performance and OEE need a cycle time.' },
  status_counts: { RUNNING: 1, IDLE: 1, ALARM: 0, OFFLINE: 1 },
  trend: [{ day: '2026-06-17T00:00:00.000Z', oee_pct: 30, availability_pct: 50, performance_pct: 80, quality_pct: 90 },
          { day: '2026-06-18T00:00:00.000Z', oee_pct: 36, availability_pct: 50, performance_pct: 80, quality_pct: 90 }],
  machines: { data: [
    { id: 1, machine_serial_no: 'VMC-1', status: 'RUNNING', availability_pct: 60, performance_pct: 80, quality_pct: 95, oee_pct: 45.6, produced: 600 },
    { id: 2, machine_serial_no: 'VMC-2', status: 'IDLE', availability_pct: 40, performance_pct: 80, quality_pct: 85, oee_pct: 27.2, produced: 400 },
    { id: 3, machine_serial_no: 'VMC-3', status: 'OFFLINE', availability_pct: null, performance_pct: null, quality_pct: null, oee_pct: null, produced: 0 }
  ], total: 3, page: 1, limit: 200, totalPages: 1 },
  ...over
});

test.describe('OEE: see the loss, then act on it', () => {
  test('the biggest loss is named with where to look into it; definitions are behind (i)', async ({ authedPage: page }) => {
    await stubAll(page);
    await page.route(/\/api\/dashboard\/oee(\?|$)/, json(oeeBody()));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/oee-dashboard');

    const loss = page.getByRole('region', { name: /Where OEE is lost/ });
    await expect(loss.locator('.mexa-loss-verdict')).toContainText('Biggest loss: Availability');
    await loss.getByRole('link', { name: 'See downtime reasons' }).click();
    await expect(page).toHaveURL(/\/downtime-analysis$/);
  });

  test('one short line for the machines with no cycle time, and no paragraphs under titles', async ({ authedPage: page }) => {
    await stubAll(page);
    await page.route(/\/api\/dashboard\/oee(\?|$)/, json(oeeBody()));
    await page.goto('/oee-dashboard');
    await expect(page.locator('.mexa-note-warn')).toHaveText(/1 of 3 machines has no cycle time\s*— no OEE for it\./);
    await expect(page.locator('.mexa-card-hint')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'What is OEE trend?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'What is Where OEE is lost?' })).toBeVisible();
    await expect(page.getByText('Run time over planned time')).toHaveCount(0);
    await expect(page.getByText('Machines on, not running')).toHaveCount(0);
  });

  test('All, Top 5 and Bottom 5 use the machines already loaded', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await stubAll(page);
    await page.route(/\/api\/dashboard\/oee(\?|$)/, json(oeeBody()));
    page.on('request', (r: any) => { if (/\/api\/dashboard\/oee(\?|$)/.test(r.url())) asked.push(r.url()); });
    await page.goto('/oee-dashboard');
    const views = page.getByRole('group', { name: 'Machines to show' });
    await expect(page.locator('.mexa-oeecard')).toHaveCount(3);
    await views.getByRole('button', { name: 'Bottom 5' }).click();
    await expect(page.locator('.mexa-oeecard-name')).toHaveText(['VMC-2', 'VMC-1']);
    await views.getByRole('button', { name: 'Top 5' }).click();
    await expect(page.locator('.mexa-oeecard-name')).toHaveText(['VMC-1', 'VMC-2']);
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(1);
  });
});
