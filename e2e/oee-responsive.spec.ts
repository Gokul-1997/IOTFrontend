import { test, expect } from './fixtures/auth';

/*
 * The OEE dashboard on a phone, and in dark mode.
 *
 * Both are shipped features — the header carries a theme toggle, and the
 * design system defines a full dark palette — but neither was covered by a
 * test, so a card that overflows sideways or axis text that goes invisible
 * on a dark surface would reach production unnoticed.
 */

const ok = (data: any) => ({ status: 'success', data });

const machine = (serial: string, oee: number | null, band: string) => ({
  machine_serial_no: serial, model: 'VMC', status: 'RUNNING', band,
  availability_pct: 92, performance_pct: 87, quality_pct: 96, oee_pct: oee,
  produced: 400, good: 380, rejected: 20, alarm_count: 3,
  downtime_seconds: 1800, has_cycle_time: oee !== null
});

const oee = ok({
  updated_at: '2026-06-18T10:30:00.000Z',
  thresholds: { good: 85, fair: 60 },
  kpis: { oee_pct: 82.35, availability_pct: 89.21, performance_pct: 88.11, quality_pct: 95.62,
          produced: 12560, good: 12000, rejected: 560, run_seconds: 66600, idle_seconds: 18720,
          downtime_seconds: 71100, alarm_count: 62, band: 'FAIR',
          machines_measurable: 18, machines_total: 20 },
  coverage: { machines: 20, with_cycle_time: 18, oee_computable: 18,
              note: 'Two machines have no cycle time, so their performance cannot be computed.' },
  status_counts: { RUNNING: 16, IDLE: 2, ALARM: 1, OFFLINE: 1 },
  trend: Array.from({ length: 6 }, (_, i) => ({ day: `2026-06-${13 + i}T00:00:00.000Z`, availability_pct: 35 + i * 9 })),
  top_machines: [], bottom_machines: [],
  machines: {
    data: [machine('CNC-01', 85, 'GOOD'), machine('CNC-02', 75, 'FAIR'),
           machine('CNC-03', 50, 'POOR'), machine('CNC-04', null, 'UNKNOWN')],
    total: 4, page: 1, limit: 20, totalPages: 1
  }
});

const meta = { success: true, data: {
  machines: [{ id: 1, machine_serial_no: 'CNC-01' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

async function mockApi(page: any) {
  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oee) }));
}

test('fits a phone without scrolling sideways', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oee-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await page.waitForTimeout(1200);

  /* The page body must never scroll horizontally. A chart or a table may,
     inside its own container — the body may not. */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);

  // and no individual card may stick out past the viewport
  const widest = await page.evaluate(() => Math.max(
    ...Array.from(document.querySelectorAll('.mexa-card, .mexa-kpi'))
      .map(el => Math.round(el.getBoundingClientRect().right))));
  expect(widest).toBeLessThanOrEqual(390);

  await page.screenshot({ path: 'mexa-oee-mobile.png', fullPage: true });
});

