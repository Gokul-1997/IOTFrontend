import { test, expect } from './fixtures/auth';

/*
 * The machine page's name is a dropdown of the company's machines, with a
 * search box (23 Oct 2026, the user: to see the next machine they went back
 * to the Live Dashboard and clicked it each time). Picking one opens it on
 * the same page — and nothing of the machine before stays on screen.
 */

const ok = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const MACHINES = [
  { machine_id: 21, machine_serial_no: 'VMC - 1 - F', status: 'RUNNING', alarm: false },
  { machine_id: 25, machine_serial_no: 'HMC - 7 - F', status: 'IDLE', alarm: false },
  { machine_id: 30, machine_serial_no: 'VMC - 12 - F', status: 'IDLE', alarm: true },
  { machine_id: 31, machine_serial_no: 'Lathe 3', status: 'OFFLINE', alarm: false }
];
const OPERATOR: Record<number, string> = { 21: 'Arun Kumar', 25: 'Bala Murugan', 30: 'Charles Raj', 31: 'Deepa Selvam' };

function detail(id: number) {
  const m = MACHINES.find(x => x.machine_id === id)!;
  return { status: 'success', data: {
    machine: { id, machine_serial_no: m.machine_serial_no },
    operator: { operator_name: OPERATOR[id], employee_id: `EMP-${id}` },
    job: { part_name: `Housing ${id}`, component_id: `C-${id}`, target_qty: 100 },
    oee: {}, shift: { shift_code: 'S1' }, quality: {}, power: {},
    production: { run_time: '01:00:00', idle_time: '00:30:00' },
    live: { machine_status: m.status, mode: 'MEM', spindle_load: 0, feed_rate: 0, parts_count: id,
            alarm: m.alarm, active_alarms: [] }
  } };
}

/** The page's API, with what it asked for: the list, each machine, and each machine's panels. */
async function stubApi(page: any, opts: { list?: any; listStatus?: number; hold?: number } = {}) {
  const asked: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>(r => { release = r; });
  await page.routeWebSocket(/.*/, (ws: any) => ws.close());
  await page.route('**/api/**', (r: any) => r.fulfill(ok({ status: 'success', data: [] })));
  await page.route('**/api/dashboard/live', (r: any) => {
    asked.push('list');
    return opts.listStatus ? r.fulfill({ status: opts.listStatus, contentType: 'application/json', body: '{}' })
                           : r.fulfill(ok({ status: 'success', data: opts.list ?? MACHINES }));
  });
  await page.route(/\/api\/dashboard\/live\/\d+$/, async (r: any) => {
    const id = Number(new URL(r.request().url()).pathname.split('/').pop());
    asked.push(`detail ${id}`);
    if (id === opts.hold) await held;
    return r.fulfill(ok(detail(id)));
  });
  await page.route(/\/api\/dashboard\/live\/\d+\/(timeline|spindle)/, (r: any) => {
    const [, id, what] = new URL(r.request().url()).pathname.match(/live\/(\d+)\/(\w+)/)!;
    asked.push(`${what} ${id}`);
    return r.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"error"}' });
  });
  return { asked, release };
}

const nameButton = (page: any, name: string) => page.getByRole('heading', { level: 1 }).getByRole('button', { name });
const search = (page: any) => page.getByRole('combobox', { name: 'Search machines' });
const list = (page: any) => page.getByRole('listbox', { name: 'Machines' });

