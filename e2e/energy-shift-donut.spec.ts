import { test, expect, seedAuth } from './fixtures/auth';

/*
 * Energy → Energy by Shift (27 Nov 2026, the user: "chart decimal value show
 * big"). Hovering a shift put its unrounded figure — 751.2939999999998 — in
 * the middle of the ring, in large type, running out of it; the tooltip said
 * the same. The middle now shows at most one decimal (as the total does),
 * the tooltip the page's own Units figure, and a large one stays inside the
 * ring on a phone too.
 */
const ok = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', data }) });
const energy = (byShift: { shift_name: string; kwh: number }[]) => ({
  updated_at: '2026-11-27T10:30:00.000Z', currency: 'INR', rate_per_kwh: 10.95,
  kpis: { total_kwh: byShift.reduce((a, s) => a + s.kwh, 0), total_operating_seconds: 475200, total_produced: 1256, kwh_per_part: 0.25,
          total_cost: 3392, avg_voltage: null, avg_current: null, kwh_vs_yesterday_pct: 2.5, overload_alerts: 0, overload_top: null },
  coverage: { machines: 5, reporting: 5, tariff_configured: true, note: '' },
  trend: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${String(20 + i).padStart(2, '0')}T00:00:00.000Z`, kwh: 40 + i, cost: (40 + i) * 10.95, cost_complete: true, machines: 5 })),
  by_shift: byShift,
  by_month: [{ month: '2026-11-01T00:00:00.000Z', kwh: 1238.4, cost: 13560.48, cost_complete: true }],
  top_consumers: [{ machine_serial_no: 'VMC - 2 - F', kwh: 233.13 }], overloads: [],
  machines: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 }
});

async function openDonut(page: any, body: any, width = 1440) {
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok([])));
  await page.route('**/api/dashboard/energy/meter*', (r: any) => r.fulfill(ok({ meters: [], machine: null })));
  await page.route(/\/api\/dashboard\/energy(\?|$)/, (r: any) => r.fulfill(ok(body)));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/energy-dashboard');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Energy by Shift' }) });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.apexcharts-pie-area')).toHaveCount(2);
  // the ring draws itself in: measure it once it has stopped growing
  let last = -1;
  await expect.poll(async () => {
    const w = (await card.locator('.apexcharts-pie').first().boundingBox())?.width ?? 0;
    const settled = w > 0 && w === last; last = w; return settled;
  }, { intervals: [250] }).toBe(true);
  return card;
}

/** Hover the first shift's slice, on its outer edge. */
async function hoverFirst(page: any, card: any) {
  const slice = (await card.locator('.apexcharts-pie-area').first().boundingBox())!;
  await page.mouse.move(slice.x + slice.width * 0.85, slice.y + slice.height * 0.5);
}

test('a hovered shift shows its figure rounded, in the ring and in the tooltip', async ({ page }) => {
  const card = await openDonut(page, energy([{ shift_name: 'Shift 1', kwh: 751.2939999999998 }, { shift_name: 'Shift 2', kwh: 487.10600000000034 }]));
  const middle = card.locator('.apexcharts-datalabel-value');
  await expect(middle).toHaveText('1,238.4');                                   // the total, at rest
  await hoverFirst(page, card);
  await expect(middle).toHaveText('751.3');
  await expect(card.locator('.apexcharts-tooltip')).toContainText('751.294 Units');
  await expect(card.locator('.mexa-key-value').first()).toHaveText('60.7% (751.294 Units)');
});

test('a large figure stays inside the ring, on a phone too', async ({ page }) => {
  const card = await openDonut(page, energy([{ shift_name: 'Shift 1', kwh: 98765.43210987 }, { shift_name: 'Shift 2', kwh: 24691.35802469 }]), 390);
  const middle = card.locator('.apexcharts-datalabel-value');
  await expect(middle).toHaveText('1,23,456.8');
  const ring = (await card.locator('.apexcharts-pie').first().boundingBox())!;
  const inside = async () => {
    const text = (await middle.boundingBox())!;
    const hole = ring.width * 0.66 * 0.92;                                     // the donut's hole, less its edge
    return text.width <= hole && text.x >= ring.x + (ring.width - hole) / 2 - 1;
  };
  expect(await inside()).toBe(true);
  await hoverFirst(page, card);
  await expect(middle).toHaveText('98,765.4');
  expect(await inside()).toBe(true);
  await page.waitForTimeout(400);
  await card.screenshot({ path: test.info().outputPath('energy-shift-donut-phone.png') });
});
