import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The machine page's dials and its shift timeline.
 *
 * Spindle load runs 0–150%: the load meter passes 100% on an overload (226%
 * was recorded), which the old 0–100% dial clamped away. The feed dial shows
 * the actual feed in mm/min — no controller sends the override %; the old
 * "Feed Override" dial divided mm/min by a guessed 45,000, so a cutting feed
 * of 96 mm/min read 0%.
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const T = (hhmm: string) => Date.parse(`2026-09-24T${hhmm}:00+05:30`);

function detail(live: any) {
  return { status: 'success', data: {
    machine: { id: 25, machine_serial_no: 'HMC - 7 - F' }, operator: {}, job: {}, oee: {}, shift: { shift_code: 'S1' },
    quality: {}, power: {}, production: { run_time: '01:00:00', idle_time: '02:00:00' },
    live: { machine_status: 'RUNNING', mode: 'MEM', spindle_load: 0, feed_rate: 0, parts_count: 0, alarm: false, active_alarms: [], ...live }
  } };
}

const timeline = (over: any = {}) => ({ status: 'success', data: {
  shift: { id: 5, code: 'Shift 1', name: 'Morning', start: T('08:00'), end: T('20:00'), break_minutes: 60 },
  now: T('12:00'),
  segments: [
    { state: 'OFF', from: T('08:00'), to: T('08:30') },
    { state: 'RUNNING', from: T('08:30'), to: T('10:00') },
    { state: 'IDLE', from: T('10:00'), to: T('11:00') },
    { state: 'ALARM', from: T('11:00'), to: T('12:00') }
  ],
  breaks: [{ name: 'Tea Break', from: T('10:45'), to: T('11:00') }, { name: 'Lunch', from: T('13:00'), to: T('13:30') }],
  breaks_configured: true,
  totals: { elapsed: 4 * 3600e3, RUNNING: 90 * 60e3, IDLE: 60 * 60e3, ALARM: 60 * 60e3, OFF: 30 * 60e3, breaks: 15 * 60e3 },
  ...over
} });

async function open(page: any, live: any, tl: any = timeline()) {
  // the dials are live-page widgets; a company admin holds them
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/live/25', (r: any) => r.fulfill(ok(detail(live))));
  await page.route('**/api/dashboard/live/25/timeline', (r: any) => r.fulfill(ok(tl)));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard/live/25');
  await expect(page.getByRole('heading', { name: 'HMC - 7 - F' })).toBeVisible();
}

const dial = (page: any, name: RegExp) => page.getByRole('img', { name });

test.describe('dials', () => {
  test('spindle load reads Normal, High and Overload by its zones', async ({ authedPage: page }) => {
    await open(page, { spindle_load: 35 });
    await expect(dial(page, /^Spindle load 35 percent, Normal$/)).toBeVisible();
    await expect(dial(page, /Spindle load/).locator('text.value')).toHaveText('35%');
  });

  test('an overload past the scale pins the needle but prints the real value', async ({ authedPage: page }) => {
    await open(page, { spindle_load: 226 });
    const g = dial(page, /Spindle load/);
    await expect(g).toHaveAccessibleName('Spindle load 226 percent, Overload');
    await expect(g.locator('text.value')).toHaveText('226%');
    await expect(page.getByText('Overload', { exact: true })).toBeVisible();
    // pinned at the end of the scale: rotated a full +90°
    await expect(g.locator('g.needle-turn')).toHaveAttribute('style', /rotate\(90deg\)/);
  });

  test('feed is the actual feed in mm/min, with the reason there is no override', async ({ authedPage: page }) => {
    await open(page, { feed_rate: 1500 });
    await expect(page.getByRole('heading', { name: 'Feed Rate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Feed Override' })).toHaveCount(0);
    await expect(dial(page, /Feed rate/).locator('text.value')).toHaveText('1,500 mm/min');
    await expect(page.getByText('Feed override % is not reported by the controller')).toBeVisible();
    // 1,500 of 6,000 is a quarter of the arc: -90° + 45°
    await expect(dial(page, /Feed rate/).locator('g.needle-turn')).toHaveAttribute('style', /rotate\(-45deg\)/);
  });

  test('a rapid move past the scale says so', async ({ authedPage: page }) => {
    await open(page, { feed_rate: 36000 });
    await expect(page.getByText('Above the 6,000 mm/min scale')).toBeVisible();
    await expect(dial(page, /Feed rate/).locator('text.value')).toHaveText('36,000 mm/min');
  });
});

test.describe('shift timeline', () => {
  test('draws the periods and breaks, with totals by state', async ({ authedPage: page }) => {
    await open(page, {});
    const card = page.getByRole('region', { name: /Shift Timeline/ });
    await expect(card).toContainText('Shift 1 (8:00 am – 8:00 pm)');
    await expect(card).toContainText('Elapsed : 4h 0m 0s');
    await expect(card).toContainText('Break : 15m 0s');
    await expect(card.locator('.tl-seg')).toHaveCount(4);
    await expect(card.locator('.tl-break')).toHaveCount(2);
    await expect(card).toContainText('Running 1h 30m 0s');
    await expect(card).toContainText('Alarm 1h 0m 0s');
    await expect(card).toContainText('Breaks: Tea Break 10:45 am–11:00 am · Lunch 1:00 pm–1:30 pm');
  });

  test('hovering a period shows its length and times, and the break it falls in', async ({ authedPage: page }) => {
    await open(page, {});
    const bar = page.locator('.tl-bar');
    const box = (await bar.boundingBox())!;
    // 10:50 is idle, inside the tea break: (10:50 − 08:00) / 12 h of the width
    await page.mouse.move(box.x + box.width * (170 / 720), box.y + box.height / 2);
    const tip = page.locator('.tl-tip');
    await expect(tip).toContainText('1h 00m');
    await expect(tip).toContainText('Idle');
    await expect(tip).toContainText('10:00 am – 11:00 am');
    await expect(tip).toContainText('During Tea Break (10:45 am – 11:00 am)');
  });

  test('the keyboard steps through the periods and each is read out', async ({ authedPage: page }) => {
    await open(page, {});
    const bar = page.getByRole('group', { name: /Shift timeline, Running 1h 30m 0s/ });
    await bar.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('app-shift-timeline [aria-live="polite"]')).toHaveText(/^Off, 30m 0s, 8:00 am – 8:30 am\. Period 1 of 4\.$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('app-shift-timeline [aria-live="polite"]')).toHaveText(/^Running, 1h 30m 0s/);
    await expect(page.locator('.tl-seg.is-focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tl-tip')).toHaveCount(0);
  });

  test('no break times entered: says where to add them', async ({ authedPage: page }) => {
    await open(page, {}, timeline({ breaks: [], totals: { ...timeline().data.totals, breaks: 0 } }));
    const card = page.getByRole('region', { name: /Shift Timeline/ });
    await expect(card).toContainText('Break : none set');
    await expect(card).toContainText('No break times entered for Shift 1');
  });

  test('before the break table exists, the timeline still works', async ({ authedPage: page }) => {
    await open(page, {}, timeline({ breaks: [], breaks_configured: false }));
    const card = page.getByRole('region', { name: /Shift Timeline/ });
    await expect(card.locator('.tl-seg')).toHaveCount(4);
    await expect(card).toContainText('Break times will show here once they are set up.');
  });

  test('no shift running', async ({ authedPage: page }) => {
    await open(page, {}, { status: 'success', data: { shift: null, now: T('12:00'), segments: [], breaks: [], breaks_configured: true, totals: null } });
    await expect(page.getByRole('region', { name: /Shift Timeline/ })).toContainText('No shift is running now.');
  });
});
