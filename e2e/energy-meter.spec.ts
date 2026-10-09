import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The energy meter panel: every value a machine's 3-phase meter sends, at
 * the foot of the Energy screen, for the machines that have one. (The
 * machine page showed it too until 6 Oct 2026.)
 *
 * Built from VMC - 1 - F's PowerData of 3 Oct 2026 — negative kW and power
 * factor, more Export than Import — so the panel must show the readings as
 * sent, with units and plain bands, and say in words that the meter's CTs
 * face the wrong way.
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const LIMITS = { v_ll_nominal: 415, v_tolerance_pct: 10, pf_good: 0.95, pf_low: 0.9,
                 hz_min: 49.5, hz_max: 50.5, v_imbalance_pct: 2, i_imbalance_pct: 10 };

function meter(range: string, over: any = {}) {
  const to = Date.now(), step = 60e3, from = to - 3600e3;
  const t0 = Math.floor((to - 2 * step) / step) * step;
  return { status: 'success', data: {
    meters: [{ id: 15, serial: 'VMC - 1 - F', last_read_at: to - 5000 }, { id: 34, serial: 'VMC - 13 - M', last_read_at: to - 9000 }],
    machine: { id: 15, serial: 'VMC - 1 - F' },
    range: { key: range, from, to, bucket_seconds: 60 },
    latest: {
      at: to - 5000, stale: false,
      v1n: 241.35, v2n: 240.54, v3n: 239.89, v_ln_avg: 240.59, v12: 418.06, v23: 416.2, v31: 415.93, v_ll_avg: 416.73,
      i1: 1.09, i2: 1.46, i3: 1.184, i_avg: 1.244,
      kw1: -0.18, kw2: -0.27, kw3: -0.28, kw_total: -0.73, kvar1: -0.19, kvar2: -0.22, kvar3: -0.07, kvar_total: -0.48,
      kva1: 0.26, kva2: 0.35, kva3: 0.28, kva_total: 0.9, pf1: -0.7, pf2: -0.77, pf3: -0.97, pf_avg: -0.836, frequency_hz: 49.958,
      kw_demand_max: 0.09, kw_demand_min: -2.2, kvar_demand_max: 0, kvar_demand_min: -2.18, kva_demand_max: 3.14,
      v1n_max: 244.04, v2n_max: 243.17, v3n_max: 242.29, v12_max: 422.76, v23_max: 420.49, v31_max: 419.97,
      i1_max: 14.97, i2_max: 15.15, i3_max: 14.88,
      kwh_import: 33.1, kwh_export: 77.5, kwh_total: 110.8, kvarh_import: 0.7, kvarh_export: 107, kvarh_total: 107.9,
      kvah_total: 158.2, run_hours: 116.31, aux_interrupts: 5
    },
    points: [
      { t: t0, samples: 4, kw_avg: -0.74, kw_min: -0.8, kw_max: -0.7, kva_avg: 0.9, kva_max: 0.92, i_avg: 1.24, i_max: 1.5,
        v_ll_avg: 416.7, v_ll_min: 415.9, v_ll_max: 418.1, pf_avg: -0.84, pf_min: -0.85, hz_avg: 49.96, kwh: 0.016 },
      { t: t0 + step, samples: 4, kw_avg: -0.72, kw_min: -0.78, kw_max: -0.69, kva_avg: 0.9, kva_max: 0.91, i_avg: 1.25, i_max: 1.52,
        v_ll_avg: 416.8, v_ll_min: 416, v_ll_max: 418.2, pf_avg: -0.83, pf_min: -0.84, hz_avg: 49.97, kwh: 0.017 }
    ],
    summary: { readings: 8, first_at: t0, last_at: to - 5000, kwh_used: 0.033, kwh_import: 0, kwh_export: 0.033, kvarh: 0.02, kvah: 0.04,
      kw: { avg: -0.73, min: -0.8, max: -0.69, peak: 0.8 }, kva: { avg: 0.9, max: 0.92 }, i: { avg: 1.245, max: 1.52 },
      v_ll: { min: 415.9, avg: 416.75, max: 418.2 }, v_ln: { min: 239.8, avg: 240.6, max: 241.5 },
      pf: { avg: -0.835, min: -0.85 }, hz: { min: 49.95, avg: 49.96, max: 49.98 } },
    checks: { ct_reversed: true },
    limits: LIMITS,
    ...over
  } };
}

// the panel, not the Meter totals section inside it
const panel = (page: any) => page.locator('app-meter-panel section').first();
const card = (page: any, name: string) => panel(page).getByRole('article', { name, exact: true });

async function openEnergy(page: any, respond: (url: URL) => any, asked: string[] = []) {
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/energy/meter*', (r: any) => {
    const url = new URL(r.request().url());
    asked.push(url.search);
    const body = respond(url);
    return body === 'fail' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fulfill(ok(body));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // the meter has its own tab on the Energy screen
  await page.goto('/energy-dashboard?view=meter');
}

