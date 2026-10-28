import type { Page } from '@playwright/test';
import { test, expect, localFixtureOrigin } from './fixtures/auth';

/*
 * The Maintenance Dashboard's layout, measured (27 Oct 2026, the user: "this
 * page keeps getting design problems — fix it for good"). What broke it
 * before, each now a failing test:
 *
 *   - a hint under the servo bars cut off by the panel's fixed height;
 *   - "10,350 rpm" broken over two lines, "Not reported" against the card's
 *     edge: the fans and batteries column was half a column wide;
 *   - the fixed "Updated …" tab over the right-hand cards at 1280–1440px;
 *   - a strip of empty card under the bars when another card was taller;
 *   - six fans in one row on a phone, their words on top of each other;
 *   - a rule keyed to a build hash, silently gone when the component changed.
 *
 * Every width a laptop, desktop, tablet or phone shows it at, with the data
 * that made it break: the user's VMC - 17 - F, long names, nothing reported,
 * six fans and five battery axes in alarm. The API is stubbed; nothing leaves
 * the browser.
 */

const ok = (data: unknown) => ({ status: 'success', data });
const meta = { success: true, data: {
  machines: [{ id: 17, machine_serial_no: 'VMC - 17 - F' }],
  shifts: [{ id: 10, shift_code: 'S1', shift_name: 'Shift 1' }] } };

const row = (o: Record<string, unknown> = {}) => ({
  controller_type: 'FANUC', battery_supported: true,
  machine_id: 17, machine_serial_no: 'VMC - 17 - F', image_url: null, component_id: 31, part_name: 'LM GUIDE ARRESTING BLOCK',
  part_number: '5V2102002M', target_qty: 431, operator_name: 'PRAGADEESH G', machine_status: 'RUNNING', alarm: false,
  spindle_load: 2, feed_rate: 1200, spindle_speed: 2098, spindle_motor_temp: 54, spindle_insulation_res: null,
  sequence_number: 120, received_at: new Date().toISOString(), run_seconds: 28500,
  servo_load_x: 8, servo_load_y: 9, servo_load_z: 27, servo_temp_x: null, servo_temp_y: null, servo_temp_z: 46,
  encoder_temp_x: 33, encoder_temp_y: 34, encoder_temp_z: 45, cnc_battery_voltage: null, apc_battery_voltage: null,
  fan_status: { CNC_FAN1: { on: true, fault: false, rpm: 10350 }, CNC_FAN2: { on: true, fault: false, rpm: 10450 } },
  apc_battery_status: { X: false, Y: false, Z: false },
  ...o
});
const hours = (f: (i: number) => object) =>
  Array.from({ length: 9 }, (_, i) => ({ hour_start: new Date(Date.UTC(2026, 9, 27, 2 + i, 30)).toISOString(), ...f(i) }));
const payload = (r: object, o: object = {}) => ok({
  filters: { date: '2026-10-27', shift_id: null, machine_id: 17 },
  updated_at: new Date().toISOString(),
  machines: { total: 1, running: 1, idle: 0, breakdown: 0, offline: 0 },
  health: { healthy: 1, unhealthy: 0, percent: 100, basis: 'Reporting within 60s and not in alarm' },
  alarms: { total: 62, open: 7, critical: 5, non_critical: 12, information: 45 },
  oee: { availability: 0.89, performance: 0.88, quality: 0.95, oee: 0.82 },
  production: { produced: 88, run_seconds: 28500, idle_seconds: 3000 },
  unavailable: ['insulation_resistance'],
  rows: [r],
  condition_trend: hours(i => ({ servo_temp_z: 40 + i % 4, spindle_motor_temp: 50 + i % 5 })),
  cycle_trend: hours(i => ({ produced: 10, cycle_seconds: 300 + (i * 7) % 40 })),
  supply: null,
  ...o
});

