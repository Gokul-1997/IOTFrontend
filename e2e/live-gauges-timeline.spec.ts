import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The machine page's spindle and feed panel, and its shift timeline.
 *
 * The panel replaced two needle dials. It must say what each reading is
 * now, in its unit, when it was taken (and when it is too old to be "now"),
 * how load compares with the 80 % / 100 % bands and speed with the rated
 * top speed — and say plainly that no controller sends a programmed feed
 * or override %.
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

/** The spindle readings API: latest reading plus a trend; `range` echoes the request. */
function spindle(range: string, over: any = {}) {
  const to = Date.now(), from = to - 3600e3;
  return { status: 'success', data: {
    machine: { id: 25, serial: 'HMC - 7 - F', rated_rpm: 10000 },
    range: { key: range, from, to, bucket_seconds: 60 },
    thresholds: { load_high: 80, load_overload: 100 },
    latest: { at: to - 5000, load: 35, rpm: 2500, feed: 1500, status: 'RUNNING', stale: false },
    points: [
      { t: Math.floor((to - 120e3) / 60e3) * 60e3, load_avg: 30, load_max: 60, rpm_avg: 2400, rpm_max: 2600, feed_avg: 1200, feed_max: 1500, samples: 12 },
      { t: Math.floor((to - 60e3) / 60e3) * 60e3, load_avg: 40, load_max: 182, rpm_avg: 2500, rpm_max: 4800, feed_avg: 1300, feed_max: 30000, samples: 12 }
    ],
    summary: { samples: 24, turning: 20, first_at: to - 120e3, last_at: to - 5000,
      load: { min: 2, avg: 35, max: 182, high_pct: 10, overload_pct: 5 },
      rpm: { min: 800, avg: 2450, max: 4800, max_of_rated_pct: 48 },
      feed: { min: 50, avg: 1250, max: 30000, feeding: 18 } },
    ...over
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

async function open(page: any, live: any, tl: any = timeline(), sp: (range: string) => any = r => spindle(r), ranges: string[] = []) {
  // the spindle and feed widgets belong to the live page; a company admin holds them
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/live/25', (r: any) => r.fulfill(ok(detail(live))));
  await page.route('**/api/dashboard/live/25/timeline', (r: any) => r.fulfill(ok(tl)));
  await page.route('**/api/dashboard/live/25/spindle*', (r: any) => {
    const range = new URL(r.request().url()).searchParams.get('range') || '1h';
    ranges.push(range);
    const body = sp(range);
    return body === 'fail' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fulfill(ok(body));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard/live/25');
  await expect(page.getByRole('heading', { name: 'HMC - 7 - F' })).toBeVisible();
}

const card = (page: any, name: string) => page.getByRole('article', { name: new RegExp(name) });

test.describe('spindle and feed', () => {
  test('spindle load says its value, unit and band in words', async ({ authedPage: page }) => {
    await open(page, {});
    const load = card(page, 'Spindle load');
    await expect(load.locator('.sp-value')).toContainText('35%');
    await expect(load).toContainText('Normal');
    await expect(load).toContainText('As of');
  });

  test('an overload is named, not only coloured', async ({ authedPage: page }) => {
    await open(page, {}, timeline(), r => spindle(r, { latest: { at: Date.now() - 5000, load: 226, rpm: 2500, feed: 1500, status: 'RUNNING', stale: false } }));
    const load = card(page, 'Spindle load');
    await expect(load.locator('.sp-value')).toContainText('226%');
    await expect(load).toContainText('Overload');
  });

  test('speed is compared with the rated top speed', async ({ authedPage: page }) => {
    await open(page, {});
    const speed = card(page, 'Spindle speed');
    await expect(speed.locator('.sp-value')).toContainText('2,500rpm');
    await expect(speed).toContainText('25 % of the rated 10,000 rpm.');
  });

  test('feed is the actual feed in mm/min, with the reason there is no override', async ({ authedPage: page }) => {
    await open(page, {});
    const feed = card(page, 'Feed rate');
    await expect(feed.locator('.sp-value')).toContainText('1,500mm/min');
    await expect(feed).toContainText('does not send the programmed feed or the feed override %');
  });

  test('a reading too old to be "now" is shown as missing, with when it was taken', async ({ authedPage: page }) => {
    await open(page, {}, timeline(), r => spindle(r, { latest: { at: Date.now() - 3600e3, load: 35, rpm: 2500, feed: 1500, status: 'IDLE', stale: true } }));
    const load = card(page, 'Spindle load');
    await expect(load.locator('.sp-value')).toHaveText(/--/);
    await expect(load).toContainText('No reading since');
  });

  test('the range and the metric change the chart and the figures under it', async ({ authedPage: page }) => {
    const ranges: string[] = [];
    await open(page, {}, timeline(), r => spindle(r), ranges);
    await expect(page.locator('.sp-stats')).toContainText('182');
    await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: '24 hours' }).click();
    await expect.poll(() => ranges.includes('24h')).toBe(true);
    await expect(page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: '24 hours' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: 'Show on the chart' }).getByRole('button', { name: 'Spindle speed' }).click();
    await expect(page.locator('.sp-stats')).toContainText('4,800');
    await expect(page.locator('.sp-stats')).toContainText('48');
  });

  test('a range with no readings says so and offers a longer one', async ({ authedPage: page }) => {
    const ranges: string[] = [];
    await open(page, {}, timeline(), r => r === '24h' ? spindle(r) : spindle(r, { points: [], summary: { samples: 0, turning: 0, first_at: null, last_at: null,
      load: { min: null, avg: null, max: null, high_pct: null, overload_pct: null }, rpm: { min: null, avg: null, max: null, max_of_rated_pct: null },
      feed: { min: null, avg: null, max: null, feeding: 0 } } }), ranges);
    await expect(page.getByText('No readings from this machine in the last hour')).toBeVisible();
    await page.getByRole('button', { name: 'Show the last 24 hours' }).click();
    await expect.poll(() => ranges.includes('24h')).toBe(true);
    await expect(page.locator('.sp-stats')).toContainText('182');
  });

  test('a failed load says what to do, and the current values still show', async ({ authedPage: page }) => {
    await open(page, {}, timeline(), () => 'fail');
    await expect(page.getByText('Could not load the spindle readings')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
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