test.describe('energy meter — Energy screen', () => {
  test('every reading with its unit, phase by phase, and plain bands', async ({ authedPage: page }) => {
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h'));
    await expect(panel(page).getByRole('heading', { name: 'Energy meter' })).toBeVisible();

    const power = card(page, 'Power');
    await expect(power).toContainText('-0.73kW');
    await expect(power).toContainText('0.90 kVA');

    const volt = card(page, 'Voltage');
    await expect(volt).toContainText('416.7V');
    await expect(volt).toContainText('Within limits');
    await expect(volt).toContainText('R–Y418.1');
    await expect(volt).toContainText('Phase to neutral');

    const amps = card(page, 'Current');
    await expect(amps).toContainText('1.24A');
    await expect(amps).toContainText('Highest recorded');

    const pf = card(page, 'Power factor');
    await expect(pf).toContainText('-0.84');
    await expect(pf).toContainText('Low');
    await expect(pf).toContainText('49.96 Hz');
    await expect(pf).toContainText('Normal');

    await expect(panel(page)).toContainText('Total energy110.8kWh');
    await expect(panel(page)).toContainText('Supply interruptions5');
  });

  test('a meter wired the wrong way round is said in words, not hidden', async ({ authedPage: page }) => {
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h'));
    await expect(panel(page).locator('.mexa-note-warn'))
      .toContainText('current transformers are most likely fitted the wrong way round');
    await expect(panel(page).locator('.mexa-note-warn')).toContainText('Export (77.5 kWh) rather than Import (33.1 kWh)');
  });

  test('only machines with a meter are offered, and choosing one asks for it', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h'), asked);
    const pick = panel(page).getByLabel('Machine');
    await expect(pick.locator('option')).toHaveText(['VMC - 1 - F', 'VMC - 13 - M']);
    await pick.selectOption({ label: 'VMC - 13 - M' });
    await expect.poll(() => asked.some(q => q.includes('machine_id=34'))).toBe(true);
  });

  test('the range and the chart metric change what is shown', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h'), asked);
    const ranges = panel(page).getByRole('group', { name: 'Time range' });
    await expect(ranges.getByRole('button', { name: '24 hours' })).toHaveAttribute('aria-pressed', 'true');
    await ranges.getByRole('button', { name: '7 days' }).click();
    await expect.poll(() => asked.some(q => q.includes('range=7d'))).toBe(true);

    const metrics = panel(page).getByRole('group', { name: 'Show on the chart' });
    await metrics.getByRole('button', { name: 'Voltage' }).click();
    await expect(panel(page).getByRole('group', { name: /^Voltage over the last 7 days/ })).toBeVisible();
    await expect(panel(page)).toContainText('Phase to neutral, average');
    await metrics.getByRole('button', { name: 'Energy used' }).click();
    await expect(panel(page).locator('.mp-totals').last()).toContainText('Energy used0.03kWh');
  });

  /* Minimum on screen: a company with no meter gets no card saying so.
     (That it is then asked once, not every 30 s, is in the unit spec.) */
  test('no machine has a meter: no card at all', async ({ authedPage: page }) => {
    const asked: string[] = [];
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h',
      { meters: [], machine: null, latest: null, points: [], summary: { readings: 0 } }), asked);
    await expect(page.getByRole('heading', { name: 'Energy Dashboard' })).toBeVisible();
    await expect.poll(() => asked.length).toBe(1);
    await page.waitForTimeout(300);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText('No machine has an energy meter yet')).toHaveCount(0);
  });

  test('a failed refresh says what to do, and Try again asks again', async ({ authedPage: page }) => {
    const asked: string[] = [];
    let fail = false;
    await openEnergy(page, u => (fail ? 'fail' : meter(u.searchParams.get('range') || '24h')), asked);
    await expect(card(page, 'Voltage')).toContainText('416.7V');
    fail = true;
    await panel(page).getByRole('group', { name: 'Time range' }).getByRole('button', { name: '7 days' }).click();
    await expect(panel(page)).toContainText('Could not load the energy meter');
    fail = false;
    await panel(page).getByRole('button', { name: 'Try again' }).click();
    await expect(card(page, 'Voltage')).toContainText('416.7V');
  });

  test('one meter is named, not offered as a choice of one', async ({ authedPage: page }) => {
    await openEnergy(page, u => meter(u.searchParams.get('range') || '24h',
      { meters: [{ id: 15, serial: 'VMC - 1 - F', last_read_at: Date.now() }] }));
    await expect(card(page, 'Voltage')).toContainText('416.7V');
    await expect(panel(page).getByLabel('Machine')).toHaveCount(0);
    await expect(panel(page).locator('.mp-machine')).toHaveText('VMC - 1 - F');
  });
});

/* The machine page is the machine: status, production, spindle. The meter's
   phases and totals live on the Energy screen only (6 Oct 2026). */
test('the machine page has no energy meter, and does not ask for one', async ({ authedPage: page }) => {
  const meterCalls: string[] = [];
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/live/15', (r: any) => r.fulfill(ok({ status: 'success', data: {
    machine: { id: 15, machine_serial_no: 'VMC - 1 - F' }, operator: {}, job: {}, oee: {}, shift: { shift_code: 'S1' },
    quality: {}, power: {}, production: { run_time: '00:00:00', idle_time: '00:00:00' },
    live: { machine_status: 'IDLE', mode: 'EDIT', spindle_load: 0, feed_rate: 0, parts_count: 76, alarm: false, active_alarms: [] }
  } })));
  // the page's other panels answer as failed, which they show in their own words
  await page.route('**/api/dashboard/live/15/timeline', (r: any) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/dashboard/live/15/spindle*', (r: any) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  page.on('request', (r: any) => { if (r.url().includes('/meter')) meterCalls.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard/live/15');
  await expect(page.getByRole('heading', { name: 'VMC - 1 - F' })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('app-meter-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Energy meter' })).toHaveCount(0);
  expect(meterCalls).toEqual([]);
});
