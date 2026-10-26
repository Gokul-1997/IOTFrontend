import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Energy → High Energy Consumption by Machine (26 Oct 2026, the user): one
 * machine far ahead of the rest left the other bars tiny — their figures did
 * not fit (a smear on the smallest), the figures sat on the bars' top edge,
 * and hovering showed nothing useful. A figure now sits in the middle of its
 * bar when the bar can hold it; a bar too short shows its figure on hover,
 * anywhere along its row.
 */
const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data }) });
const TOP = [{ machine_serial_no: 'VMC - 2 - F', kwh: 233.13 }, { machine_serial_no: 'VMC - 1 - F', kwh: 32 },
  { machine_serial_no: 'VMC - 13 - M', kwh: 23.5 }, { machine_serial_no: 'VMC - 4 - F', kwh: 19.3 }, { machine_serial_no: 'HMC - 7 - F', kwh: 1.84 }];
const ENERGY = { updated_at: '2026-10-26T10:30:00.000Z', currency: 'INR', rate_per_kwh: 10.95,
  kpis: { total_kwh: 309.77, total_operating_seconds: 475200, total_produced: 1256, kwh_per_part: 0.25, total_cost: 3392,
          avg_voltage: null, avg_current: null, kwh_vs_yesterday_pct: 2.5, overload_alerts: 0, overload_top: null },
  coverage: { machines: 5, reporting: 5, tariff_configured: true, note: '' },
  trend: Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-${String(20 + i).padStart(2, '0')}T00:00:00.000Z`, kwh: 40 + i, machines: 5 })),
  by_shift: [{ shift_name: 'Shift 1', kwh: 200 }, { shift_name: 'Shift 2', kwh: 109.77 }],
  by_month: [{ month: '2026-10-01T00:00:00.000Z', kwh: 309.77 }],
  top_consumers: TOP, overloads: [], machines: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 } };

async function openChart(page: any, body: any = ENERGY) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.routeWebSocket(/.*/, (ws: any) => ws.close());
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
  await page.route('**/api/dashboard/energy/meter*', (r: any) => r.fulfill(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, (r: any) => r.fulfill(ok(body)));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/energy-dashboard');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'High Energy Consumption by Machine (kWh)' }) });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.apexcharts-bar-area')).toHaveCount(5);
  return card;
}

test('a figure sits in the middle of a bar that can hold it; a tiny bar shows none', async ({ page }) => {
  const card = await openChart(page);
  const figures = card.locator('.apexcharts-datalabel');
  await expect(figures.filter({ hasText: '233.13' })).toHaveCount(1);
  await expect(figures.filter({ hasText: '1.84' })).toHaveCount(0);           // ~4 px of bar: on hover only

  const first = card.locator('.apexcharts-bar-area').first();
  await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(400);   // grown in
  const bar = (await first.boundingBox())!;
  const label = (await figures.filter({ hasText: '233.13' }).boundingBox())!;
  expect(Math.abs((label.y + label.height / 2) - (bar.y + bar.height / 2))).toBeLessThan(3);   // centred, not on the top edge
  expect(label.x).toBeGreaterThan(bar.x);
  expect(label.x + label.width).toBeLessThan(bar.x + bar.width);
});

test('a hover anywhere along a row shows that machine, with its kWh — the tiny bar too', async ({ page }) => {
  const card = await openChart(page);
  const tiny = (await card.locator('.apexcharts-bar-area').nth(4).boundingBox())!;
  expect(tiny.width).toBeLessThan(10);
  await page.mouse.move(tiny.x + tiny.width + 80, tiny.y + tiny.height / 2);  // beside the bar, on its row
  const tip = card.locator('.apexcharts-tooltip.apexcharts-active');
  await expect(tip).toContainText('HMC - 7 - F');
  await expect(tip).toContainText('1.84 kWh');
  const box = (await tip.boundingBox())!, chart = (await card.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(chart.y);                               // inside the card, not cut off at its top

  const big = (await card.locator('.apexcharts-bar-area').first().boundingBox())!;
  await page.mouse.move(big.x + big.width / 2, big.y + big.height / 2);
  await expect(tip).toContainText('VMC - 2 - F');
  await expect(tip).toContainText('233.13 kWh');
});

/* "This hover on every chart" (26 Oct 2026): a column chart answers a hover
   anywhere in a column too — above a short one, not only on its sliver. */
test('Energy Cost Trend: figures in the columns that hold them; a hover above a short column shows that day', async ({ page }) => {
  await openChart(page, { ...ENERGY, trend: [{ day: '2026-10-24T00:00:00.000Z', kwh: 400, machines: 5 },
    { day: '2026-10-25T00:00:00.000Z', kwh: 2, machines: 5 }, { day: '2026-10-26T00:00:00.000Z', kwh: 30, machines: 5 }] });
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Energy Cost Trend' }) });
  await card.scrollIntoViewIfNeeded();
  const columns = card.locator('.apexcharts-bar-area');
  await expect(columns).toHaveCount(3);
  await expect.poll(async () => (await columns.first().boundingBox())!.height).toBeGreaterThan(100);   // grown in
  const short = (await columns.nth(1).boundingBox())!;
  expect(short.height).toBeLessThan(5);
  // the column charts too (26 Oct 2026): a figure in the middle of a column that can hold it, none on a sliver
  const figures = card.locator('.apexcharts-datalabel');
  await expect(figures.filter({ hasText: '₹4,380' })).toHaveCount(1);
  await expect(figures.filter({ hasText: '₹22' })).toHaveCount(0);
  const tall = (await columns.first().boundingBox())!, label = (await figures.filter({ hasText: '₹4,380' }).boundingBox())!;
  expect(Math.abs((label.y + label.height / 2) - (tall.y + tall.height / 2))).toBeLessThan(4);
  await page.mouse.move(short.x + short.width / 2, short.y - 60);             // in its column, well above it
  const tip = card.locator('.apexcharts-tooltip.apexcharts-active');
  await expect(tip).toContainText('25 Oct');
  await expect(tip).toContainText('₹22');                                      // 2 kWh × ₹10.95
});
