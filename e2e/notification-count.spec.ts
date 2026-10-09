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
  const asked: string[] = [];
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
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
