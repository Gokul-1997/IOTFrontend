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
 * The tile grid with a real fleet.
 *
 * Production has 20 active machines for the main company (the service returns
 * all 20 in one page), which is most of a screen of tiles before the first
 * chart. The grid opens compact and says how much it is holding back — a
 * "show more" that does not name its count leaves you unable to tell a
 * collapsed list from a short one.
 */
test('the machine cards go five to a page, as the design shows them', async ({ authedPage: page }) => {
  const fleet = Array.from({ length: 20 }, (_, i) => {
    const pct = 95 - i * 3;
    return machine(`VMC-${String(i + 1).padStart(2, '0')}`, pct,
                   pct >= 85 ? 'GOOD' : pct >= 60 ? 'FAIR' : 'POOR');
  });
  const twenty = ok({ ...oee.data, machines: { data: fleet, total: 20, page: 1, limit: 200, totalPages: 1 } });

  await page.route('**/api/**', (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'success', success: true, data: [] }) }));
  await page.route('**/api/charts/meta*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
  await page.route('**/api/dashboard/oee*', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(twenty) }));

  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/oee-dashboard');
  await expect(page.locator('.mexa-kpi').first()).toBeVisible();

  await expect(page.locator('.mexa-oeecard')).toHaveCount(5);
  await expect(page.getByText('Total Machines 20')).toBeVisible();
  // the four grades of the design, on each card's own OEE
  await expect(page.locator('.mexa-oeecard').first()).toHaveClass(/mexa-grade-excellent/);
  const pages = page.getByRole('navigation', { name: 'Machine pages' });
  await pages.getByRole('button', { name: '4', exact: true }).click();
  await expect(page.locator('.mexa-oeecard').first()).toContainText('VMC-16');
  await expect(page.locator('.mexa-oeecard').first()).toHaveClass(/mexa-grade-poor/);
});