const DATA: Record<string, object> = {
  'VMC - 17 - F (the user\'s screen)': payload(row()),
  'long names': payload(row({ operator_name: 'MUTHUKUMARASWAMY RAJAGOPALAN', part_number: '5V2102002M-REV-C-OP20',
    part_name: 'CYLINDER HEAD MACHINING FIXTURE OPERATION 20 RIGHT HAND SIDE' })),
  'nothing reported': payload(row({ machine_status: 'IDLE', received_at: new Date(Date.now() - 3600_000).toISOString(),
    spindle_load: null, spindle_speed: null, spindle_motor_temp: null, servo_load_x: null, servo_load_y: null, servo_load_z: null,
    servo_temp_z: null, encoder_temp_x: null, encoder_temp_y: null, encoder_temp_z: null, fan_status: null, apc_battery_status: null,
    operator_name: null, part_name: null, part_number: null, run_seconds: 0 }),
    { alarms: { total: 0, open: 0, critical: 0, non_critical: 0, information: 0 }, cycle_trend: [], condition_trend: [] }),
  'six fans, five battery axes, in alarm': payload(row({ alarm: true, spindle_load: 135, spindle_motor_temp: 98, servo_load_x: 120,
    servo_temp_x: 91, servo_temp_y: 88, cnc_battery_voltage: 3.05, apc_battery_voltage: 2.85,
    apc_battery_status: { B: false, W: true, X: false, Y: false, Z: false },
    fan_status: { CNC_FAN1: { on: true, fault: false, rpm: 10350 }, CNC_FAN2: { on: true, fault: true, rpm: 0 },
      SPINDLE_FAN: { on: true, fault: false, rpm: 9870 }, SERVO_FAN1: { on: false, fault: false, rpm: 0 },
      SERVO_FAN2: { on: true, fault: false, rpm: 11020 }, PANEL_FAN: { on: true, fault: false, rpm: 2400 } } }))
};

const SCREENS: [number, number][] = [[1920, 1080], [1600, 900], [1512, 982], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [820, 1180], [390, 844]];

async function open(page: Page, body: object) {
  const local = localFixtureOrigin();
  await page.routeWebSocket(/.*/, ws => ws.close());
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return url.origin === local ? route.continue() : route.abort();
    if (url.pathname.startsWith('/api/charts/meta')) return route.fulfill({ json: meta });
    if (url.pathname.startsWith('/api/dashboard/maintenance')) return route.fulfill({ json: body });
    return route.fulfill({ json: { status: 'success', success: true, data: [] } });
  });
  await page.goto('/maintenance-dashboard');
  await expect(page.locator('.mt-machine')).toBeVisible();
  await expect(page.locator('.mt-row2 .apexcharts-canvas, .mt-row2 .downtime-empty').first()).toBeVisible();
  await page.waitForTimeout(400);                                       // the charts' first draw
}

