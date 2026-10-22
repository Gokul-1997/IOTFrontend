import { test, expect } from './fixtures/auth';

/*
 * The unread count on the bell: asked for once per session, not per page,
 * badge or re-render — after that the live connection keeps it (here the
 * live connection cannot be reached, so it falls back to every 30 s, which
 * these short tests never reach) — and it drops the moment a notification
 * is read, before the server has answered.
 */

const json = (body: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const list = {
  success: true, unread_count: 2,
  data: [
    { id: 1, type: 'ALARM', title: 'CNC-01 in alarm', message: 'Servo overload', is_read: false, created_at: new Date().toISOString(), link: null },
    { id: 2, type: 'WARNING', title: 'CNC-02 offline', message: 'No data for 10 minutes', is_read: false, created_at: new Date().toISOString(), link: null }
  ],
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 }
};

async function stub(page: any) {
  await page.routeWebSocket(/.*/, (socket: any) => socket.close());
  await page.route('**/socket.io/**', (route: any) => route.abort());
  const asked: string[] = [];
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/alarms/notification-policy', (r: any) => r.fulfill(json({ success: true,
    data: { enabled: false, version: 0, counts: { machines: 0 } } })));
  await page.route('**/api/notifications/unread-count', (r: any) => { asked.push(r.request().url()); return r.fulfill(json({ success: true, count: 2 })); });
  await page.route('**/api/notifications?**', (r: any) => r.fulfill(json(list)));
  return asked;
}

const bell = (page: any) => page.locator('app-notification-bell button[aria-controls="notif-panel"]');

test('moving between pages, opening the bell and re-rendering ask for the count once', async ({ authedPage: page }) => {
  const asked = await stub(page);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/profile');
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 2 unread');

  for (const link of ['Settings', 'Notifications', 'My Profile']) {
    await page.getByRole('button', { name: /^Account menu/ }).click();
    await page.getByRole('link', { name: link }).click();
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 2 unread');
  }
  await bell(page).click();                     // the panel lists them; the count is not asked again
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
  await bell(page).click();
  await page.setViewportSize({ width: 390, height: 844 });   // a re-render at another width
  await page.waitForTimeout(500);

  expect(asked).toHaveLength(1);
});

test('reading one drops the badge at once; marking all read empties it at once', async ({ authedPage: page }) => {
  await stub(page);
  let release: () => void = () => {};
  await page.route('**/api/notifications/1/read', async (r: any) => {
    await new Promise<void>(res => (release = res));      // the server has not answered yet
    return r.fulfill(json({ success: true })).catch(() => {});
  });
  let releaseAll: () => void = () => {};
  await page.route('**/api/notifications/mark-all-read', async (r: any) => {
    await new Promise<void>(res => (releaseAll = res));
    return r.fulfill(json({ success: true })).catch(() => {});
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/profile');
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 2 unread');

  await bell(page).click();
  await page.getByRole('button', { name: /CNC-01 in alarm/ }).click();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  release();

  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications');
  releaseAll();
});

/* 22 Oct 2026 — "notification click, no redirect": the bell only marked it
   read. A notification now opens what it is about, as the Notifications page
   does; one with no link stays where it is. */
test('a notification in the bell opens its page, and is read', async ({ authedPage: page }) => {
  await stub(page);
  const read: string[] = [];
  await page.route('**/api/notifications/*/read', (r: any) => { read.push(r.request().url()); return r.fulfill(json({ success: true })); });
  await page.route('**/api/notifications?**', (r: any) => r.fulfill(json({ ...list, data: [
    { id: 7, type: 'INFO', title: 'O1001.nc is on VMC-1', message: 'The gateway wrote it to the machine.', is_read: false,
      created_at: new Date().toISOString(), link: '/programs' },
    ...list.data
  ] })));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/profile');

  await bell(page).click();
  await page.getByRole('button', { name: /CNC-01 in alarm/ }).click();          // no link: stays here
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();

  await page.getByRole('button', { name: /O1001\.nc is on VMC-1/ }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole('region', { name: 'Notifications' })).toHaveCount(0);   // the panel closed
  await expect.poll(() => read.some(u => u.includes('/notifications/7/read'))).toBe(true);
});

/* 22 Oct 2026 — "the notification I select, that record highlighted": an
   alarm notification opens the Alarms page on that alarm, marked, in view
   and focused; the id is dropped from the address afterwards. */
const alarm = (id: number, extra: any = {}) => ({ id, machine_id: 7, machine_serial_no: `VMC-${id}`, alarm_type: 'ALARM',
  alarm_code: `SV${id}`, message: `Servo overload ${id}`, severity: 'CRITICAL', started_at: new Date().toISOString(), is_resolved: false, ...extra });

async function alarmsPage(page: any, notification: any, active: any[], all: any[]) {
  await stub(page);
  await page.route('**/api/notifications?**', (r: any) => r.fulfill(json({ ...list, data: [notification] })));
  const asked: string[] = [];
  await page.route(/\/api\/alarms(\?|$)/, (r: any) => {
    const url = new URL(r.request().url());
    asked.push(url.search);
    const rows = url.searchParams.get('is_resolved') === 'false' ? active : all;
    return r.fulfill(json({ success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } }));
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/profile');
  await bell(page).click();
  await page.getByRole('button', { name: new RegExp(notification.title) }).click();
  return asked;
}

test('an alarm notification opens the Alarms page on that alarm, marked and focused', async ({ authedPage: page }) => {
  const rows = [alarm(4), alarm(5), alarm(6)];
  await alarmsPage(page, { id: 9, type: 'ALARM', title: 'Critical alarm — VMC-5', message: 'SV5: Servo overload 5', is_read: false,
                           created_at: new Date().toISOString(), link: '/alarms?alarm_id=5', alarm_id: 5 }, rows, rows);
  await expect(page).toHaveURL(/\/alarms$/);                                   // the id is taken, then dropped
  const marked = page.locator('tr.is-linked');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText('Servo overload 5');
  await expect(marked).toBeFocused();
  await expect(marked).toContainText('From your notification:');
});

test('an alarm resolved since the notification is found among all alarms', async ({ authedPage: page }) => {
  const asked = await alarmsPage(page, { id: 9, type: 'ALARM', title: 'Critical alarm — VMC-5', message: 'SV5', is_read: false,
                                         created_at: new Date().toISOString(), link: '/alarms?alarm_id=5', alarm_id: 5 },
                                 [alarm(6)], [alarm(6), alarm(5, { is_resolved: true })]);
  await expect(page.locator('tr.is-linked')).toContainText('Servo overload 5');
  await expect(page.locator('#alarm-status')).toHaveValue('');                   // the filter says All
  expect(asked.at(-1)).not.toContain('is_resolved');
});

test('an older alarm notification (link without the id) still opens on its alarm', async ({ authedPage: page }) => {
  const rows = [alarm(4), alarm(5)];
  await alarmsPage(page, { id: 9, type: 'ALARM', title: 'Critical alarm — VMC-4', message: 'SV4', is_read: false,
                           created_at: new Date().toISOString(), link: '/alarms', alarm_id: 4 }, rows, rows);
  await expect(page.locator('tr.is-linked')).toContainText('Servo overload 4');
});