test('chart text stays legible on the dark surface', async ({ authedPage: page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/oee-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();
  await page.waitForTimeout(1500);

  /* The header toggles the theme by putting `dark` on <html>; do the same,
     then confirm below that the surface actually changed — otherwise this
     test passes against a light page and proves nothing. */
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(400);

  /* Relative luminance of the axis text against its card. ApexCharts paints
     axis labels a fixed dark grey; on a dark card that is near-invisible,
     and no amount of token work in the stylesheet changes an SVG fill. */
  const report = await page.evaluate(() => {
    const text = document.querySelector('.apexcharts-xaxis text, .apexcharts-yaxis text') as SVGTextElement | null;
    const card = document.querySelector('.mexa-card') as HTMLElement | null;
    if (!text || !card) return null;
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const tl = lum(getComputedStyle(text).fill);
    const cl = lum(getComputedStyle(card).backgroundColor);
    const ratio = (Math.max(tl, cl) + 0.05) / (Math.min(tl, cl) + 0.05);
    return { fill: getComputedStyle(text).fill, card: getComputedStyle(card).backgroundColor, ratio };
  });

  await page.screenshot({ path: 'mexa-oee-dark.png', fullPage: true });
  console.log('dark-mode axis text:', JSON.stringify(report));
  expect(report, 'no chart text found').not.toBeNull();
  expect(report!.card, 'dark mode did not apply — this test would prove nothing')
    .not.toBe('rgb(255, 255, 255)');
  // WCAG 1.4.3 for incidental/small text — 4.5:1
  expect(report!.ratio, `axis text ${report!.fill} on card ${report!.card}`).toBeGreaterThanOrEqual(4.5);

  /* The filter controls set `background: #fff` outright while taking their
     text colour from --mexa-ink, which flips to near-white in dark mode —
     light text on a white box. */
  const control = await page.evaluate(() => {
    const el = document.querySelector('.mexa-select') as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(cs.color), b = lum(cs.backgroundColor);
    return { color: cs.color, bg: cs.backgroundColor,
             ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  console.log('dark-mode filter control:', JSON.stringify(control));
  expect(control, 'no filter control found').not.toBeNull();
  expect(control!.ratio, `filter text ${control!.color} on ${control!.bg}`).toBeGreaterThanOrEqual(4.5);
});


/*
 * The tile grid with a real fleet: every machine, ten to a page, ranked best
 * first, with the design's Top 5 / Bottom 5 as views of the same tiles. (It
 * was five solid-colour cards to a page beside a chart repeating the same
 * five machines; on the real fleet every card was the same alarm red.)
 */
test('every machine, ten to a page, with Top 5 and Bottom 5', async ({ authedPage: page }) => {
  // VMC-01 95% down to VMC-18 44%; VMC-19 and VMC-20 have no cycle time
  const fleet = Array.from({ length: 20 }, (_, i) => {
    const pct = i >= 18 ? null : 95 - i * 3;
    return machine(`VMC-${String(i + 1).padStart(2, '0')}`, pct, 'X');
  });
  const twenty = ok({ ...oee.data, machines: { data: fleet, total: 20, page: 1, limit: 200, totalPages: 1 } });

  await mockApi(page);
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(twenty) }));
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/oee-dashboard');

  const tiles = page.locator('.mexa-oeecard');
  const names = page.locator('.mexa-oeecard-name');
  await expect(tiles).toHaveCount(10);
  await expect(page.getByText('Total Machines 20')).toBeVisible();
  // the design's four grades, on each tile's own OEE, and a status on each
  await expect(tiles.first()).toHaveClass(/mexa-grade-excellent/);
  await expect(tiles.first()).toContainText('Running');
  await expect(tiles.first()).toHaveClass(/mexa-oeecard-tint/);

  await page.getByRole('navigation', { name: 'Machine pages' }).getByRole('button', { name: '2', exact: true }).click();
  await expect(tiles.first()).toContainText('VMC-11');
  await expect(tiles.first()).toHaveClass(/mexa-grade-avg/);        // 65%
  await expect(tiles.nth(5)).toHaveClass(/mexa-grade-poor/);        // VMC-16, 50%
  await expect(tiles.last()).toContainText('No cycle time');

  const views = page.getByRole('group', { name: 'Machines to show' });
  await views.getByRole('button', { name: 'Top 5' }).click();
  await expect(views.getByRole('button', { name: 'Top 5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(names).toHaveText(['VMC-01', 'VMC-02', 'VMC-03', 'VMC-04', 'VMC-05']);
  await expect(page.getByRole('navigation', { name: 'Machine pages' })).toHaveCount(0);

  // worst first, and a machine with no cycle time is not ranked as the worst
  await views.getByRole('button', { name: 'Bottom 5' }).click();
  await expect(names).toHaveText(['VMC-18', 'VMC-17', 'VMC-16', 'VMC-15', 'VMC-14']);

  await views.getByRole('button', { name: /All 20/ }).click();
  await expect(tiles).toHaveCount(10);
  await expect(tiles.first()).toContainText('VMC-01');
});

/* OEE = A × P × Q, so planned time splits into good output and three
   losses that always add to 100 — and the biggest is named. */
test('where OEE is lost adds up to 100 and names the biggest loss', async ({ authedPage: page }) => {
  const fleet = ok({ ...oee.data, kpis: { ...oee.data.kpis,
    availability_pct: 50, performance_pct: 80, quality_pct: 90, oee_pct: 36, rejected: 40,
    planned_seconds: 200 * 3600, run_seconds: 100 * 3600, idle_seconds: 60 * 3600 } });
  await mockApi(page);
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fleet) }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/oee-dashboard');

  const panel = page.getByRole('region', { name: 'Where OEE is lost' });
  const rows = panel.locator('.mexa-losslist li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('36.0%');
  await expect(rows.nth(1)).toContainText('50.0 pts');   // 1 − 0.5
  await expect(rows.nth(2)).toContainText('10.0 pts');   // 0.5 × 0.2
  await expect(rows.nth(3)).toContainText('4.0 pts');    // 0.5 × 0.8 × 0.1
  // the two hour figures on the page, reconciled
  await expect(rows.nth(1)).toContainText('100 h 0 m (60 h 0 m idle, 40 h 0 m off or not reporting)');
  await expect(rows.nth(1)).toHaveClass(/is-biggest/);
  await expect(panel.locator('.mexa-loss-verdict')).toContainText('Biggest loss: Availability');
  await expect(panel.locator('.mexa-loss-verdict')).toContainText('not running for 50% of their planned time');
});

test('the loss panel says what it needs when OEE cannot be computed', async ({ authedPage: page }) => {
  const none = ok({ ...oee.data, kpis: { ...oee.data.kpis, performance_pct: null, oee_pct: null } });
  await mockApi(page);
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(none) }));
  await page.goto('/oee-dashboard');
  const panel = page.getByRole('region', { name: 'Where OEE is lost' });
  await expect(panel).toContainText('Needs a machine with a cycle time');
  await expect(panel.locator('.mexa-lossbar')).toHaveCount(0);
});

test('fleet downtime reads in hours and minutes, not a 4-digit HH:MM:SS', async ({ authedPage: page }) => {
  const week = ok({ ...oee.data, kpis: { ...oee.data.kpis, idle_seconds: 1594 * 3600 + 14 * 60 + 50 } });
  await mockApi(page);
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(week) }));
  await page.goto('/oee-dashboard');
  const card = page.locator('.mexa-kpi').filter({ hasText: 'Downtime' });
  await expect(card.locator('.mexa-kpi-value')).toHaveText('1,594 h 14 m');
  await expect(card.locator('.mexa-kpi-value')).toHaveAttribute('title', '1594:14:50 (HH:MM:SS)');
});

test('the trend draws OEE against the target, with its three factors', async ({ authedPage: page }) => {
  const days = Array.from({ length: 5 }, (_, i) => ({ day: `2026-06-${13 + i}T00:00:00.000Z`,
    oee_pct: 20 + i, availability_pct: 30 + i, performance_pct: 80, quality_pct: 100 }));
  await mockApi(page);
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(ok({ ...oee.data, trend: days })) }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/oee-dashboard');
  const trend = page.getByRole('region', { name: 'OEE Trend' });
  await expect(trend.locator('.apexcharts-legend-text')).toHaveText(['OEE', 'Availability', 'Performance', 'Quality']);
  await expect(trend.getByText('Target 85%')).toBeVisible();
});
