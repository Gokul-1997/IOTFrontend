import { test, expect, seedAuth, stubJwt } from './fixtures/auth';

/*
 * The company assistant ("Mexa AI", 22 Oct 2026): a launcher bottom
 * right on signed-in pages for everyone in a company (what it answers
 * follows the role); the chat opens over the page; answers cite their
 * report with View / Download; the daily allowance shows, and when it is
 * used up the reports stay open.
 */
const json = (body: any, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const WELCOME = 'Hi, I’m Mexa AI, your company assistant. Ask me about production, OEE, machines, alarms, downtime, maintenance or energy — or how to do something in MEXA.';
const status = (o: any = {}) => ({ status: 'success', data: {
  name: 'Mexa AI', enabled: true, welcome: WELCOME,
  suggestions: ['Summarize today’s production report.', 'Which machines are running right now?', 'Compare this week’s OEE with last week.', 'How do I download a report?'],
  allowance: { limit: 50, used: 12, remaining: 38, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' }, ...o } });
const answer = {
  kind: 'answer', text: 'Today 65 parts were made on 2 machines.\n- VMC - 12 - F: 40 pcs\n- VMC - 13 - M: 25 pcs',
  sources: [{ report: 'Production report', period: { from: '2026-10-22', to: '2026-10-22' }, filters: { machine: null, shift: null },
              view: '/reports?tab=production&from=2026-10-22&to=2026-10-22',
              download: { path: '/reports/production', params: { format: 'xlsx', date_from: '2026-10-22', date_to: '2026-10-22' }, filename: 'production_2026-10-22_to_2026-10-22.xlsx' } }],
  allowance: { limit: 50, used: 13, remaining: 37, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' }
};

/* S&T gave the company the AI (23 Oct 2026: it is opt-in — a company with no
   grants does not have it), with the pages these tests open. */
const WITH_AI = ['page:reports:view', 'page:oee-reports:view', 'page:dashboard:view', 'page:assistant:view'];

async function stub(page: any, st: any = status()) {
  await seedAuth(page, { company_permissions: WITH_AI });
  await page.route('**/socket.io/**', (r: any) => r.abort());
  await page.route('**/api/**', (r: any) => r.fulfill(json({ status: 'success', success: true, data: [] })));
  await page.route('**/api/assistant/status', (r: any) => r.fulfill(json(st)));
  const asked: any[] = [];
  return asked;
}
const launcher = (page: any) => page.getByRole('button', { name: 'Ask Mexa AI' });
const panel = (page: any) => page.getByRole('dialog', { name: 'Mexa AI' });

test('report users get the launcher; it opens the chat over the page with the welcome, suggestions and today\'s allowance', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/\/profile$/);                            // the page stays
  await expect(panel(page)).toContainText(/(Good (morning|afternoon|evening)|Hello), test/);   // the person's own name, by the plant's clock
  await expect(panel(page)).toContainText('How can I help you today?');
  await expect(panel(page)).toContainText(WELCOME);
  await expect(panel(page)).toContainText('38 of 50 left today');
  const chips = panel(page).getByRole('group', { name: 'Suggested questions' }).getByRole('button');
  await expect(chips).toHaveCount(4);
  for (const [i, q] of ['Summarize today’s production report.', 'Which machines are running right now?',
                        'Compare this week’s OEE with last week.', 'How do I download a report?'].entries()) {
    await expect(chips.nth(i)).toHaveAccessibleName(q);                    // the icons are not read out
  }
  await expect(page.getByLabel('Your question for Mexa AI')).toBeFocused();
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

  await expect(panel(page).getByRole('status').filter({ hasText: 'Mexa AI is looking into it…' })).toBeVisible();
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
  await page.getByLabel('Your question for Mexa AI').fill('Production today');
  await page.getByLabel('Your question for Mexa AI').press('Enter');
  await expect(panel(page).getByRole('log', { name: 'Conversation' })).toContainText('Today 65 parts were made on 2 machines.');
  await page.getByLabel('Your question for Mexa AI').fill('And by shift?');
  await page.getByLabel('Your question for Mexa AI').press('Enter');
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
  await page.getByLabel('Your question for Mexa AI').fill('How did this machine do?');
  await page.getByLabel('Your question for Mexa AI').press('Enter');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].context).toMatchObject({ report: 'production', machine: 'VMC - 12 - F', shift: null });
  expect(asked[0].context.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('the allowance used up: the question box closes with when it comes back; the reports stay open', async ({ authedPage: page }) => {
  await stub(page, status({ allowance: { limit: 50, used: 50, remaining: 0, resets_at: '2026-10-22T18:30:00.000Z', resets_text: '12:00 am (Asia/Kolkata)', timezone: 'Asia/Kolkata' } }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await expect(panel(page)).toContainText('You’ve reached today’s Mexa AI allowance. Your allowance resets at 12:00 am (Asia/Kolkata). You can still access your reports.');
  await expect(page.getByLabel('Your question for Mexa AI')).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Which machines are running right now?' })).toBeDisabled();
});

test('a failed question can be asked again, and only the question goes back', async ({ authedPage: page }) => {
  await stub(page);
  const asked: any[] = [];
  let calls = 0;
  await page.route('**/api/assistant/chat', (r: any) => {
    asked.push(r.request().postDataJSON());
    calls += 1;
    return calls === 1
      ? r.fulfill(json({ status: 'error', message: 'Mexa AI is busy right now. Please try again in a moment.' }, 503))
      : r.fulfill(json({ status: 'success', data: answer }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();
  await page.getByLabel('Your question for Mexa AI').fill('Production today');
  await panel(page).getByRole('button', { name: 'Send' }).click();
  const log = panel(page).getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('Mexa AI is busy right now. Please try again in a moment.');
  await log.getByRole('button', { name: 'Try again' }).click();
  await expect(log).toContainText('Today 65 parts were made on 2 machines.');
  expect(asked[1]).toEqual({ messages: [{ role: 'user', content: 'Production today' }] });
});

test('a role its company admin gave the AI gets it, reports or not; no launcher when S&T switched it off for the company', async ({ page }) => {
  await stub(page);
  await seedAuth(page, { roles: ['SUPERVISOR'], user_type: 'company_user', permissions: ['page:dashboard:view', 'page:assistant:view'], company_permissions: WITH_AI });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
  await expect(launcher(page)).toBeVisible();

  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: WITH_AI });
  await page.route('**/api/assistant/status', (r: any) => r.fulfill(json({ status: 'success', data: { name: 'Mexa AI', enabled: false, reason: 'SWITCHED_OFF' } })));
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);
});

/* 23 Oct 2026, the user: "super admin decides for that company — not all users".
   Without the S&T grant there is no launcher and nothing is asked of the server —
   not for a company with no grants (every other page open), not for its admin;
   and with it, not for a role the company admin did not give it. */
test('only a company S&T gave the AI to — and only the roles its admin gave it', async ({ page }) => {
  await stub(page);
  const asked: string[] = [];
  page.on('request', (r: any) => { if (r.url().includes('/api/assistant/')) asked.push(r.url()); });
  for (const user of [
    { roles: ['COMPANY_ADMIN'], company_permissions: [] },                                            // no grants at all
    { roles: ['COMPANY_ADMIN'], company_permissions: ['page:reports:view'] },                          // reports, not the AI
    { roles: ['SUPERVISOR'], user_type: 'company_user', permissions: ['page:reports:view'], company_permissions: WITH_AI }   // role not given it
  ]) {
    await seedAuth(page, user);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
    await expect(launcher(page)).toHaveCount(0);
  }
  expect(asked).toEqual([]);
});

/* S&T ticks or unticks the AI while people are signed in. Manage Access
   changes their access, so the server refuses their next request once with
   "your access changed" (401 AUTH_REVISION_CHANGED); the app refreshes the
   session and the button comes or goes — nobody signs in again. */
const WITHOUT_AI = WITH_AI.filter(p => p !== 'page:assistant:view');
const accessChanged = json({ message: 'Your access changed. Refresh your session to continue.', code: 'AUTH_REVISION_CHANGED' }, 401);
const refreshTo = (company_permissions: string[]) => (r: any) => r.fulfill(json({ accessToken: stubJwt(), company_permissions }));
/** The next request (not the refresh itself) is refused once, as the server does after a change. */
async function changeAccess(page: any, company_permissions: string[]) {
  await page.route('**/api/auth/refresh', refreshTo(company_permissions));
  let pending = true;
  await page.route('**/api/**', (r: any) => {
    if (!pending || r.request().url().includes('/api/auth/')) return r.fallback();
    pending = false;
    return r.fulfill(accessChanged);
  });
}
/** A page change inside the app (Angular follows the address bar), not a reload. */
const goInApp = (page: any, url: string) =>
  page.evaluate((u: string) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, url);

test('S&T gives the company the AI while its admin is signed in: the button comes without signing in again', async ({ page }) => {
  await stub(page);
  await seedAuth(page, { company_permissions: WITHOUT_AI });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: /Profile|My Profile/ }).first()).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);

  await changeAccess(page, WITH_AI);
  await goInApp(page, '/reports');
  await expect(launcher(page)).toBeVisible();
});

test('S&T takes the AI away while a question is out: the chat goes, the late refusal joins nothing, and given back it starts fresh', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await launcher(page).click();

  await page.route('**/api/auth/refresh', refreshTo(WITHOUT_AI));
  let chats = 0;
  await page.route('**/api/assistant/chat', (r: any) => r.fulfill(++chats === 1 ? accessChanged
    : json({ message: 'Your company does not have access to this page.' }, 403)));
  await page.getByLabel('Your question for Mexa AI').fill('How many parts did VMC - 12 - F make today?');
  await page.getByLabel('Your question for Mexa AI').press('Enter');
  await expect(panel(page)).toHaveCount(0);
  await expect(launcher(page)).toHaveCount(0);
  await expect.poll(() => chats).toBe(2);                                    // the question went again after the refresh: refused

  await changeAccess(page, WITH_AI);
  await goInApp(page, '/reports');
  await launcher(page).click();
  await expect(panel(page).getByRole('group', { name: 'Suggested questions' })).toBeVisible();
  await expect(panel(page)).not.toContainText('How many parts did VMC - 12 - F make today?');
  await expect(panel(page)).not.toContainText('does not have access');
});

/* 22 Oct 2026 — "nothing shows, where is the button?": before the server has
   the assistant (no AI key, or an older API), the button still shows for
   report users and the chat says it is not on yet. */
for (const [why, answer] of [
  ['no AI key on the server', (r: any) => r.fulfill(json({ status: 'success', data: { name: 'Mexa AI', enabled: false, reason: 'NOT_CONFIGURED' } }))],
  ['an older server without it', (r: any) => r.fulfill(json({ message: 'Not found' }, 404))]
] as const) {
  test(`${why}: the button is there, and the chat says it is not on yet`, async ({ authedPage: page }) => {
    await stub(page);
    await page.route('**/api/assistant/status', answer);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/profile');
    await launcher(page).click();
    await expect(panel(page)).toContainText('Mexa AI isn’t switched on yet. Your reports work as usual; once it is set up, you can ask about them here.');
    await expect(page.getByLabel('Your question for Mexa AI')).toBeDisabled();
    await expect(panel(page).getByRole('group', { name: 'Suggested questions' })).toHaveCount(0);
  });
}

test('Escape closes it and gives focus back; one greeting a session; none for anyone who asked for less motion', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await expect(launcher(page)).toHaveClass(/is-greeting/);
  await launcher(page).click();
  await expect(page.getByLabel('Your question for Mexa AI')).toBeFocused();
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
  await expect(launcher(page).locator('.as-launcher-text')).toBeHidden();      // on a phone, the sparkle alone
  const before = await page.evaluate(() => document.documentElement.scrollWidth);
  await launcher(page).click();
  // once its short opening slide has finished, it covers the screen
  await expect.poll(async () => {
    const b = await panel(page).boundingBox();
    return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  }).toEqual([0, 0, 390, 844]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(before);   // the chat adds nothing off the side
  expect(before).toBeLessThanOrEqual(390);
  await panel(page).getByRole('button', { name: 'Close Mexa AI' }).click();
  await expect(panel(page)).toHaveCount(0);
});

/* 23 Oct 2026, the user: "a full-page chatbot — one icon, full view". The
   corner chat's full-view button opens the same conversation on a page of
   its own (/assistant); Small view there goes back to the page it came from
   with the corner chat open. */
const fullPage = (page: any) => page.getByRole('heading', { level: 1, name: 'Mexa AI' });
const ask = async (page: any, q: string) => {
  await page.getByLabel('Your question for Mexa AI').fill(q);
  await page.getByLabel('Your question for Mexa AI').press('Enter');
};

test('full view: the conversation on a page of its own; Small view brings it back over the page it came from', async ({ authedPage: page }) => {
  await stub(page);
  const asked: any[] = [];
  await page.route('**/api/assistant/chat', (r: any) => {
    asked.push(r.request().postDataJSON());
    return r.fulfill(json({ status: 'success', data: { ...answer, sig: `sig-${asked.length}` } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/notifications');
  await launcher(page).click();
  await ask(page, 'Production today');
  await expect(panel(page).getByRole('log', { name: 'Conversation' })).toContainText('Today 65 parts were made on 2 machines.');

  await panel(page).getByRole('button', { name: 'Open full view' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(fullPage(page)).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);                             // the page is the chat: no corner button
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('Production today');
  await expect(log).toContainText('Today 65 parts were made on 2 machines.');
  await expect(page.getByText('37 of 50 left today')).toBeVisible();
  await expect(page.getByLabel('Your question for Mexa AI')).toBeFocused();

  await ask(page, 'And by shift?');                                         // it goes on here, signatures and all
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1].messages).toEqual([
    { role: 'user', content: 'Production today' },
    { role: 'assistant', content: answer.text, sig: 'sig-1' },
    { role: 'user', content: 'And by shift?' }
  ]);
  await expect(log.getByText('Today 65 parts were made on 2 machines.')).toHaveCount(2);

  await page.getByRole('button', { name: 'Small view' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('log', { name: 'Conversation' })).toContainText('And by shift?');
  await expect(page.getByLabel('Your question for Mexa AI')).toBeFocused();
});

test('a question still being answered when full view opens is answered on the full page', async ({ authedPage: page }) => {
  await stub(page);
  let release: () => void = () => {};
  await page.route('**/api/assistant/chat', async (r: any) => {
    await new Promise<void>(res => (release = res));
    return r.fulfill(json({ status: 'success', data: answer })).catch(() => {});
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/notifications');
  await launcher(page).click();
  await panel(page).getByRole('button', { name: 'Summarize today’s production report.' }).click();
  await expect(panel(page).getByRole('status').filter({ hasText: 'Mexa AI is looking into it…' })).toBeVisible();

  await panel(page).getByRole('button', { name: 'Open full view' }).click();
  await expect(fullPage(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Mexa AI is looking into it…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  release();
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Today 65 parts were made on 2 machines.');
  await expect(page.getByText('37 of 50 left today')).toBeVisible();
});

test('from a report, full view keeps its filters and says so; Small view goes back to the report', async ({ authedPage: page }) => {
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
  await panel(page).getByRole('button', { name: 'Open full view' }).click();

  await expect(page.getByText(/Using the report you had open: Production report · \d{2}-\w{3}-\d{4} · VMC - 12 - F · All shifts/)).toBeVisible();
  await ask(page, 'How did this machine do?');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].context).toMatchObject({ report: 'production', machine: 'VMC - 12 - F', shift: null });

  await page.getByRole('button', { name: 'Small view' }).click();
  await expect(page).toHaveURL(/\/reports\?tab=production/);
  await expect(panel(page)).toContainText('How did this machine do?');
});

test('opened directly; View report from the full page opens the report with the conversation in the corner', async ({ authedPage: page }) => {
  await stub(page);
  await page.route('**/api/assistant/chat', (r: any) => r.fulfill(json({ status: 'success', data: answer })));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/assistant');
  await expect(fullPage(page)).toBeVisible();
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(/(Good (morning|afternoon|evening)|Hello), test/);
  await expect(page.getByRole('group', { name: 'Suggested questions' }).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'New chat' })).toHaveCount(0);   // nothing to start over yet

  await ask(page, 'Production today');
  const log = page.getByRole('log', { name: 'Conversation' });
  await expect(log).toContainText('Today 65 parts were made on 2 machines.');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(log).not.toContainText('Production today');
  await ask(page, 'Production today');
  await log.getByRole('button', { name: 'View report' }).click();
  await expect(page).toHaveURL(/\/reports\?tab=production$/);              // opened on that day; the filters taken
  await expect(panel(page)).toContainText('Today 65 parts were made on 2 machines.');
});

test('the full page opens only where the AI was given; S&T goes to its own pages', async ({ page }) => {
  await stub(page);
  await seedAuth(page, { company_permissions: WITHOUT_AI });
  await page.goto('/assistant');
  await expect(page).toHaveURL(/\/no-access$/);

  await seedAuth(page, { roles: ['SNT_SUPER'], is_snt_super: true, company_id: null, user_type: 'SNT_SUPER' });
  await page.goto('/assistant');
  await expect(page).toHaveURL(/\/admin\/companies$/);
});

test('on a phone: the corner sheet is already the whole screen (no full view there); the full page fits', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/notifications');
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Open full view' })).toBeHidden();

  await page.goto('/assistant');
  await expect(page.getByLabel('Your question for Mexa AI')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = await page.getByLabel('Your question for Mexa AI').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);                     // the question box is on screen without scrolling
});

/* 23 Oct 2026, the user: "only the super admin decides how much — up or down — not the company side".
   S&T sets it in Company Management → AI (super-admin-flow.spec.ts). */
test('the company side sets nothing about the AI: no Mexa AI card in Settings, even for the company admin', async ({ authedPage: page }) => {
  await stub(page);
  await page.route('**/api/alarms/notification-policy', (r: any) => r.fulfill(json({ success: true, data: { enabled: false, version: 0, counts: { machines: 0 } } })));
  const settingsCalls: string[] = [];
  await page.route('**/api/assistant/settings', (r: any) => { settingsCalls.push(r.request().method()); return r.fulfill(json({ message: 'Not found' }, 404)); });
  await seedAuth(page, { roles: ['COMPANY_ADMIN'], company_permissions: WITH_AI });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(launcher(page)).toBeVisible();                                // the AI itself is there
  await expect(page.getByRole('heading', { name: 'Mexa AI' })).toHaveCount(0);
  await expect(page.getByLabel('Answers per person per day')).toHaveCount(0);
  expect(settingsCalls).toEqual([]);
});

test('switched off by S&T, the full page says so and asks nothing', async ({ authedPage: page }) => {
  await stub(page, { status: 'success', data: { name: 'Mexa AI', enabled: false, reason: 'SWITCHED_OFF' } });
  const chats: any[] = [];
  await page.route('**/api/assistant/chat', (r: any) => { chats.push(1); return r.fulfill(json({ status: 'success', data: answer })); });
  await page.goto('/assistant');
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Mexa AI is switched off for your company. S&T decides how much it may be used.');
  await expect(page.getByLabel('Your question for Mexa AI')).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Suggested questions' })).toHaveCount(0);
  expect(chats).toEqual([]);
});

/* 25 Oct 2026, the user: "the icon does nothing when clicked" — and "your own
   best design, not a copy": the sparkle turns and the chat grows out of it. */
test('a click turns the sparkle into the close mark and the chat grows out of the button; no motion for less motion', async ({ authedPage: page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/profile');
  await expect(launcher(page).locator('.as-launcher-text')).toHaveText('Ask Mexa AI');   // a pill that says what it is
  await launcher(page).click();
  const button = page.locator('.as-launcher');                                 // named "Close Mexa AI" while open
  await expect(button).toHaveClass(/is-pop/);                                   // the sparkle turns…
  await expect(button).not.toHaveClass(/is-pop/);                               // …once
  await expect(panel(page)).toBeVisible();
  const spark = (await button.boundingBox())!;
  await expect.poll(async () => {
    const b = (await panel(page).boundingBox())!;
    return [Math.round(b.x + b.width) === Math.round(spark.x + spark.width), b.y + b.height < spark.y];
  }).toEqual([true, true]);                                                     // right above the button, its right edge on the button's
  await expect(panel(page).getByRole('group', { name: 'Suggested questions' }).getByRole('button')).toHaveCount(4);
  await expect(panel(page)).toContainText('38 of 50 left today');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await launcher(page).click();
  expect(await page.locator('.as-launcher .material-icons').evaluate((el: Element) => getComputedStyle(el).animationName)).toBe('none');
  expect(await panel(page).evaluate((el: Element) => getComputedStyle(el).animationName)).toBe('none');
});
