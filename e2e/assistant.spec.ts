import { test, expect, seedAuth } from './fixtures/auth';

/*
 * The report assistant ("STM Mexa AI", 22 Oct 2026): a launcher bottom
 * right on signed-in pages for people with report access; the chat opens
 * over the page; answers cite their report with View / Download; the daily
 * allowance shows, and when it is used up the reports stay open.
 */
const json = (body: any, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const WELCOME = 'Hi, I’m STM Mexa AI, your company’s report assistant. I can help you understand your reports, compare results, and find company details available to your account. What would you like to know?';
const status = (o: any = {}) => ({ status: 'success', data: {
  name: 'STM Mexa AI', enabled: true, welcome: WELCOME,
  suggestions: ['Summarize today’s production report.', 'Compare this week’s OEE with last week.', 'Show production by shift.', 'Show my company’s registered details.'],
  allowance: { limit: 50, used: 12, remaining: 38, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' }, ...o } });
const answer = {
  kind: 'answer', text: 'Today 65 parts were made on 2 machines.\n- VMC - 12 - F: 40 pcs\n- VMC - 13 - M: 25 pcs',
  sources: [{ report: 'Production report', period: { from: '2026-10-22', to: '2026-10-22' }, filters: { machine: null, shift: null },
              view: '/reports?tab=production&from=2026-10-22&to=2026-10-22',
              download: { path: '/reports/production', params: { format: 'xlsx', date_from: '2026-10-22', date_to: '2026-10-22' }, filename: 'production_2026-10-22_to_2026-10-22.xlsx' } }],
  allowance: { limit: 50, used: 13, remaining: 37, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' }
};

async function stub(page: any, st: any = status()) {
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/assistant/status', (r: any) => r.fulfill(json(st)));
  const asked: any[] = [];
  return asked;
}
const launcher = (page: any) => page.getByRole('button', { name: 'Ask STM Mexa AI about your reports' });
const panel = (page: any) => page.getByRole('dialog', { name: 'STM Mexa AI' });

test('report users get the launcher; it opens the chat over the page with the welcome, suggestions and today\'s allowance', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);                            // the page stays
  await expect(panel(page)).toContainText(WELCOME);
  await expect(panel(page)).toContainText('38 of 50 left today');
  await expect(panel(page).getByRole('group', { name: 'Suggested questions' }).getByRole('button'))
    .toHaveText(['Summarize today’s production report.', 'Compare this week’s OEE with last week.', 'Show production by shift.', 'Show my company’s registered details.']);
  await expect(page.getByLabel('Your question for STM Mexa AI')).toBeFocused();
});

test('a suggestion is asked; while it is answered the chat says so; the answer cites its report, with View and Download', async ({ authedPage: page }) => {
  await stub(page);
  const asked: any[] = [];
  let release: () => void = () => {};
  await page.route('**/api/assistant/chat', async (r: any) => {
    asked.push(r.request().postDataJSON());
    await new Promise<void>(res => (release = res));
    return r.fulfill(json({ status: 'success', data: answer })).catch(() => {});
  });
  const files: string[] = [];
  await page.route('**/api/reports/production?*', (r: any) => { files.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'x' }); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await panel(page).getByRole('button', { name: 'Summarize today’s production report.' }).click();

  await expect(panel(page).getByRole('status').filter({ hasText: 'STM Mexa AI is reading your reports…' })).toBeVisible();
  expect(asked[0]).toEqual({ messages: [{ role: 'user', content: 'Summarize today’s production report.' }] });
  release();

  const log = panel(page).getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('Today 65 parts were made on 2 machines.');
  await expect(log).toContainText('Source: Production report · 22-Oct-2026 · All machines · All shifts');
  await expect(panel(page)).toContainText('37 of 50 left today');

  const download = page.waitForEvent('download');
  await log.getByRole('button', { name: 'Download report' }).click();
  expect((await download).suggestedFilename()).toBe('production_2026-10-22_to_2026-10-22.xlsx');
  expect(new URL(files[0]).searchParams.get('date_from')).toBe('2026-10-22');

  await log.getByRole('button', { name: 'View report' }).click();
  await expect(page).toHaveURL(/\/reports\?tab=production$/);            // opened on that day; the filters taken
});

/* The server signs each reply for the person who got it and believes no
   assistant turn without its signature (22 Oct 2026 security review): the
   chat sends every reply back exactly as it came, signature included. */
test('a follow-up question sends the earlier reply back unchanged, with the server\'s signature', async ({ authedPage: page }) => {
  await stub(page);
  const asked: any[] = [];
  await page.route('**/api/assistant/chat', (r: any) => {
    asked.push(r.request().postDataJSON());
    return r.fulfill(json({ status: 'success', data: { ...answer, sig: `sig-${asked.length}` } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await page.getByLabel('Your question for STM Mexa AI').fill('Production today');
  await page.getByLabel('Your question for STM Mexa AI').press('Enter');
  await expect(panel(page).getByRole('log', { name: 'Conversation' })).toContainText('Today 65 parts were made on 2 machines.');
  await page.getByLabel('Your question for STM Mexa AI').fill('And by shift?');
  await page.getByLabel('Your question for STM Mexa AI').press('Enter');
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1].messages).toEqual([
    { role: 'user', content: 'Production today' },
    { role: 'assistant', content: answer.text, sig: 'sig-1' },
    { role: 'user', content: 'And by shift?' }
  ]);
});

test('on a report page the page\'s filters go with the question, and the chat shows them', async ({ authedPage: page }) => {
  await stub(page);
  await page.route('**/api/reports/machines*', (r: any) => r.fulfill(json({ status: 'success', data: [{ id: 1, name: 'VMC - 12 - F' }] })));
  await page.route('**/api/reports/shifts*', (r: any) => r.fulfill(json({ status: 'success', data: [{ id: 10, name: 'A' }] })));
  await page.route('**/api/reports/production-data*', (r: any) => r.fulfill(json({ status: 'success', data: { rows: [], summary: {} } })));
  const asked: any[] = [];
  await page.route('**/api/assistant/chat', (r: any) => { asked.push(r.request().postDataJSON()); return r.fulfill(json({ status: 'success', data: answer })); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/reports?tab=production');
  await page.getByLabel('Machine', { exact: true }).selectOption({ label: 'VMC - 12 - F' });
  await launcher(page).click();
  await expect(panel(page)).toContainText(/Using this page’s filters: Production report · \d{2}-\w{3}-\d{4} · VMC - 12 - F · All shifts/);
  await page.getByLabel('Your question for STM Mexa AI').fill('How did this machine do?');
  await page.getByLabel('Your question for STM Mexa AI').press('Enter');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].context).toMatchObject({ report: 'production', machine: 'VMC - 12 - F', shift: null });
  expect(asked[0].context.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('the allowance used up: the question box closes with when it comes back; the reports stay open', async ({ authedPage: page }) => {
  await stub(page, status({ allowance: { limit: 50, used: 50, remaining: 0, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' } }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await expect(panel(page)).toContainText('You’ve reached today’s STM Mexa AI allowance. Your allowance resets at 12:00 am (Asia/Kolkata). You can still access your reports.');
  await expect(page.getByLabel('Your question for STM Mexa AI')).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Show production by shift.' })).toBeDisabled();
});

test('a failed question can be asked again, and only the question goes back', async ({ authedPage: page }) => {
  await stub(page);
  const asked: any[] = [];
  let calls = 0;
  await page.route('**/api/assistant/chat', (r: any) => {
    asked.push(r.request().postDataJSON());
    calls += 1;
    return calls === 1
      ? r.fulfill(json({ status: 'error', message: 'STM Mexa AI is busy right now. Please try again in a moment.' }, 503))
      : r.fulfill(json({ status: 'success', data: answer }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await page.getByLabel('Your question for STM Mexa AI').fill('Production today');
  await panel(page).getByRole('button', { name: 'Send' }).click();
  const log = panel(page).getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('STM Mexa AI is busy right now. Please try again in a moment.');
  await log.getByRole('button', { name: 'Try again' }).click();
  await expect(log).toContainText('Today 65 parts were made on 2 machines.');
  expect(asked[1]).toEqual({ messages: [{ role: 'user', content: 'Production today' }] });
});

test('no launcher for a role without reports, or when the company admin switched it off', async ({ page }) => {
  await seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user', permissions: ['page:dashboard:view'] });
  await stub(page);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);

  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.route('**/api/assistant/status', (r: any) => r.fulfill(json({ status: 'success', data: { name: 'STM Mexa AI', enabled: false, reason: 'SWITCHED_OFF' } })));
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
});

/* 22 Oct 2026 — "nothing shows, where is the button?": before the server has
   the assistant (no AI key, or an older API), the button still shows for
   report users and the chat says it is not on yet. */
for (const [why, answer] of [
  ['no AI key on the server', (r: any) => r.fulfill(json({ status: 'success', data: { name: 'STM Mexa AI', enabled: false, reason: 'NOT_CONFIGURED' } }))],
  ['an older server without it', (r: any) => r.fulfill(json({ message: 'Not found' }, 404))]
] as const) {
  test(`${why}: the button is there, and the chat says it is not on yet`, async ({ authedPage: page }) => {
    await stub(page);
    await page.route('**/api/assistant/status', answer);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/profile');
    await launcher(page).click();
    await expect(panel(page)).toContainText('STM Mexa AI isn’t switched on yet. Your reports work as usual; once it is set up, you can ask about them here.');
    await expect(page.getByLabel('Your question for STM Mexa AI')).toBeDisabled();
    await expect(panel(page).getByRole('group', { name: 'Suggested questions' })).toHaveCount(0);
  });
}

test('Escape closes it and gives focus back; one greeting a session; none for anyone who asked for less motion', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await expect(launcher(page)).toHaveClass(/is-greeting/);
  await launcher(page).click();
  await expect(page.getByLabel('Your question for STM Mexa AI')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  await page.reload();
  await expect(launcher(page)).not.toHaveClass(/is-greeting/);           // once per session

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(launcher(page)).toHaveClass(/is-greeting/);
  expect(await launcher(page).evaluate((el: Element) => getComputedStyle(el).animationName)).toBe('none');
});

test('on a phone the chat is a full-screen sheet with nothing off the side', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/notifications');
  await expect(launcher(page)).toBeVisible();
  const before = await page.evaluate(() => document.documentElement.scrollWidth);
  await launcher(page).click();
  // once its short opening slide has finished, it covers the screen
  await expect.poll(async () => {
    const b = await panel(page).boundingBox();
    return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  }).toEqual([0, 0, 390, 844]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(before);   // the chat adds nothing off the side
  expect(before).toBeLessThanOrEqual(390);
  await panel(page).getByRole('button', { name: 'Close STM Mexa AI' }).click();
  await expect(panel(page)).toHaveCount(0);
});

test('the company admin sets the daily allowance and the timezone in Settings', async ({ authedPage: page }) => {
  await stub(page);
  await page.route('**/api/alarms/notification-policy', (r: any) => r.fulfill(json({ success: true, data: { enabled: false, version: 0, counts: { machines: 0 } } })));
  const saved: any[] = [];
  await page.route('**/api/assistant/settings', (r: any) => {
    if (r.request().method() === 'PUT') { saved.push(r.request().postDataJSON()); return r.fulfill(json({ status: 'success', data: { daily_limit: 20, timezone: 'Asia/Dubai' } })); }
    return r.fulfill(json({ status: 'success', data: { daily_limit: 50, timezone: 'Asia/Kolkata', default_limit: 50, max_limit: 1000 } }));
  });
  await seedAuth(page, { roles: ['COMPANY_ADMIN'] });
  await page.goto('/settings');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'STM Mexa AI' }) });
  await card.getByLabel('Answers per person per day').fill('20');
  await card.getByLabel('Company timezone').selectOption('Asia/Dubai');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('Saved: 20 answers per person a day.');
  expect(saved).toEqual([{ daily_limit: 20, timezone: 'Asia/Dubai' }]);
});