/** Everything that is wrong with the page's layout, in words; [] when nothing is. */
function problems(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const page = document.querySelector('app-maintenance-dashboard')!;
    const label = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${(el.textContent || '').trim().slice(0, 24)}"`;
    const overlap = (a: DOMRect, b: DOMRect, slack = 1) =>
      a.width > 0 && b.width > 0 && a.left < b.right - slack && b.left < a.right - slack && a.top < b.bottom - slack && b.top < a.bottom - slack;

    // Closed native details retain layout boxes for unpainted descendants.
    const hiddenByDisclosure = (el: Element) => {
      const closed = el.closest('details:not([open])');
      return !!closed && el !== closed && !closed.querySelector(':scope > summary')?.contains(el);
    };

    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (sideways > 1) found.push(`the page scrolls sideways by ${sideways}px`);

    // nothing cut off: a box that hides its overflow holds all of it (a clamped value says "…" and shows the rest on hover)
    for (const el of Array.from(page.querySelectorAll('*'))) {
      const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitLineClamp?: string };
      if (hiddenByDisclosure(el) || cs.display === 'none' || el.closest('apx-chart, .sr-only') || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) continue;
      if (['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight - el.clientHeight > 2) found.push(`cut off at the bottom: ${label(el)}`);
      if (['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && el.scrollWidth - el.clientWidth > 2) found.push(`cut off at the side: ${label(el)}`);
    }

    const cards = Array.from(page.querySelectorAll('.mexa-card'));
    for (const card of cards) {
      const c = card.getBoundingClientRect();
      // words: inside their card, and never on top of other words
      const words = Array.from(card.querySelectorAll('*')).filter(el => !hiddenByDisclosure(el) && !el.closest('apx-chart, .sr-only')
        && Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent || '').trim()))
        .map(el => {
          const r = document.createRange(); r.selectNodeContents(el);
          // a clamped value hides its lines past the "…": only the ones shown count
          const own = el.getBoundingClientRect(), clips = getComputedStyle(el).overflowY !== 'visible';
          return { el, boxes: Array.from(r.getClientRects()).filter(b => !clips || b.top < own.bottom - 1) };
        });
      for (const w of words) {
        if (w.boxes.some(b => b.width && (b.left < c.left - 1 || b.right > c.right + 1 || b.bottom > c.bottom + 1))) found.push(`outside its card: ${label(w.el)}`);
      }
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
        if (words[i].el.contains(words[j].el) || words[j].el.contains(words[i].el)) continue;
        if (words[i].boxes.some(a => words[j].boxes.some(b => overlap(a, b, 2)))) found.push(`words on words: ${label(words[i].el)} / ${label(words[j].el)}`);
      }
    }
    // cards never on top of each other
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].contains(cards[j]) || cards[j].contains(cards[i])) continue;
      if (overlap(cards[i].getBoundingClientRect(), cards[j].getBoundingClientRect())) found.push(`cards overlap: ${label(cards[i])} / ${label(cards[j])}`);
    }
    // a fan's reading on one line: "10,350 rpm", not "10,350 / rpm"
    for (const el of Array.from(page.querySelectorAll('.mt-fan-reading'))) {
      const r = document.createRange(); r.selectNodeContents(el);
      if (new Set(Array.from(r.getClientRects()).map(b => Math.round(b.top))).size > 1) found.push(`fan reading on two lines: ${label(el)}`);
    }
    // the top row's cards end together, their content reaching the bottom: no strip of empty card under it
    for (const card of Array.from(page.querySelectorAll('.mt-row1 > .mexa-card, .mt-row1 > .mt-cooling'))) {
      const c = card.getBoundingClientRect();
      const last = Math.max(...Array.from(card.children).map(k => k.getBoundingClientRect()).filter(r => r.height).map(r => r.bottom));
      if (c.bottom - last > 28) found.push(`${Math.round(c.bottom - last)}px of empty card under ${label(card)}`);
    }
    // the fixed "Updated …" tab clear of every card, from a tablet up (on a phone it rides the edge)
    const tab = document.querySelector('.last-updated-vertical');
    if (tab && innerWidth >= 768) {
      for (const card of cards) if (overlap(tab.getBoundingClientRect(), card.getBoundingClientRect())) found.push(`the Updated tab covers ${label(card)}`);
    }
    return [...new Set(found)];
  });
}

for (const [name, body] of Object.entries(DATA)) {
  test.describe(name, () => {
    for (const [width, height] of SCREENS) {
      test(`${width}×${height}: nothing cut off, out of its card, on top of something or pushed sideways`, async ({ authedPage: page }) => {
        await page.setViewportSize({ width, height });
        await open(page, body);
        expect(await problems(page)).toEqual([]);
      });
    }
  });
}

test('the servo bars\' hint is read in full, and a long part name ends in "…" with all of it on hover', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, DATA['long names']);
  await expect(page.getByText('X, Y not reporting a temperature.')).toBeVisible();
  const part = page.locator('.mt-facts dd').nth(2);
  await expect(part).toHaveAttribute('title', 'CYLINDER HEAD MACHINING FIXTURE OPERATION 20 RIGHT HAND SIDE');
  const lines = await part.evaluate(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
});

for (const width of [390, 1280]) {
  test(`FANUC battery code explanations fit when expanded at ${width}px`, async ({ authedPage: page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, DATA['six fans, five battery axes, in alarm']);
    await page.getByText('Battery warning codes', { exact: true }).click();
    await expect(page.locator('.mt-battery-help')).toHaveAttribute('open', '');
    expect(await problems(page)).toEqual([]);
  });
}