test.beforeEach(async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('the name lists every machine with its status; picking one opens it here, with nothing of the last', async ({ authedPage: page }) => {
  const api = await stubApi(page, { hold: 30 });
  await page.goto('/dashboard/live/25');
  await expect(page.getByText('Bala Murugan')).toBeVisible();

  await nameButton(page, 'HMC - 7 - F').click();
  await expect(search(page)).toBeFocused();
  const options = list(page).getByRole('option');
  await expect(options).toHaveText([/VMC - 1 - F\s*Running/, /HMC - 7 - F\s*Idle/, /VMC - 12 - F\s*Alarm/, /Lathe 3\s*Offline/]);
  await expect(list(page).getByRole('option', { selected: true })).toHaveText(/HMC - 7 - F/);

  await list(page).getByRole('option', { name: /VMC - 12 - F/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/live\/30$/);
  await expect(list(page)).toHaveCount(0);
  // its name at once (from the list); the last machine's operator is gone while its own data comes
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/VMC - 12 - F/);
  await expect(page.getByText('Bala Murugan')).toHaveCount(0);
  api.release();
  await expect(page.getByText('Charles Raj')).toBeVisible();
  await expect(nameButton(page, 'VMC - 12 - F')).toBeFocused();
  // the shift timeline and spindle panel are this machine's
  await expect.poll(() => api.asked.filter(a => /^(timeline|spindle) 30$/.test(a)).length).toBe(2);
});

test('with the keyboard: ↓ from this machine is the next one, Enter opens it, Esc closes', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.goto('/dashboard/live/25');
  await expect(page.getByText('Bala Murugan')).toBeVisible();

  await nameButton(page, 'HMC - 7 - F').focus();
  await page.keyboard.press('Enter');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(search(page)).toHaveAttribute('aria-activedescendant',
    (await list(page).getByRole('option', { name: /VMC - 12 - F/ }).getAttribute('id'))!);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/live\/30$/);
  await expect(page.getByText('Charles Raj')).toBeVisible();

  await page.keyboard.press('ArrowDown');                      // ↓ on the name opens it too
  await expect(list(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(nameButton(page, 'VMC - 12 - F')).toBeFocused();
});

test('typing narrows the machines; Enter opens the first; nothing found says so', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.goto('/dashboard/live/25');
  await nameButton(page, 'HMC - 7 - F').click();

  await search(page).fill('vmc12');
  await expect(list(page).getByRole('option')).toHaveText([/VMC - 12 - F/]);
  await search(page).fill('zzz');
  await expect(list(page).getByRole('option')).toHaveCount(0);
  await expect(page.getByText('No machine matches “zzz”.')).toBeVisible();
  await search(page).fill('lathe');
  await search(page).press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/live\/31$/);
  await expect(page.getByText('Deepa Selvam')).toBeVisible();
});

test('Back goes to the machine before, with its own data again', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.goto('/dashboard/live/25');
  await expect(page.getByText('Bala Murugan')).toBeVisible();
  await nameButton(page, 'HMC - 7 - F').click();
  await list(page).getByRole('option', { name: /VMC - 1 - F/ }).click();
  await expect(page.getByText('Arun Kumar')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/live\/25$/);
  await expect(page.getByText('Bala Murugan')).toBeVisible();
  await expect(page.getByText('Arun Kumar')).toHaveCount(0);
});

test('a click elsewhere closes the list, and opens nothing', async ({ authedPage: page }) => {
  await stubApi(page);
  await page.goto('/dashboard/live/25');
  await nameButton(page, 'HMC - 7 - F').click();
  await expect(list(page)).toBeVisible();
  await page.getByText('Time Info').click();
  await expect(list(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/live\/25$/);
});

test('with no other machine the name stays plain text', async ({ authedPage: page }) => {
  await stubApi(page, { list: [MACHINES[1]] });
  await page.goto('/dashboard/live/25');
  await expect(page.getByRole('heading', { level: 1, name: 'HMC - 7 - F' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button')).toHaveCount(0);
});

test('a server without the list: the name stays plain text', async ({ authedPage: page }) => {
  await stubApi(page, { listStatus: 404 });
  await page.goto('/dashboard/live/25');
  await expect(page.getByText('Bala Murugan')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'HMC - 7 - F' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).getByRole('button')).toHaveCount(0);
});

for (const width of [390, 320]) {
  test(`on a ${width}px phone the list fits the screen and nothing scrolls sideways`, async ({ authedPage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubApi(page);
    await page.goto('/dashboard/live/25');
    await nameButton(page, 'HMC - 7 - F').click();
    await expect(list(page)).toBeVisible();
    const panel = (await page.locator('.ms-panel').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await list(page).getByRole('option', { name: /Lathe 3/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/live\/31$/);
  });
}
